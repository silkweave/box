// First-run setup for a fresh Box. This is deliberately a host command: it writes local
// configuration and the warehouse directly, without opening a network signup endpoint.
import { createInterface } from 'node:readline/promises'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { ensureAgentPrincipals, hasHumanUsers } from '@silkweave/box-core/auth/bootstrap'
import { issuePrincipalToken, issueSigninLink, setPrincipalRole } from '@silkweave/box-core/auth/principal'
import { agentIdentity, systemUserId } from '@silkweave/box-core/box-config'
import { readBoxConfig, writeBoxJsonIfAbsent, writeBoxLocal, type BoxJson } from '@silkweave/box-core/box-json'
import { upsertUser } from '@silkweave/box-core/users/state'
import { commandError, commandHeader, commandLine, commandSuccess, commandValue, commandWarning } from '../../../packages/cli/src/command-ui.js'
import { isMain, repoRoot } from '../../../packages/cli/src/repo.js'

export type ProviderEngine = 'codex' | 'claude'

export interface ProviderCandidate {
  engine: ProviderEngine
  home: string
  authenticated: boolean
  source: 'environment' | 'default'
}

interface SetupAnswers {
  ownerId: string
  displayName: string
  profiles: ProviderCandidate[]
}

interface SetupArgs {
  owner?: string
  name?: string
  profiles?: ProviderEngine[]
  yes: boolean
  noProfiles: boolean
}

const OWNER_ID = /^[a-z0-9][a-z0-9-]{0,62}$/

const directoryExists = (path: string): boolean => {
  try { return statSync(path).isDirectory() } catch { return false }
}

/** Find conventional provider config directories. This reads paths and marker existence only. */
export function detectProviderProfiles(options: {
  home?: string
  env?: NodeJS.ProcessEnv
  directory?: (path: string) => boolean
  exists?: (path: string) => boolean
} = {}): ProviderCandidate[] {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const directory = options.directory ?? directoryExists
  const exists = options.exists ?? existsSync
  const definitions: Array<{ engine: ProviderEngine; env: string; fallback: string; marker: string }> = [
    { engine: 'codex', env: 'CODEX_HOME', fallback: join(home, '.codex'), marker: 'auth.json' },
    { engine: 'claude', env: 'CLAUDE_CONFIG_DIR', fallback: join(home, '.claude'), marker: '.credentials.json' },
  ]
  return definitions.flatMap(definition => {
    const configured = env[definition.env]?.trim()
    const path = resolve(configured || definition.fallback)
    if (!directory(path)) return []
    return [{
      engine: definition.engine,
      home: path,
      authenticated: exists(join(path, definition.marker)),
      source: configured ? 'environment' : 'default',
    }]
  })
}

function profileName(ownerId: string, engine: ProviderEngine): string {
  return `${ownerId}:${engine}`
}

/** Merge generated owner profiles with any preconfigured service or teammate profiles. */
export function setupProfilePatch(
  current: Pick<BoxJson, 'workerdeck' | 'agentProfiles'>,
  ownerId: string,
  selected: ProviderCandidate[],
): Record<string, unknown> {
  if (!selected.length) return {}
  const rawWorkerdeck = current.workerdeck ?? {}
  const declaredProfiles = rawWorkerdeck['profiles']
  if (declaredProfiles !== undefined && !Array.isArray(declaredProfiles)) {
    throw new Error('workerdeck.profiles already exists but is not an array; setup will not replace it')
  }
  const existingProfiles = declaredProfiles ?? []
  const profiles = [...existingProfiles]
  const ownerMap = { ...current.agentProfiles[ownerId] }

  for (const candidate of selected) {
    if (!isAbsolute(candidate.home)) throw new Error(`${candidate.engine} profile home must be an absolute path`)
    const name = profileName(ownerId, candidate.engine)
    const mapped = ownerMap[candidate.engine]
    if (mapped && mapped !== name) {
      throw new Error(`agentProfiles.${ownerId}.${candidate.engine} already maps to ${JSON.stringify(mapped)}; setup will not replace it`)
    }
    ownerMap[candidate.engine] = name
    const generated = {
      name,
      engine: candidate.engine,
      person: ownerId,
      home: candidate.home,
      description: `${ownerId} · ${candidate.engine === 'codex' ? 'Codex' : 'Claude'}`,
      ...(candidate.engine === 'codex' ? { defaults: { permissionMode: 'acceptEdits' } } : {}),
    }
    const at = profiles.findIndex(profile => typeof profile === 'object' && profile !== null && (profile as { name?: unknown }).name === name)
    if (at >= 0 && JSON.stringify(profiles[at]) !== JSON.stringify(generated)) {
      throw new Error(`workerdeck profile ${JSON.stringify(name)} already exists with different settings; setup will not replace it`)
    }
    if (at < 0) profiles.push(generated)
  }

  return {
    workerdeck: { ...rawWorkerdeck, profiles },
    agentProfiles: { [ownerId]: ownerMap },
  }
}

