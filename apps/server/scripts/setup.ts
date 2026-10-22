// First-run setup for a fresh Box. This is deliberately a host command: it writes local
// configuration and the warehouse directly, without opening a network signup endpoint.
import { spawn, spawnSync } from 'node:child_process'
import { request } from 'node:http'
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { ensureAgentPrincipals, hasHumanUsers } from '@silkweave/box-core/auth/bootstrap'
import { issuePrincipalToken, issueSigninLink, setPrincipalRole } from '@silkweave/box-core/auth/principal'
import { agentIdentity, systemUserId } from '@silkweave/box-core/box-config'
import { readBoxConfig, writeBoxJsonIfAbsent, writeBoxLocal, type BoxJson } from '@silkweave/box-core/box-json'
import { upsertUser } from '@silkweave/box-core/users/state'
import { commandError, commandHeader, commandLine, commandSuccess, commandValue, commandWarning, openBrowser } from '../../../packages/cli/src/command-ui.js'
import { isMain, repoRoot } from '../../../packages/cli/src/repo.js'
import { readSecret, setRegistryKey } from '../../../packages/cli/src/recipe.js'
import { ask, choose, confirm, explanation, type PromptOptions } from '../../../packages/cli/src/prompt.js'

export type ProviderEngine = 'codex' | 'claude'

export interface ProviderCandidate {
  engine: ProviderEngine
  home: string
  authenticated: boolean
  /** `box`: a config dir inside this Box, connected later in Settings > Profile. */
  source: 'environment' | 'default' | 'box'
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
  existing?: ProviderEngine[]
  yes: boolean
  explain: boolean
  review: boolean
  noProfiles: boolean
  noStart: boolean
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

/** The owner's own config dir for one engine inside this Box. Nothing outside the Box is touched. */
export function boxProfileHome(root: string, ownerId: string, engine: ProviderEngine): string {
  return join(root, 'data', 'agent', 'accounts', ownerId, engine)
}

export function boxProfile(root: string, ownerId: string, engine: ProviderEngine): ProviderCandidate {
  return { engine, home: boxProfileHome(root, ownerId, engine), authenticated: false, source: 'box' }
}

/** Create the Box-only config dirs, readable by this user only. */
export function createBoxProfileHomes(profiles: ProviderCandidate[]): void {
  for (const profile of profiles.filter(candidate => candidate.source === 'box')) {
    mkdirSync(profile.home, { recursive: true, mode: 0o700 })
    chmodSync(dirname(profile.home), 0o700)
    chmodSync(profile.home, 0o700)
  }
}

const onPath = (command: string): boolean =>
  (process.env.PATH ?? '').split(':').some(dir => dir !== '' && existsSync(join(dir, command)))

const ENGINE_LABEL: Record<ProviderEngine, string> = { claude: 'Claude', codex: 'Codex' }

/**
 * Non-interactive profile choice: Box-only profiles for `profiles` (default Claude), the person's
 * existing config dir only for engines named in `existing`.
 */
export function chooseProfiles(
  args: Partial<Pick<SetupArgs, 'profiles' | 'existing' | 'noProfiles'>>,
  candidates: ProviderCandidate[],
  root: string,
  ownerId: string,
): ProviderCandidate[] {
  if (args.noProfiles) return []
  const existing = args.existing ?? []
  const missing = existing.filter(engine => !candidates.some(candidate => candidate.engine === engine))
  if (missing.length) throw new Error(`no existing config directory found for: ${missing.join(', ')}`)
  const boxOnly = args.profiles ?? (existing.length ? [] : ['claude' as const])
  return [
    ...boxOnly.map(engine => boxProfile(root, ownerId, engine)),
    ...candidates.filter(candidate => existing.includes(candidate.engine)),
  ]
}

/**
 * The owner suggested from this computer's account: `mark` / "Mark Smith" for the macOS user
 * mark. Falls back to `admin` when the account name cannot be an owner id.
 */
export function suggestOwner(username: string, fullName: string | undefined, machineId: string): { id: string; name: string } {
  const id = username.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)
  const usable = OWNER_ID.test(id) && id !== machineId && id !== 'root'
  const name = fullName?.trim()
  return usable ? { id, name: name || id } : { id: 'admin', name: name || 'admin' }
}

