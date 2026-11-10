// The Box's own MCP server for a server-owned agent session (chat agent turns, feature agent jobs,
// agent trigger jobs).
//
// The session gets `box` (this Box's /mcp) authenticated as the principal the session acts for:
// the chat agent as the system principal, a trigger job as its run_as user. A profile entry of the
// same name is replaced for that session, never run beside it (Claude Code 2.1.293: a session
// `--mcp-config` server wins over a user-scope one of the same name), so a person whose own
// .claude.json lists `box` keeps that working outside the Box.
//
// The bearer is a session credential (core auth/session-credential.ts), never the principal's
// reusable token: `bx-session-<jws>` for this one session, naming what it serves (`scope`: the room
// or job) and its toolset, which narrows every transport that accepts it. It stops working when the
// caller closes the session (`closeBoxMcpSession`), when its lifetime bound passes, on a restart,
// and when a policy revision's recheck refuses it (the principal is gone or revoked, or its
// toolset changed since the session started). A revoked principal is refused at start. It is
// still readable by any shell command the session may run; serving sessions lose the shell when
// they move to the provider engine.
//
// The Box server's URL carries `?passthrough=0`: a server-owned session never gets the `mcp`
// recipe's passthrough tools on `box`, only the connections its toolset grants. Each of those is a
// second server at `/mcp/connections/<id>` on the same loopback address with the same token (the
// recipe's relay adds the upstream credential), plus an `x-box-via` header naming the room or run
// for the audit log. No upstream credential enters a session.
//
// Fail closed: every failure (a revoked principal, a toolset the engine cannot enforce, loopback
// that is not this server) throws, so a session never starts with fewer restrictions or a
// different identity than it was configured with.
//
// Only engines that take per-session servers get it (the profile's `sessionMcpServers`: Claude,
// Codex). The tool lists follow the engine's `toolFilters`: Claude honours every entry, Codex only
// MCP entries (`mcp__<server>` / `mcp__<server>__<Tool>`), and an engine with none gets no servers,
// because the floor below could not be enforced there.

import type { CreateSessionRequest, ProfileInfo } from '@workerdeck/protocol'
import {
  closeSessionCredential,
  MCP_GRANT_HEADER,
  mcpConnectionGrant,
  mcpConnections,
  onPolicyRevision,
  openSessionCredential,
  scopeCoverageProblem,
  recheckLiveSessions,
  resolvePrincipalById,
  toolsetProblem,
  toolsetSessionOptions,
} from '@silkweave/box-core'
import { boxToolNames } from './box-tools.js'
import { servicePort, verifyLoopback } from './loopback-guard.js'

/** The server name the Box's own MCP surface has in an agent session (`mcp__box__<Tool>`). */
export const BOX_MCP_SERVER = 'box'

/**
 * Box MCP tools no server-owned session may call, whoever it acts for: service restart and the
 * user-management controls. The rest is auto-approved (`mcp__box`); the principal's own role still
 * decides what each call may do. Owner decision 2026-10-09 (chat), extended to trigger jobs.
 */
export const BOX_MCP_FLOOR: readonly string[] = ['ServiceRestart', 'UserDelete', 'UserSetRole', 'UserAccessRevoke']

export type BoxMcpOptions = Pick<CreateSessionRequest, 'mcpServers' | 'allowedTools' | 'disallowedTools'>

/** What a session is started with: its options, and the credential the caller closes at its end. */
export interface BoxMcpSession {
  options: BoxMcpOptions
  /** The session credential's id, or null for a session acting as nobody. */
  sid: string | null
  /** When the credential stops working (ms), or null without one. A caller retires the session first. */
  exp: number | null
}

export interface BoxMcpSessionInput {
  /** The principal the session acts for; empty for one acting as nobody (the floor only). */
  principalId: string
  caps: SessionToolCaps
  /** The caller's own floor, kept on every outcome. */
  disallowed?: readonly string[]
  toolset?: string | null
  /** The room or run in the connections' audit log. */
  via?: string | null
  /** What the session serves: `room:<id>` or `job:<app>:<id>`. Session controls check it. */
  scope: string
  /** Upper bound of the session's life (default 12 h); its credential stops working after it. */
  ttlMs?: number
}

/** Default lifetime bound of a session credential. */
export const BOX_MCP_SESSION_TTL_MS = 12 * 60 * 60_000

let sweeping = false
/** Recheck live sessions on every policy revision (registered with the first session, serving or Work). */
export function sweepOnPolicyRevision(): void {
  if (sweeping) return
  sweeping = true
  onPolicyRevision(() => {
    void recheckLiveSessions().catch((error: unknown) => console.error('[box-mcp] session recheck failed:', error))
  })
}

