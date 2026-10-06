// The `workerdeck` section of box.json - which agent profiles this Box declares, and the
// machine facts they need. boxJson() also merges the gitignored box.local.json override.
//
// It used to be `services/workerdeck/workerdeck.config.mjs` - a root folder in the CHECKOUT
// exporting a function, which branched on `AGENT_DEPLOYMENT` between two named machines and
// asserted the checkout's absolute path to keep one machine's `box.local.json` from turning it into the
// other. That shape was wrong twice over for a template: it hard-coded four real people's names
// and home directories into a public repo, and it put a per-Box fact outside the per-Box directory
// that exists for exactly that. Two Boxes on one machine could not have different profiles.
//
// THE FILE IS THE SWITCH. Present and non-empty means the agent surface boots; absent means it does
// not, in one log line, with the rest of the Box unaffected. That is what makes "install the agent
// assistant" a thing an operator (or an agent guiding one) DOES rather than an env var they learn:
// writing this file and restarting is the whole install.
//
// It is DATA, deliberately, and the trust logic is not here. Who may run as whom, and what a
// session's environment contains, live in typed and tested TypeScript in `workerdeck.host.ts` and
// `agent.mount.ts`. Keeping the machine facts here and the security decisions there is the same
// split the old file argued for and is worth restating: a mistake in this file should be a FAILED
// BOOT, never a silently widened permission. Hence `parseWorkerdeckConfig` below refuses anything
// it does not understand instead of defaulting it.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { boxJson, dataPath } from '@silkweave/box-core'

/** One declared profile. `name` is the contract with box.json's agentProfiles. */
export interface WorkerdeckProfile {
  /** The profile name a session is created under, e.g. `alice:claude`. Unique within the workerdeck section. */
  name: string
  engine: 'claude' | 'codex'
  /**
   * WHOSE profile this is. Not the same thing as `name`: `alice:claude` and `alice:codex` are both
   * Alice, and the per-person lookups (the Claude token, the MCP token file) key on this. Usually a
   * `users.id`, and it is what box.json's agentProfiles maps a user onto.
   */
  person: string
  /**
   * The engine's config dir: `CLAUDE_CONFIG_DIR` for claude, `CODEX_HOME` for codex.
   *
   * It must be the CONFIG DIR, not the home directory above it. Pointing it one level up is silent
   * - the directory exists, so the declaration is accepted and every session then runs with the
   * wrong config dir, reading none of that person's settings, memory, skills or credentials.
   */
  home: string
  /** Per-profile engine defaults. A service account is usually pinned read-only here. */
  defaults?: { model?: string; permissionMode?: string }
  /** Shown in the profile picker. */
  description?: string
  /**
   * A `KEY=value` file of MCP bearer tokens merged into THIS profile's session env (codex only).
   * Read at session-create time and never loaded into the server's own environment.
   */
  mcpTokensPath?: string
}

export interface WorkerdeckConfig {
  profiles: WorkerdeckProfile[]
  /** Declared profiles whose `home` does not exist yet - named at boot, never passed to the worker. */
  pending: WorkerdeckProfile[]
  /** Directories a session may be rooted at. Defaults to the checkout this server runs from. */
  cwdRoots: string[]
  /** Where parked/dormant session records live. Defaults to `<instance>/agent`. */
  stateDir: string
  /** Whether to expect `CLAUDE_TOKEN_<PERSON>` in boxJson().workerdeckTokens and say who is missing. */
  claudeTokens: boolean
  /** The job queue that runs agent triggers unattended (always on when the agent surface is). */
  queue: WorkerdeckQueueConfig
}

/**
 * box.json `workerdeck.queue`: WorkerDeck's job queue, which runs agent triggers. Every key is
 * optional; the defaults below keep one unattended run at a time with a one-hour watchdog.
 */