function parseArgs(argv: string[]): SetupArgs {
  const value = (flag: string): string | undefined => {
    const at = argv.indexOf(flag)
    if (at < 0) return undefined
    const next = argv[at + 1]
    if (!next || next.startsWith('--')) throw new Error(`${flag} requires a value`)
    return next
  }
  const rawProfiles = value('--profiles')
  const profiles = rawProfiles?.split(',').map(item => item.trim()).filter(Boolean)
  if (profiles?.some(engine => engine !== 'codex' && engine !== 'claude')) {
    throw new Error('--profiles accepts codex, claude, or both as a comma-separated list')
  }
  if (argv.includes('--no-profiles') && rawProfiles) throw new Error('use either --profiles or --no-profiles')
  const known = new Set(['--owner', '--name', '--profiles', '--yes', '--no-profiles', '--help', '-h'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!known.has(arg)) throw new Error(`unknown setup option ${JSON.stringify(arg)}`)
    if (['--owner', '--name', '--profiles'].includes(arg)) i += 1
  }
  return {
    owner: value('--owner'),
    name: value('--name'),
    profiles: profiles as ProviderEngine[] | undefined,
    yes: argv.includes('--yes'),
    noProfiles: argv.includes('--no-profiles'),
  }
}

const SETUP_HELP = `  bun setup [options]
  box setup [options]

  --owner <id>               owner id (default: admin)
  --name <display name>      owner display name (default: owner id)
  --profiles codex,claude    configure only these detected profiles
  --no-profiles              skip provider configuration
  --yes                      accept defaults without prompting
`

async function collectAnswers(args: SetupArgs, candidates: ProviderCandidate[]): Promise<SetupAnswers> {
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !args.yes
  if (!interactive && !args.yes && (!args.owner || !args.name || (candidates.length > 0 && !args.profiles && !args.noProfiles))) {
    throw new Error('setup needs an interactive terminal, or explicit options with --yes')
  }
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null
  const ask = async (question: string, fallback: string): Promise<string> => {
    if (!rl) return fallback
    const answer = (await rl.question(`  ${question} [${fallback}]: `)).trim()
    return answer || fallback
  }
  const confirm = async (question: string): Promise<boolean> => {
    if (!rl) return true
    const answer = (await rl.question(`  ${question} [Y/n]: `)).trim().toLowerCase()
    return answer !== 'n' && answer !== 'no'
  }

  try {
    const machine = agentIdentity()
    if (interactive && !await confirm(`Use ${machine.name} (${machine.id}) as this Box's machine principal?`)) {
      throw new Error('edit the agent block in box.json, then run bun setup again')
    }
    const ownerId = (args.owner ?? await ask('Owner ID', 'admin')).trim()
    if (!OWNER_ID.test(ownerId)) throw new Error('owner id must use lowercase letters, numbers and dashes, starting with a letter or number')
    const displayName = (args.name ?? await ask('Owner display name', ownerId)).trim()
    if (!displayName) throw new Error('owner display name cannot be empty')

    let profiles: ProviderCandidate[] = []
    if (!args.noProfiles) {
      if (args.profiles) {
        const available = new Set(candidates.map(candidate => candidate.engine))
        const missing = args.profiles.filter(engine => !available.has(engine))
        if (missing.length) throw new Error(`no detected config directory for: ${missing.join(', ')}`)
        profiles = candidates.filter(candidate => args.profiles!.includes(candidate.engine))
      } else if (interactive) {
        for (const candidate of candidates) {
          const status = candidate.authenticated ? 'sign-in found' : 'sign-in may still be required'
          if (await confirm(`Use ${candidate.engine} profile at ${candidate.home}? (${status})`)) profiles.push(candidate)
        }
      } else profiles = candidates
    }
    return { ownerId, displayName, profiles }
  } finally {
    rl?.close()
  }
}

