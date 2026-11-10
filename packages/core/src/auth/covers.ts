// Coverage (PERMISSIONS 5.4, decision B): whether a reader may see what an agent produced. The
// reader covers the agent when, on every area, the reader's level is at least the agent's (on the
// destination's own area, when the destination is an area's readers, read is enough); an agent
// with admin authority is read only by admins; and for every outside MCP connection the agent can
// use where its output lands (its toolset's connections there), the reader is in that connection's
// audience. Agent principals have no connections of their own (mcp-connections.ts `personal`), so
// the connections always come from the destination's toolset.
//
// Reader and agent are judged at one generation (BOX-Review d613f4e finding 4): the agent's role is
// read at the reader's access generation, and a definition that generation does not hold fails
// closed instead of reading as "no areas".

import { levelCovers, levelOf, type Access } from './access.js'
import type { AccessLevel } from './levels.js'
import { resolvePrincipalWithRevision } from './principal.js'
import { accessForRoleAt, knownAreas } from './roles.js'
import { policyRevision } from './policy-revision.js'
import { mcpConnectionAudienceIncludes } from '../mcp-connections.js'

/** One reason a reader does not cover an agent. */
export type CoverageGap =
  | { kind: 'area'; area: string; needed: AccessLevel; held: AccessLevel }
  | { kind: 'admin' }
  | { kind: 'connection'; connection: string }

/** A reader as coverage judges it: who (for connection audiences) and with what access. */
export interface CoverageReader {
  id: string
  kind: string
  access: Access
}

/** Where the output lands, as far as coverage cares. */
export interface CoverageOptions {
  /**
   * The destination is read by an area's readers (artifacts, an open room): on that
   * area the reader needs read, not the agent's level. Reading the area is reading what the agent
   * wrote there; other areas the agent reaches still compare exactly (Toby, 2026-11-10).
   */
  destinationArea?: string
}

/** The level `reader` needs on `area` to cover an agent holding `agentLevel` there. */
function neededLevel(area: string, agentLevel: AccessLevel, opts: CoverageOptions): AccessLevel {
  return area === opts.destinationArea && agentLevel === 'write' ? 'read' : agentLevel
}

/**
 * Every reason `reader` does not cover an agent with `agent` access that can use `connections`
 * where its output lands; empty when the reader covers it. Areas in `knownAreas()` order, then
 * admin authority, then connections in the order given.
 */
export function coverageGaps(reader: CoverageReader, agent: Access, connections: readonly string[] = [], opts: CoverageOptions = {}): CoverageGap[] {
  const gaps: CoverageGap[] = []
  for (const area of knownAreas()) {
    const needed = neededLevel(area, levelOf(agent, area), opts)
    const held = levelOf(reader.access, area)
    if (!levelCovers(held, needed)) gaps.push({ kind: 'area', area, needed, held })
  }
  if (agent.admin && !reader.access.admin) gaps.push({ kind: 'admin' })
  for (const connection of new Set(connections)) {
    if (!mcpConnectionAudienceIncludes(connection, { id: reader.id, kind: reader.kind, admin: reader.access.admin })) gaps.push({ kind: 'connection', connection })
  }
  return gaps
}

/** Whether `reader` covers the agent (no gap). */
export function covers(reader: CoverageReader, agent: Access, connections: readonly string[] = [], opts: CoverageOptions = {}): boolean {
  return coverageGaps(reader, agent, connections, opts).length === 0
}

/** Whether `reader` covers `agent` on areas and admin authority (no connections at the destination). */
export function coversAccess(reader: Access, agent: Access): boolean {
  if (agent.admin && !reader.admin) return false
  return knownAreas().every((a) => levelCovers(levelOf(reader, a), levelOf(agent, a)))
}

/** A gap in words: "crm write", "admin authority", "the stripe connection". */
export function describeGap(gap: CoverageGap): string {
  if (gap.kind === 'area') return `${gap.area} ${gap.needed}`
  if (gap.kind === 'admin') return 'admin authority'
  return `the ${gap.connection} connection`
}

/**
 * The access of the principal an agent job acts as, at exactly `generation`: null when it no longer
 * resolves or its role is not defined there (fail closed), 'stale' when its identity was read at
 * another committed revision or the published policy moved off `generation` (the caller re-admits
 * and retries). The identity and the revision come from one snapshot (resolvePrincipalWithRevision).
 */
export async function agentAccessAt(principalId: string, generation: number): Promise<Access | null | 'stale'> {
  if (policyRevision() !== generation) return 'stale'
  const { principal, revision } = await resolvePrincipalWithRevision(principalId)
  if (revision !== generation || policyRevision() !== generation) return 'stale'
  return principal ? accessForRoleAt(principal.role, generation) : null
}