/** End a session's credential (idempotent; null or undefined is a no-op). */
export function closeBoxMcpSession(session: Pick<BoxMcpSession, 'sid'> | null | undefined): void {
  if (session?.sid) closeSessionCredential(session.sid)
}

/** What a toolset gives a session, as a comparable string (a changed toolset ends its sessions). */
function toolsetDigest(toolset: string | null): string {
  if (!toolset) return ''
  try {
    return JSON.stringify(toolsetSessionOptions(toolset))
  } catch (error) {
    return `problem:${error instanceof Error ? error.message : String(error)}`
  }
}

/** What a profile's engine takes, from the worker's capability report. */
export interface SessionToolCaps {
  sessionMcpServers: boolean
  toolFilters: 'all' | 'mcp' | 'none'
}

/** No session servers and no filters: an unknown profile, or a worker that is down. */
export const NO_SESSION_TOOLS: SessionToolCaps = { sessionMcpServers: false, toolFilters: 'none' }

/** A profile's capabilities as the Box uses them; none for a profile the worker does not report. */
export function sessionToolCapsOf(info: Pick<ProfileInfo, 'capabilities'> | undefined): SessionToolCaps {
  const caps = info?.capabilities
  if (!caps) return NO_SESSION_TOOLS
  return { sessionMcpServers: caps.sessionMcpServers === true, toolFilters: caps.toolFilters ?? 'none' }
}

const isMcpEntry = (tool: string): boolean => tool.startsWith('mcp__')

/**
 * Why `toolset` cannot be granted on an engine with these capabilities, or null when it can. A
 * deny the engine cannot honour refuses the toolset rather than being dropped, so a session never
 * gets more than the toolset meant.
 */
export function toolsetEngineProblem(toolset: string, caps: SessionToolCaps): string | null {
  if (!caps.sessionMcpServers) return `toolset "${toolset}" needs a profile that takes session MCP servers; this one does not`
  if (caps.toolFilters === 'none') return `toolset "${toolset}" needs an engine that honours tool filters; this one does not`
  if (caps.toolFilters === 'mcp') {
    const { disallowedTools } = toolsetSessionOptions(toolset)
    const other = disallowedTools.filter((t) => !isMcpEntry(t))
    if (other.length > 0) {
      return `toolset "${toolset}" denies ${other.join(', ')}, which this engine cannot remove (it filters MCP tools only); use a Claude profile or drop those entries`
    }
  }
  return null
}

/**
 * Session options carrying `box` as `principalId` with a fresh session credential, plus the
 * connections and tool lists of `toolset` (core agent-tools.ts) when one is named, for an engine
 * that takes session servers. The caller closes the returned session when it ends
 * (`closeBoxMcpSession`). Throws when any part cannot be granted as configured, including a
 * principal session on a profile that reports no session servers; only a session acting as nobody
 * (empty `principalId`) may run with the floor alone. Nothing stays open on a throw.
 */
