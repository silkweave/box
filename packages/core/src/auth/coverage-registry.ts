// The coverage registries, in a leaf module (feature barrels register at import, and the policy
// service sits in an import cycle with the agents and the warehouse): coverage providers (a
// feature's destinations), area destinations, and session-scope coverage checks.

import type { CoverageGap } from './covers.js'
import type { PolicyTx } from '../warehouse/pg/boot.js'
import type { RoleInput } from './roles.js'

/** A policy change. Every part is optional; parts apply together or not at all. */
export interface PolicyChange {
  /** Names the change in logs and the journal. */
  reason?: string
  /** Who asks (audit columns). */
  actor?: string
  roles?: { upsert?: RoleInput[] }
  /** User id to role id (people; an agent's role is its config, `agents`). */
  users?: Record<string, string>
  /** A new user's first role (`users`): it is activated in this commit; open rooms are rechecked. */
  create?: boolean
  /** People whose revoked status returns to active in this commit (their token stays revoked until the caller issues one); seats their return would break are disabled like a new user's. */
  reactivate?: string[]
  /** Agent id to role id: rewrites `data/config/agents/<id>.md` from the journal. */
  agents?: Record<string, string>
  /** Toolset id to its stored entry (null removes it): box.local.json, from the journal. */
  toolsets?: Record<string, Record<string, unknown> | null>
  /** Provider-specific parts, by provider id (chat: room mode, members, seats). */
  domains?: Record<string, unknown>
}

/** Who reads a destination: member ids (optionally only those with read on `area`), or an area's readers. */
export type DestinationReaders =
  | { kind: 'members'; ids: readonly string[]; area?: string; joining?: readonly string[] }
  | { kind: 'area'; area: string }

/** Where an agent's output lands, as a provider reports it. */
export interface CoverageDestination {
  /** Stable key, prefixed by the provider (`chat:<room id>`). */
  key: string
  /** For people: `#pipeline`, `the artifacts`. */
  label: string
  readers: DestinationReaders
  /** The agents that write there and the outside connections each can use there. */
  agents: readonly { id: string; connections: readonly string[] }[]
}

/** One reader who would not cover one agent at one destination. */
export interface CoverageViolation {
  destination: string
  label: string
  reader: string
  /** The reader's role id after the change. */
  readerRole: string
  agent: string
  gaps: CoverageGap[]
  /** A members destination can drop the reader (`confirm: 'remove-members'`); an area cannot, and a joining member is simply refused. */
  removable: boolean
}

/** What a feature tells the policy service about its destinations. */
export interface CoverageProvider {
  /** Destinations as they would be after `change` (core applies roles, users, agents and toolsets). */
  destinations(tx: PolicyTx, change: PolicyChange, ctx: CoverageContext): Promise<CoverageDestination[]>
  /** Write this provider's part of `change`, and remove `removals` (destination key to reader ids). Returns work for after the commit. */
  apply?(tx: PolicyTx, change: PolicyChange, removals: ReadonlyMap<string, readonly string[]>): Promise<(() => void) | void>
  /** Disable what `violations` (this provider's) concern until an admin resolves it (boot check, a new user). Returns work for after the commit. */
  disable?(tx: PolicyTx, violations: readonly CoverageViolation[], messages: readonly string[]): Promise<(() => void) | void>
}

/** What a provider may ask while it lists destinations. */
export interface CoverageContext {
  /** Whether `id` is a configured, active agent after the change. */
  isAgent(id: string): boolean
  /** The connections toolset `id` attaches after the change. */
  connections(toolset: string | null | undefined): string[]
}

const providers = new Map<string, CoverageProvider>()

/** The registered providers (the policy service). */
export function coverageProviders(): CoverageProvider[] {
  return [...providers.values()]
}

/** Register a feature's destinations (at import, like a built-in toolset). Returns the unregister. */
export function registerCoverageProvider(id: string, provider: CoverageProvider): () => void {
  if (providers.has(id)) throw new Error(`coverage provider "${id}" registered twice`)
  providers.set(id, provider)
  return () => {
    if (providers.get(id) === provider) providers.delete(id)
  }
}


// Area destinations: features whose agent output is read by everyone with read on the area (a feature's
// file tree, artifacts). An agent's write handler call there is checked against
// every area reader (the server's guard asks `areaDestinationProblem`).
const areaDestinations = new Map<string, string>()

/** Declare `area` an area destination (at import). */
export function registerAreaDestination(area: string, label: string): void {
  areaDestinations.set(area, label)
}

/** The registered area destinations (tests, docs). */
export function areaDestinationList(): string[] {
  return [...areaDestinations.keys()].sort()
}

/** The label of area destination `area`, or undefined when it is not one. */
export function areaDestinationLabel(area: string): string | undefined {
  return areaDestinations.get(area)
}

// Session scopes: a live session serving a destination (`room:<id>`) ends when its agent stops
// being covered there (recheckLiveSessions on every revision, box-mcp.ts).
type ScopeCheck = (rest: string, agentId: string, toolset: string | null) => Promise<string | null>
const scopeChecks = new Map<string, ScopeCheck>()

/** Register the coverage check for session scopes starting with `prefix` (`room:`). */
export function registerScopeCoverage(prefix: string, check: ScopeCheck): () => void {
  scopeChecks.set(prefix, check)
  return () => {
    if (scopeChecks.get(prefix) === check) scopeChecks.delete(prefix)
  }
}

/** The registered scope checks. */
export function scopeCoverageChecks(): [string, ScopeCheck][] {
  return [...scopeChecks.entries()]
}