function ownerFields(displayName: string): { first_name: string; last_name: string } {
  const [first, ...rest] = displayName.trim().split(/\s+/)
  return { first_name: first!, last_name: rest.join(' ') }
}

async function run(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    commandHeader('setup')
    process.stdout.write(SETUP_HELP)
    return
  }
  const args = parseArgs(argv)
  writeBoxJsonIfAbsent(join(repoRoot, 'box.json'))
  const candidates = detectProviderProfiles()

  commandHeader('setup')
  if (candidates.length) {
    commandLine(`Detected ${candidates.map(candidate => candidate.engine).join(' and ')} configuration on this host.`, 'muted')
  } else {
    commandLine('No Codex or Claude configuration directory was detected. Provider setup can be completed later.', 'muted')
  }
  const answers = await collectAnswers(args, candidates)
  if (answers.ownerId === systemUserId()) throw new Error(`owner id must differ from the machine principal ${JSON.stringify(systemUserId())}`)

  // Refuse before writing profile configuration or rotating anything. A partially completed first
  // run with only the machine principal remains safe to resume.
  await ensureAgentPrincipals()
  if (await hasHumanUsers()) {
    throw new Error('this Box already has a human user; setup will not replace profiles or rotate credentials. Use box auth login <id>.')
  }

  if (answers.profiles.length) {
    const current = readBoxConfig(repoRoot)
    writeBoxLocal(repoRoot, setupProfilePatch(current, answers.ownerId, answers.profiles))
  }

  const names = ownerFields(answers.displayName)
  await upsertUser({ id: answers.ownerId, nickname: answers.ownerId, ...names })
  await setPrincipalRole(answers.ownerId, 'admin')
  const token = await issuePrincipalToken(answers.ownerId)
  // The local proxy needs the same credential. Keep it in the mode-0600 local configuration and
  // never print it from setup; `box auth reveal` remains the deliberate reveal operation.
  writeBoxLocal(repoRoot, { mcp: { token } })
  const { grant, claims } = await issueSigninLink(answers.ownerId)
  const config = readBoxConfig(repoRoot)
  const origin = (config.server.dashboardUrl ?? `http://localhost:${config.server.port}`).replace(/\/+$/, '')
  const signIn = `${origin}/login/${encodeURIComponent(grant)}`

  commandSuccess(`Created ${answers.ownerId} as the first administrator`)
  if (answers.profiles.length) {
    commandSuccess(`Configured ${answers.profiles.map(profile => profile.engine).join(' and ')} for ${answers.ownerId}`)
    for (const profile of answers.profiles.filter(profile => !profile.authenticated)) {
      commandWarning(`${profile.engine} was configured from ${profile.home}, but no sign-in marker was found.`)
    }
  } else commandWarning('No Builder provider was configured. The dashboard will keep that quest open.')
  commandSuccess('Stored the owner credential for the local Box CLI; it was not printed')
  commandLine('Start the Box:', 'muted')
  commandValue('bun dev')
  commandLine('Then open this single-use sign-in link:', 'muted')
  commandValue(signIn)
  commandLine(`Expires ${new Date(claims.exp).toISOString()} · reveal the permanent token later with: box auth reveal ${answers.ownerId}`, 'muted')
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).catch(error => {
    commandError(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