export async function boxMcpSessionOptions(input: BoxMcpSessionInput): Promise<BoxMcpSession> {
  const { principalId, caps, scope } = input
  const disallowed = input.disallowed ?? []
  const toolset = input.toolset ?? null
  const via = input.via ?? null
  // The caller's floor, as far as the engine can carry it. A floor entry it cannot honour fails
  // the session rather than vanishing.
  const unhonoured = caps.toolFilters === 'all' ? [] : disallowed.filter((t) => caps.toolFilters === 'none' || !isMcpEntry(t))
  if (unhonoured.length > 0) throw new Error(`this engine cannot remove ${unhonoured.join(', ')} (tool filters: ${caps.toolFilters})`)
  const floor = [...disallowed]
  const problem = toolset ? toolsetEngineProblem(toolset, caps) : null
  if (problem) throw new Error(problem)
  if (!caps.sessionMcpServers || caps.toolFilters === 'none') {
    // A session acting as a principal must carry the Box server, its floor and the loopback
    // check. "No capabilities" is also what an unknown profile or an unreachable worker reports,
    // so it is refused rather than run on whatever MCP config the profile itself carries.
    if (principalId) throw new Error(`the profile reports no session MCP servers or tool filters (unknown profile, or the worker is unreachable); not starting a session as ${principalId} without the Box server and its floor`)
    return { options: floor.length > 0 ? { disallowedTools: floor } : {}, sid: null, exp: null }
  }
  const mcpServers: NonNullable<BoxMcpOptions['mcpServers']> = {}
  const allowedTools: string[] = []
  const disallowedTools: string[] = [...floor]
  let credential: string | null = null
  let sid: string | null = null
  let exp: number | null = null
  try {
    if (principalId) {
      // The credential goes to the literal 127.0.0.1 address: only when that address is this server
      // (loopback-guard.ts carries the incident). Cached briefly, so a burst of sessions costs one probe.
      const loopback = await verifyLoopback()
      if (!loopback.ours) throw new Error(`not sending ${principalId}'s credential to loopback: ${loopback.detail}`)
      const principal = await resolvePrincipalById(principalId)
      if (!principal) throw new Error(`${principalId} is revoked or does not exist; not starting a session as them`)
      const grants = toolsetDigest(toolset)
      sweepOnPolicyRevision()
      const opened = openSessionCredential({
        sub: principalId,
        kind: 'serving',
        scope,
        toolset,
        ttlMs: input.ttlMs ?? BOX_MCP_SESSION_TTL_MS,
        recheck: async () => {
          if (!(await resolvePrincipalById(principalId))) return `${principalId} is revoked or gone`
          if (toolset && toolsetProblem(toolset)) return toolsetProblem(toolset)
          if (toolsetDigest(toolset) !== grants) return `toolset "${toolset}" changed since the session started`
          // Coverage at the destination the session serves (a room's readers and seat, PERMISSIONS 7.2).
          return scopeCoverageProblem(scope, principalId, toolset)
        },
      })
      credential = opened.credential
      sid = opened.sid
      exp = opened.exp
      mcpServers[BOX_MCP_SERVER] = {
        type: 'http',
        url: `http://127.0.0.1:${servicePort()}/mcp?passthrough=0`,
        headers: { Authorization: `Bearer ${credential}` },
      }
      allowedTools.push(`mcp__${BOX_MCP_SERVER}`)
      disallowedTools.push(...BOX_MCP_FLOOR.map((tool) => `mcp__${BOX_MCP_SERVER}__${tool}`))
    }
    const extra = toolset ? toolsetSessionOptions(toolset) : null
    // Connections: the person's own (their audience, run without asking, since they could call these
    // tools themselves) plus the toolset's (granted by the toolset, whatever the audience). An agent
    // principal has no own connections, and neither does a session under a built-in toolset that
    // keeps only some Box tools (a drafting job for people outside the team). A toolset's deny list applies to both.
    const directory = mcpConnections()
    const own = principalId && directory && !extra?.boxTools ? await directory.personal(principalId) : []
    const granted = extra?.servers ?? []
    if (granted.length > 0) {
      if (!directory) throw new Error(`toolset "${toolset}" attaches ${granted.join(', ')}, but this Box has no MCP connections (the mcp recipe)`)
      if (!credential) throw new Error(`toolset "${toolset}" attaches connections, which a session acting as nobody cannot reach`)
    }
    if (directory && credential) {
      for (const id of new Set([...granted, ...own])) {
        const viaToolset = granted.includes(id)
        const problem = await directory.sessionProblem(id)
        if (problem) {
          // A toolset's connection fails the session closed; a person's own one is just left out.
          if (viaToolset) throw new Error(`toolset "${toolset}": ${problem}`)
          continue
        }
        mcpServers[id] = {
          type: 'http',
          url: `http://127.0.0.1:${servicePort()}/mcp/connections/${id}`,
          headers: {
            Authorization: `Bearer ${credential}`,
            ...(via ? { 'x-box-via': via } : {}),
            ...(viaToolset ? { [MCP_GRANT_HEADER]: mcpConnectionGrant(principalId, id) } : {}),
          },
        }
        if (!viaToolset) allowedTools.push(`mcp__${id}`)
      }
    }
    if (toolset && extra) {
      allowedTools.push(...extra.allowedTools)
      disallowedTools.push(...extra.disallowedTools)
      if (extra.boxTools) {
        // A built-in toolset keeps only these Box tools: deny every other one by name. Without the
        // live list that could not be enforced, so the session is refused.
        const all = boxToolNames()
        if (all.length === 0) throw new Error(`toolset "${toolset}" keeps only some Box tools, but the Box tool list is empty, so the rest could not be denied`)
        const keep = new Set(extra.boxTools)
        disallowedTools.push(...all.filter((t) => !keep.has(t)).map((t) => `mcp__${BOX_MCP_SERVER}__${t}`))
      }
    }
  } catch (error) {
    if (sid) closeSessionCredential(sid)
    throw error
  }
  if (Object.keys(mcpServers).length === 0) return { options: disallowedTools.length > 0 ? { disallowedTools } : {}, sid, exp }
  return {
    options: {
      mcpServers,
      ...(allowedTools.length > 0 ? { allowedTools } : {}),
      ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
    },
    sid,
    exp,
  }
}