/** This computer account's full name, when the system knows one. */
function accountFullName(username: string): string | undefined {
  const read = (command: string, args: string[]): string => {
    try { return spawnSync(command, args, { encoding: 'utf8', timeout: 2_000 }).stdout?.trim() ?? '' } catch { return '' }
  }
  if (process.platform === 'darwin') return read('id', ['-F']) || undefined
  return read('getent', ['passwd', username]).split(':')[4]?.split(',')[0]?.trim() || undefined
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
  const engines = (flag: string): ProviderEngine[] | undefined => {
    const list = value(flag)?.split(',').map(item => item.trim()).filter(Boolean)
    if (list?.some(engine => engine !== 'codex' && engine !== 'claude')) {
      throw new Error(`${flag} accepts codex, claude, or both as a comma-separated list`)
    }
    return list as ProviderEngine[] | undefined
  }
  const profiles = engines('--profiles')
  const existing = engines('--existing-profiles')
  if (argv.includes('--no-profiles') && (profiles || existing)) throw new Error('use either --profiles/--existing-profiles or --no-profiles')
  const both = profiles?.filter(engine => existing?.includes(engine)) ?? []
  if (both.length) throw new Error(`${both.join(', ')} cannot be both a Box-only and an existing profile`)
  const known = new Set(['--owner', '--name', '--profiles', '--existing-profiles', '--yes', '--explain', '--review', '--no-profiles', '--no-start', '--help', '-h'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!known.has(arg)) throw new Error(`unknown setup option ${JSON.stringify(arg)}`)
    if (['--owner', '--name', '--profiles', '--existing-profiles'].includes(arg)) i += 1
  }
  return {
    owner: value('--owner'),
    name: value('--name'),
    profiles,
    existing,
    yes: argv.includes('--yes'),
    explain: argv.includes('--explain'),
    review: argv.includes('--review'),
    noProfiles: argv.includes('--no-profiles'),
    noStart: argv.includes('--no-start'),
  }
}

const SETUP_HELP = `  bun setup [options]
  box setup [options]

  --owner <id>               owner id (default: this computer's account name, else admin)
  --name <display name>      owner display name (default: the account's full name)
  --profiles codex,claude    Box-only agent profiles to create (default: claude)
  --existing-profiles <list> reuse this computer's existing codex/claude config instead
  --no-profiles              skip provider configuration
  --no-start                 print the sign-in link instead of starting the Box
  --yes                      accept defaults without prompting (implies --no-start)
  --explain                  explain every question before asking (otherwise type ? at a question)
  --review                   also confirm the Box's own agent identity from box.json
`

const HELP = {
  agent: `Your Box has its own agent identity (box.json "agent"). It acts under this name when it works
for you. Developers who want another name stop here, edit box.json and run setup again.`,
  owner: `Your user name in the Box: lowercase letters, numbers and dashes. You use it to get a new
sign-in link (box auth login). The suggestion comes from this computer's account.`,
  name: 'How the Box shows you to others.',
  engine: `The Box builds and runs its features with an AI agent. It gets a sign-in of its own inside
this Box, so your own Claude or Codex login on this computer stays untouched. You connect the
account in the Box afterwards: Settings › Profile › Connect.`,
  key: `Recipes are the features you add to your Box. The open ones need no key. An access key, from
whoever shares recipes with you, unlocks the rest. Paste it here: it shows as dots. No key? Press
Enter; add one any time later with: box registry key`,
}

async function collectAnswers(args: SetupArgs, candidates: ProviderCandidate[]): Promise<SetupAnswers> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !args.yes)
  if (!interactive && !args.yes && (!args.owner || !args.name)) {
    throw new Error('setup needs an interactive terminal, or explicit options with --yes')
  }
  const prompt: PromptOptions = { explain: args.explain }
  const machine = agentIdentity()
  if (interactive && args.review) {
    if (!await confirm(`Use ${machine.name} (${machine.id}) as this Box's agent identity?`, true, prompt, HELP.agent)) {
      throw new Error('edit the agent block in box.json, then run box setup again')
    }
  } else if (interactive) commandLine(`This Box's own agent: ${machine.name} (${machine.id})`, 'muted')

  const account = userInfo().username
  const suggested = suggestOwner(account, accountFullName(account), machine.id)
  const ownerId = (args.owner ?? (interactive ? await ask('Your user name in the Box', suggested.id, prompt, HELP.owner) : suggested.id)).trim()
  if (!OWNER_ID.test(ownerId)) throw new Error('the user name must use lowercase letters, numbers and dashes, starting with a letter or number')
  const fallbackName = ownerId === suggested.id ? suggested.name : ownerId.charAt(0).toUpperCase() + ownerId.slice(1)
  const displayName = (args.name ?? (interactive ? await ask('Your name', fallbackName, prompt, HELP.name) : fallbackName)).trim()
  if (!displayName) throw new Error('the name cannot be empty')

  if (!interactive || args.noProfiles || args.profiles || args.existing) {
    return { ownerId, displayName, profiles: chooseProfiles(args, candidates, repoRoot, ownerId) }
  }
  // Each engine gets its own sign-in inside this Box, connected later in Settings > Profile.
  // Reusing the computer's existing login stays an explicit flag (--existing-profiles).
  const has = (engine: ProviderEngine) => candidates.some(candidate => candidate.engine === engine) || onPath(engine)
  const initial = has('codex') && !has('claude') ? 1 : 0
  const engines = await choose<ProviderEngine[]>('Which AI should build your Box?', [
    { value: ['claude'], label: 'Claude', detail: 'recommended' },
    { value: ['codex'], label: 'Codex', detail: 'ChatGPT' },
    { value: ['claude', 'codex'], label: 'Claude and Codex' },
    { value: [], label: 'Not now', detail: 'connect one later in the Box' },
  ], initial, prompt, HELP.engine)
  return { ownerId, displayName, profiles: engines.map(engine => boxProfile(repoRoot, ownerId, engine)) }
}