export interface WorkerdeckQueueConfig {
  /** Concurrent job sessions. */
  maxConcurrency: number
  /** Token cap per job run (input + output + cache); exceeding it fails the run. Null is off. */
  sessionTokenLimit: number | null
  /** Token budget per UTC day across all jobs; queued jobs wait for the next day. Null is off. */
  dailyTokenLimit: number | null
  /** Wall-clock cap per job run. */
  maxJobDurationMs: number
  /** How long finished jobs stay listed in the queue (the Box keeps its own run records). */
  retentionMs: number
  /**
   * The permission mode of an unattended run; nobody can answer an approval prompt.
   * - `auto` (default): the engine's classifier decides each tool call. Denials are reported on the
   *   run and as a runtime diagnostic, so the owner can allow the tool in the profile's settings.
   * - `dontAsk` (Claude only): runs what the profile's settings allow and denies everything else.
   * A run that still raises an approval is cancelled with the tool named.
   */
  permissionMode: UnattendedPermissionMode
}

export const UNATTENDED_PERMISSION_MODES = ['auto', 'dontAsk'] as const
export type UnattendedPermissionMode = (typeof UNATTENDED_PERMISSION_MODES)[number]

export const DEFAULT_QUEUE: WorkerdeckQueueConfig = {
  maxConcurrency: 1,
  sessionTokenLimit: null,
  dailyTokenLimit: null,
  maxJobDurationMs: 60 * 60_000,
  retentionMs: 7 * 24 * 60 * 60_000,
  permissionMode: 'auto',
}

