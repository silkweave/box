// box.json's agentProfiles - users.id → the workerdeck profile that person's sessions run
// under, per engine. boxJson() merges the gitignored box.local.json override.
//
// The /agent proxy stamps the resolved name onto every session create; the browser chooses an
// ENGINE, never a profile name (see docs/SERVER.md § /agent). These names are the contract with the
// worker's own `profiles` list (box.json's workerdeck section) - a mismatch is
// `400 unknown profile: <name>` on every session start for that person.

import { boxJson } from './box-config.js'

/**
 * What one user maps to: `engine → profile name`.
 */
export type AgentProfileEntry = Record<string, string>
export type AgentProfilesFile = Record<string, AgentProfileEntry>

/**
 * The engine a new session prefers when the client names none: Claude, matching Builder. This is a
 * DEPLOYMENT PREFERENCE and nothing more - it decides ordering and the fallback, never what an
 * existing mapping means. The Work panel remembers each browser's last pick on top of it.
 */
export const DEFAULT_AGENT_ENGINE = 'claude'

/** Read box.json's agentProfiles map; an absent map means no mapping. */
export function readAgentProfiles(): AgentProfilesFile {
  return boxJson().agentProfiles
}

const enginesOf = (entry: AgentProfileEntry | undefined): Record<string, string> => entry ?? {}

/**
 * Whether this deployment pins sessions to per-user profiles at all. False on a single-operator
 * box (no mapping file): the worker resolves its one profile implicitly and nothing is stamped.
 * True means every agent user MUST map - an unmapped one is refused rather than silently run
 * under whichever profile the worker would pick.
 */
export function agentProfilesConfigured(): boolean {
  return Object.keys(readAgentProfiles()).length > 0
}

/**
 * The engines this user has a profile for, preferred first so a caller can take `[0]`.
 * Empty means unmapped.
 *
 * `[0]` is the preferred engine THIS USER ACTUALLY HAS, not the deployment default - someone
 * mapped only for claude (no `codex <them> login` yet) must still get a working start rather
 * than a 403 for an engine they were never declared for.
 */
export function agentEnginesFor(userId: string): string[] {
  const engines = Object.keys(enginesOf(readAgentProfiles()[userId]))
  return engines.sort((a, b) =>
    a === DEFAULT_AGENT_ENGINE ? -1 : b === DEFAULT_AGENT_ENGINE ? 1 : a.localeCompare(b),
  )
}

/** The engine a start defaults to for this user: their preferred available one. */
export function preferredAgentEngine(userId: string): string {
  return agentEnginesFor(userId)[0] ?? DEFAULT_AGENT_ENGINE
}

/**
 * The profile a user's sessions run under on `engine`, or null when none is declared.
 *
 * An unknown engine returns null rather than falling back to the default: a request for codex that
 * quietly ran on Claude would bill the wrong subscription and run with the wrong tools, and the
 * caller would have no way to tell.
 */
export function agentProfileFor(userId: string, engine: string = DEFAULT_AGENT_ENGINE): string | null {
  return enginesOf(readAgentProfiles()[userId])[engine] ?? null
}

/** Every profile name this user could run under - for display, never for stamping. */
export function agentProfileMapFor(userId: string): Record<string, string> {
  return enginesOf(readAgentProfiles()[userId])
}