/** Run core work without its server log lines (agents created, link issued) in the setup dialogue. */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const info = console.info
  console.info = () => {}
  try { return await work() } finally { console.info = info }
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
  const answers = await collectAnswers(args, candidates)
  if (answers.ownerId === systemUserId()) throw new Error(`owner id must differ from the machine principal ${JSON.stringify(systemUserId())}`)

  // Refuse before writing profile configuration or rotating anything. A partially completed first
  // run with only the machine principal remains safe to resume.
  await quietly(ensureAgentPrincipals)
  if (await hasHumanUsers()) {
    throw new Error('this Box already has a human user; setup will not replace profiles or rotate credentials. Use box auth login <id>.')
  }

  if (answers.profiles.length) {
    createBoxProfileHomes(answers.profiles)
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
  commandSuccess(`Created ${answers.ownerId} as the first administrator`)
  if (answers.profiles.length) {
    commandSuccess(`Configured ${answers.profiles.map(profile => ENGINE_LABEL[profile.engine]).join(' and ')} for ${answers.ownerId}`)
    const boxOnly = answers.profiles.filter(profile => profile.source === 'box')
    if (boxOnly.length) {
    }
    for (const profile of answers.profiles.filter(profile => profile.source !== 'box' && !profile.authenticated)) {
      commandWarning(`${profile.engine} was configured from ${profile.home}, but no sign-in marker was found.`)
    }
  } else commandWarning('No Builder provider was configured. The dashboard will keep that quest open.')
  commandSuccess('Stored the owner credential for the local Box CLI; it was not printed')
  if (process.stdin.isTTY && process.stdout.isTTY && !args.yes) await askRegistryKey({ explain: args.explain })

  if (!startsDev(args)) {
    // Issued last, so its few minutes start when the instructions are printed.
    const { signIn, expires } = await issueOwnerSignIn(answers.ownerId)
    commandLine('Start the Box:', 'muted')
    commandValue('bun dev')
    commandLine('Then open this single-use sign-in link:', 'muted')
    commandValue(signIn)
    commandLine(`${expires} · reveal the permanent token later with: box auth reveal ${answers.ownerId}`, 'muted')
    return
  }
  const connect = answers.profiles.filter(profile => profile.source === 'box').map(profile => ENGINE_LABEL[profile.engine])
  const home = homedir()
  const folder = repoRoot.startsWith(`${home}/`) ? `~${repoRoot.slice(home.length)}` : repoRoot
  commandLine('')
  commandSuccess('Your Box is ready. It starts now and opens in your browser.')
  commandLine('')
  commandLine('Next, in the Box:', 'text')
  commandLine(connect.length
    ? `  Connect ${connect.join(' and ')}: Settings › Profile › Connect`
    : '  Connect Claude or Codex when you want Builder: Settings › Profile', 'muted')
  commandLine('  Add your first feature: pick a recipe on the home page', 'muted')
  commandLine('')
  commandLine('Good to know:', 'text')
  commandLine('  The Box runs while this window stays open. Press q to stop it.', 'muted')
  commandLine(`  Start it again: cd ${folder} && bun dev`, 'muted')
  commandLine('  New sign-in link: box auth login', 'muted')
  commandLine('')
  await new Promise(done => setTimeout(done, 2_000))
  process.exitCode = await startDevAndOpen(answers.ownerId)
}

/**
 * A single-use sign-in link for the owner. Issue it only when it is about to be used: the link is
 * valid for a few minutes from issue, and the registry-key prompt plus a first boot can take longer.
 */