function parseQueue(raw: unknown): WorkerdeckQueueConfig {
  if (raw === undefined) return { ...DEFAULT_QUEUE }
  if (!isRecord(raw)) return refuse('`queue` must be an object')
  const keys = ['maxConcurrency', 'sessionTokenLimit', 'dailyTokenLimit', 'maxJobDurationMs', 'retentionMs', 'permissionMode']
  for (const key of Object.keys(raw)) {
    if (!isNote(key) && !keys.includes(key)) refuse(`queue has unknown key ${JSON.stringify(key)}`)
  }
  const positive = (key: string, nullable: boolean): number | null | undefined => {
    const v = raw[key]
    if (v === undefined) return undefined
    if (v === null && nullable) return null
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return refuse(`queue.${key} must be a positive integer${nullable ? ' or null' : ''}`)
    return v
  }
  const queue = { ...DEFAULT_QUEUE }
  queue.maxConcurrency = positive('maxConcurrency', false) ?? queue.maxConcurrency
  const session = positive('sessionTokenLimit', true)
  if (session !== undefined) queue.sessionTokenLimit = session
  const daily = positive('dailyTokenLimit', true)
  if (daily !== undefined) queue.dailyTokenLimit = daily
  queue.maxJobDurationMs = positive('maxJobDurationMs', false) ?? queue.maxJobDurationMs
  queue.retentionMs = positive('retentionMs', false) ?? queue.retentionMs
  const mode = raw['permissionMode']
  if (mode !== undefined) {
    if (!UNATTENDED_PERMISSION_MODES.includes(mode as UnattendedPermissionMode)) {
      return refuse(`queue.permissionMode must be "auto" or "dontAsk" (got ${JSON.stringify(mode)})`)
    }
    queue.permissionMode = mode as UnattendedPermissionMode
  }
  return queue
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * `_`-prefixed keys are doc notes and are ignored, the same convention `browsers.json` uses. JSON
 * has no comments and this file is one an operator edits by hand, so the shipped example
 * (`docs/examples/workerdeck.json`) explains itself in keys the parser skips.
 */
const isNote = (key: string): boolean => key.startsWith('_')

const refuse = (why: string): never => {
  throw new Error(`box.json workerdeck: ${why}`)
}

function parseProfile(raw: unknown, index: number): WorkerdeckProfile {
  if (!isRecord(raw)) return refuse(`profiles[${index}] is not an object`)
  const at = `profiles[${index}]`
  const str = (key: string): string => {
    const v = raw[key]
    if (typeof v !== 'string' || v.trim() === '') return refuse(`${at}.${key} must be a non-empty string`)
    return v.trim()
  }
  const engine = raw['engine']
  if (engine !== 'claude' && engine !== 'codex') {
    return refuse(`${at}.engine must be "claude" or "codex" (got ${JSON.stringify(engine)})`)
  }
  const profile: WorkerdeckProfile = { name: str('name'), engine, person: str('person'), home: str('home') }
  for (const key of Object.keys(raw)) {
    if (isNote(key)) continue
    if (!['name', 'engine', 'person', 'home', 'defaults', 'description', 'mcpTokensPath'].includes(key)) {
      refuse(`${at} has unknown key ${JSON.stringify(key)}`)
    }
  }
  if (raw['description'] !== undefined) profile.description = str('description')
  if (raw['mcpTokensPath'] !== undefined) profile.mcpTokensPath = str('mcpTokensPath')
  if (raw['defaults'] !== undefined) {
    const d = raw['defaults']
    if (!isRecord(d)) return refuse(`${at}.defaults must be an object`)
    const defaults: { model?: string; permissionMode?: string } = {}
    if (d['model'] !== undefined) {
      if (typeof d['model'] !== 'string') return refuse(`${at}.defaults.model must be a string`)
      defaults.model = d['model']
    }
    if (d['permissionMode'] !== undefined) {
      if (typeof d['permissionMode'] !== 'string') return refuse(`${at}.defaults.permissionMode must be a string`)
      defaults.permissionMode = d['permissionMode']
    }
    profile.defaults = defaults
  }
  return profile
}

/**
 * Parse and validate the file's contents.
 *
 * Exported separately from the read so it can be tested against a literal. Every refusal is a
 * throw: an unreadable declaration must stop the boot of the AGENT SURFACE (the caller catches and
 * serves the Box without it) rather than resolve to a smaller, quieter set of profiles that looks
 * like it worked.
 *
 * `home`-does-not-exist is the one thing that is NOT a refusal. A declared profile whose config dir
 * is missing is a hard `createWorkerServer` failure, and one teammate who has not logged in yet
 * must not be an outage for everyone else - so those are split into `pending` and named at boot.
 */
export function parseWorkerdeckConfig(
  raw: unknown,
  ctx: { repoRoot: string; homeExists: (path: string) => boolean },
): WorkerdeckConfig {
  if (!isRecord(raw)) return refuse('must contain a JSON object')
  const list = raw['profiles']
  if (!Array.isArray(list)) return refuse('`profiles` must be an array')
  const declared = list.map(parseProfile)

  const seen = new Set<string>()
  for (const p of declared) {
    if (seen.has(p.name)) return refuse(`duplicate profile name ${JSON.stringify(p.name)}`)
    seen.add(p.name)
  }

  let cwdRoots = [ctx.repoRoot]
  if (raw['cwdRoots'] !== undefined) {
    const roots = raw['cwdRoots']
    if (!Array.isArray(roots) || roots.some((r) => typeof r !== 'string' || r.trim() === '')) {
      return refuse('`cwdRoots` must be an array of non-empty strings')
    }
    cwdRoots = (roots as string[]).map((r) => r.trim())
  }

  let stateDir = dataPath('agent')
  if (raw['stateDir'] !== undefined) {
    if (typeof raw['stateDir'] !== 'string' || raw['stateDir'].trim() === '') {
      return refuse('`stateDir` must be a non-empty string')
    }
    stateDir = raw['stateDir'].trim()
  }

  const claudeTokens = raw['claudeTokens'] ?? false
  if (typeof claudeTokens !== 'boolean') return refuse('`claudeTokens` must be a boolean')

  return {
    profiles: declared.filter((p) => ctx.homeExists(p.home)),
    pending: declared.filter((p) => !ctx.homeExists(p.home)),
    cwdRoots,
    stateDir,
    claudeTokens,
    queue: parseQueue(raw['queue']),
  }
}

/**
 * Read box.json's `workerdeck` section, or null when the Box has not installed the agent surface.
 *
 * A file that exists but declares NO profiles reads as "not installed" too, rather than booting a
 * worker nobody can create a session on: `createWorkerServer` with an empty profile list is a
 * surface that 400s every create, which is worse than an honest "off" in the log.
 */
export function readWorkerdeckConfig(ctx: { repoRoot: string }): WorkerdeckConfig | null {
  const raw = boxJson().workerdeck
  if (raw === null) return null
  const config = parseWorkerdeckConfig(raw, { repoRoot: ctx.repoRoot, homeExists: existsSync })
  if (config.profiles.length === 0 && config.pending.length === 0) return null
  return config
}

/** Where parked session records go, under the configured state dir. */
export const parkedDir = (config: WorkerdeckConfig): string => join(config.stateDir, 'parked')
