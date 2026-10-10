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
// with no token yet gets one issued. Like a token in the profile's own config or environment, it is
// readable by any shell command the session is allowed to run.
//
// Only engines that take per-session servers get it (the profile's `sessionMcpServers`: Claude,
// Codex). The tool lists follow the engine's `toolFilters`: Claude honours every entry, Codex only
// MCP entries (`mcp__<server>` / `mcp__<server>__<Tool>`), and an engine with none gets no servers,
// because the floor below could not be enforced there.

import type { CreateSessionRequest, ProfileInfo } from '@workerdeck/protocol'
import { issuePrincipalToken, revealPrincipalToken, toolsetSessionOptions } from '@silkweave/box-core'
import { servicePort } from './loopback-guard.js'

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
 * Session options carrying `box` as `principalId`, plus the servers and tool lists of `toolset`
 * (core agent-tools.ts) when one is named, for an engine that takes session servers.
 * `disallowed` is the caller's own floor, kept on every outcome. On a failure the session starts
 * without the part that failed (the Box's server, or the toolset) and `onError` hears why; it
 * never starts with more than it was granted.
 */
export async function boxMcpSessionOptions(
  principalId: string,
  caps: SessionToolCaps,
  disallowed: readonly string[] = [],
  onError: (message: string) => void = () => undefined,
  toolset: string | null = null,
): Promise<BoxMcpOptions> {
  // The caller's floor, as far as the engine can carry it. A floor entry it cannot honour fails
  // the session rather than vanishing.
  const unhonoured = caps.toolFilters === 'all' ? [] : disallowed.filter((t) => caps.toolFilters === 'none' || !isMcpEntry(t))
  if (unhonoured.length > 0) throw new Error(`this engine cannot remove ${unhonoured.join(', ')} (tool filters: ${caps.toolFilters})`)
  const floor = [...disallowed]
  const without: BoxMcpOptions = floor.length > 0 ? { disallowedTools: floor } : {}
  if (!caps.sessionMcpServers || caps.toolFilters === 'none') {
    if (toolset) onError(toolsetEngineProblem(toolset, caps) ?? `toolset "${toolset}" cannot be granted on this engine`)
    return without
  }
  const mcpServers: NonNullable<BoxMcpOptions['mcpServers']> = {}
  const allowedTools: string[] = []
  const disallowedTools: string[] = [...floor]
  if (principalId) {
    try {
      const token = (await revealPrincipalToken(principalId)) ?? (await issuePrincipalToken(principalId))
      mcpServers[BOX_MCP_SERVER] = {
        type: 'http',
        url: `http://127.0.0.1:${servicePort()}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      }
      allowedTools.push(`mcp__${BOX_MCP_SERVER}`)
      disallowedTools.push(...BOX_MCP_FLOOR.map((tool) => `mcp__${BOX_MCP_SERVER}__${tool}`))
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }
  if (toolset) {
    try {
      const problem = toolsetEngineProblem(toolset, caps)
      if (problem) throw new Error(problem)
      const extra = toolsetSessionOptions(toolset)
      Object.assign(mcpServers, extra.mcpServers)
      allowedTools.push(...extra.allowedTools)
      disallowedTools.push(...extra.disallowedTools)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }
  if (Object.keys(mcpServers).length === 0) return disallowedTools.length > 0 ? { disallowedTools } : {}
  return {
    mcpServers,
    ...(allowedTools.length > 0 ? { allowedTools } : {}),
    ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
  }
}