async function issueOwnerSignIn(ownerId: string): Promise<{ signIn: string; expires: string }> {
  const { grant, claims } = await quietly(() => issueSigninLink(ownerId))
  const config = readBoxConfig(repoRoot)
  const origin = (config.server.dashboardUrl ?? `http://localhost:${config.server.port}`).replace(/\/+$/, '')
  const until = new Date(claims.exp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return { signIn: `${origin}/login/${encodeURIComponent(grant)}`, expires: `Valid until ${until} · a new link any time: box auth login` }
}

/**
 * Optional: an access key for the recipe registry, for recipes beyond the open ones. Hidden input,
 * checked against the registry before it is saved to box.local.json; Enter skips. `box registry
 * key` does the same later.
 */
async function askRegistryKey(prompt: PromptOptions): Promise<void> {
  if (readBoxConfig(repoRoot).registry.token) { commandSuccess('A recipe registry access key is already set'); return }
  if (prompt.explain) explanation(HELP.key)
  else commandLine('Recipes are the features you add. An access key unlocks more of them.', 'muted')
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = await readSecret('  Recipe access key (paste it, or press Enter to skip): ')
    if (!key) { commandLine('No access key. Set one later with: box registry key', 'muted'); return }
    try {
      const { withKey, open } = await setRegistryKey(repoRoot, key)
      commandSuccess(`Access key saved. This Box can adapt ${withKey} recipes (${withKey - open} beyond the open ones).`)
      return
    } catch (error) {
      commandWarning(error instanceof Error ? error.message : String(error))
    }
  }
  commandLine('Set the key later with: box registry key', 'muted')
}

/** Interactive setup hands straight over to `box dev`; automation keeps the printed instructions. */
export function startsDev(args: Pick<SetupArgs, 'yes' | 'noStart'>, tty = Boolean(process.stdin.isTTY && process.stdout.isTTY)): boolean {
  return tty && !args.yes && !args.noStart
}

const DEV_READY_TIMEOUT_MS = 10 * 60_000

/** True once the supervisor reports both the application and the frontend running. */
function devReady(socketPath: string): Promise<boolean> {
  return new Promise(resolve => {
    const req = request({ socketPath, method: 'GET', path: '/app-status', timeout: 2_000 }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => {
        try {
          const state = JSON.parse(text) as { application?: { status?: string }; frontend?: { mode?: string; status?: string } }
          const frontend = state.frontend?.mode === 'dev' ? state.frontend.status === 'running' : state.frontend?.status === 'built'
          resolve(res.statusCode === 200 && state.application?.status === 'running' && frontend)
        } catch { resolve(false) }
      })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
    req.end()
  })
}

/**
 * Run the dev supervisor in the foreground, then issue and open the owner's sign-in link once both
 * the application and the frontend report running through the supervisor's local control socket.
 * Opening any earlier would spend the single-use grant on a page that cannot sign anyone in yet, and
 * issuing any earlier would let a slow first boot run out its few minutes.
 */
async function startDevAndOpen(ownerId: string): Promise<number> {
  const socket = join(repoRoot, 'data', 'builder', 'ui-refresh.sock')
  const child = spawn(process.execPath, ['--bun', '--no-env-file', '--no-orphans', 'run', '--silent', 'dev'], { cwd: repoRoot, stdio: 'inherit' })
  // The terminal delivers Ctrl+C to the whole process group; the supervisor owns shutdown.
  const ignore = () => {}
  process.on('SIGINT', ignore)
  const forward = () => child.kill('SIGTERM')
  process.on('SIGTERM', forward)
  let exited = false
  let opened = false
  const done = new Promise<number>(resolve => {
    child.on('exit', (code, signal) => { exited = true; resolve(code ?? (signal === 'SIGINT' ? 130 : 1)) })
    child.on('error', error => { exited = true; commandError(`Could not start the Box: ${error.message}`); resolve(1) })
  })
  const deadline = Date.now() + DEV_READY_TIMEOUT_MS
  while (!exited && Date.now() < deadline) {
    await new Promise(next => setTimeout(next, 1_000))
    if (exited) break
    if (await devReady(socket)) {
      const { signIn, expires } = await issueOwnerSignIn(ownerId)
      openBrowser(signIn, { quiet: true })
      commandLine('')
      commandLine('If the browser did not open, use this single-use sign-in link:', 'muted')
      commandValue(signIn)
      commandLine(expires, 'muted')
      opened = true
      break
    }
  }
  const code = await done
  process.off('SIGINT', ignore)
  process.off('SIGTERM', forward)
  if (!opened) {
    commandWarning('The Box stopped before the sign-in page could open.')
    commandLine('Start it with bun dev, then create a sign-in link with box auth login.', 'muted')
  }
  return code
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).catch(error => {
    commandError(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
