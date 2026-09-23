// The running Box's root `box.json`: where it is, the identity guards on its `agent` block, and the accessors everything else reads it
// through. No module-scope instance reads: every function here resolves `instanceDir()` when it
// is called, which is what lets typegen and the tests redirect a process before anything looks.
//
// The file's SHAPE, defaults and parser are in box-json.ts, which imports nothing so the vite
// config and the `box` CLI can load it too. This module is the half that knows about an instance.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  defaultBoxJson,
  parseBoxAgent,
  parseBoxJsonText,
  writeBoxJsonIfAbsent,
  readBoxConfig,
  type BoxJson,
} from './box-json.js'
import { configPath, configRoot, warehousePath } from './io.js'
import type { UserRole } from './users/types.js'

export { readBoxConfig } from './box-json.js'

export interface AgentIdentity { id: string; name: string; role: UserRole }

/** Root `box.json` - the one file a Box is configured in. */
export function boxJsonPath(): string {
  return join(configRoot(), 'box.json')
}
const localBoxJsonPath = (): string => join(configRoot(), 'box.local.json')
/** The identity lock stays beside the other generated files; nothing hand-edits it. */
const lockPath = (): string => configPath('agent-identity.lock.json')

// The supervisor's maintenance boot is a process-local mode. It deliberately never changes
// box.json or box.local.json, so a repair child cannot leave background work disabled after exit.
let maintenanceOverride = false

export function setMaintenanceOverride(enabled: boolean): void {
  maintenanceOverride = enabled
}

export function clearMaintenanceOverride(): void {
  maintenanceOverride = false
}

const label = (file: string): string => file.endsWith('box.local.json') ? 'box.local.json' : 'box.json'
const readRaw = (file: string): unknown => parseBoxJsonText(readFileSync(file, 'utf8'), label(file))
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The parsed configuration, read at call time and never cached.
 */
export function boxJson(): BoxJson {
  const file = boxJsonPath()
  const parsed = existsSync(file) || existsSync(localBoxJsonPath()) ? readBoxConfig(configRoot()) : defaultBoxJson()
  if (!maintenanceOverride) return parsed
  return {
    ...parsed,
    background: { automation: false, chatAgent: false, relay: false },
  }
}

/**
 * Read without creating files. Keyed on the `agent` block ONLY: a typo in `brand` or `server` is
 * refused by `boxJson()` with its key named, but it is not a renamed agent and cannot trip the
 * lock. The lock makes changing IDs fail across restarts too.
 */
export function agentIdentity(): AgentIdentity {
  const file = boxJsonPath()
  const lock = lockPath()
  const source = existsSync(file) || existsSync(localBoxJsonPath()) ? file : null
  if (!source && existsSync(lock)) throw new Error('box.json is missing; restore it before using this Box')
  let agent: AgentIdentity
  if (source) {
    const rootRaw = existsSync(file) ? readRaw(file) : {}
    const local = localBoxJsonPath()
    const localRaw = existsSync(local) ? readRaw(local) : {}
    const raw = isRecord(rootRaw) && isRecord(localRaw) && isRecord(rootRaw.agent) && isRecord(localRaw.agent)
      ? { ...rootRaw, agent: { ...rootRaw.agent, ...localRaw.agent } }
      : isRecord(localRaw) && localRaw.agent !== undefined ? { ...(isRecord(rootRaw) ? rootRaw : {}), agent: localRaw.agent } : rootRaw
    // A file that exists chose its identity there; an absent block is not a request for the default.
    if (!isRecord(raw) || raw['agent'] === undefined) {
      throw new Error(`box.json: requires agent: { id: lowercase slug, name: nonempty display name, role: "admin" or "member" }`)
    }
    agent = parseBoxAgent(raw.agent, 'box.json')
  } else {
    agent = defaultBoxJson().agent
  }
  if (existsSync(lock) && (readRaw(lock) as { id?: string }).id !== agent.id) {
    throw new Error('agent.id changed after initialization; renaming an existing agent is unsupported. Restore box.json')
  }
  return agent
}

export function systemUserId(): string { return agentIdentity().id }

/**
 * Persist defaults and bind the ID before opening the warehouse.
 */
export function ensureBoxConfig(): void {
  const file = boxJsonPath()
  const fresh = !existsSync(warehousePath())
  if (existsSync(file)) {
    // configured
  } else {
    if (!fresh) throw new Error('existing warehouse has no box.json; explicitly configure its existing agent identity and role before upgrading')
    writeBoxJsonIfAbsent(file)
  }
  if (!existsSync(file)) writeBoxJsonIfAbsent(file)
  readBoxConfig(configRoot())
  agentIdentity()
  // An existing database's explicit choice is bound only after bootstrap verifies its row.
  if (fresh) bindAgentIdentity()
}

export function bindAgentIdentity(): void {
  const agent = agentIdentity()
  const lock = lockPath()
  // `data/config/` is not a given any more: box.json lives above it, so a fresh Box has no reason
  // to have created it yet. (An ENOENT here also spells "lock", which db.ts's retry mistook for a
  // DuckDB file lock, so the first boot hung instead of failing - found by the core tests.)
  mkdirSync(dirname(lock), { recursive: true })
  try { writeFileSync(lock, `${JSON.stringify({ id: agent.id })}\n`, { flag: 'wx' }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  agentIdentity() // Validate a lock another process may have created.
}

// `editorUri` stayed in io.ts: four reference apps import it as `../../io.js`, and moving it
// would break every adopted copy of them with no downstream fix. Re-exported so this module's
// readers still find it beside the other settings accessors.
export { editorUri } from './io.js'
