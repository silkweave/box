// The Box's own MCP server for a server-owned agent session (chat agent turns, agent trigger jobs).
//
// The session gets `box` (this Box's /mcp) authenticated as the principal the session acts for:
// the chat agent as the system principal, a trigger job as its run_as user. A profile entry of the
// same name is replaced for that session, never run beside it (Claude Code 2.1.293: a session
// `--mcp-config` server wins over a user-scope one of the same name), so a person whose own
// .claude.json lists `box` keeps that working outside the Box.
//
// The token is the principal's existing one, revealed rather than rotated: other holders of it (a
// Codex profile's env file, scripts, the person's own Claude config) keep working. Only a principal
// with no token yet gets one issued, atomically (`sessionPrincipalToken`); a revoked principal gets
// none and the session is refused. Like a token in the profile's own config or environment, it is
// readable by any shell command the session is allowed to run.
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
import { MCP_GRANT_HEADER, mcpConnectionGrant, mcpConnections, sessionPrincipalToken, toolsetSessionOptions } from '@silkweave/box-core'
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
 * Session options carrying `box` as `principalId`, plus the connections and tool lists of `toolset`
 * (core agent-tools.ts) when one is named, for an engine that takes session servers. `via` names
 * the room or run in the connections' audit log.
 * `disallowed` is the caller's own floor, kept on every outcome. Throws when any part cannot be
 * granted as configured, including a principal session on a profile that reports no session
 * servers; only a session acting as nobody (empty `principalId`) may run with the floor alone.
 */
export async function boxMcpSessionOptions(
  principalId: string,
  caps: SessionToolCaps,
  disallowed: readonly string[] = [],
  toolset: string | null = null,
  via: string | null = null,
): Promise<BoxMcpOptions> {
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
    return floor.length > 0 ? { disallowedTools: floor } : {}
  }
  const mcpServers: NonNullable<BoxMcpOptions['mcpServers']> = {}
  const allowedTools: string[] = []
  const disallowedTools: string[] = [...floor]
  let token: string | null = null
  if (principalId) {
    // The token goes to the literal 127.0.0.1 address: only when that address is this server
    // (loopback-guard.ts carries the incident). Cached briefly, so a burst of sessions costs one probe.
    const loopback = await verifyLoopback()
    if (!loopback.ours) throw new Error(`not sending ${principalId}'s token to loopback: ${loopback.detail}`)
    token = await sessionPrincipalToken(principalId)
    mcpServers[BOX_MCP_SERVER] = {
      type: 'http',
      url: `http://127.0.0.1:${servicePort()}/mcp?passthrough=0`,
      headers: { Authorization: `Bearer ${token}` },
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
    if (!token) throw new Error(`toolset "${toolset}" attaches connections, which a session acting as nobody cannot reach`)
  }
  if (directory && token) {
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
          Authorization: `Bearer ${token}`,
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
  if (Object.keys(mcpServers).length === 0) return disallowedTools.length > 0 ? { disallowedTools } : {}
  return {
    mcpServers,
    ...(allowedTools.length > 0 ? { allowedTools } : {}),
    ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
  }
}
