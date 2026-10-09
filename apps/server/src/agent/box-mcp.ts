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
// Only engines that take per-session servers (Claude) get it. Codex reads `box` from its
// config.toml with the token from the profile's mcpTokensPath file, which is per person already.

import type { CreateSessionRequest } from '@workerdeck/protocol'
import { issuePrincipalToken, revealPrincipalToken } from '@silkweave/box-core'
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

/**
 * Session options carrying `box` as `principalId`, for an engine that takes session servers.
 * `disallowed` is the caller's own floor, kept on every outcome. On any failure the session starts
 * without `box` (the profile's own servers still apply) and `onError` hears why.
 */
export async function boxMcpSessionOptions(
  principalId: string,
  sessionMcpServers: boolean,
  disallowed: readonly string[] = [],
  onError: (message: string) => void = () => undefined,
): Promise<BoxMcpOptions> {
  const floor = [...disallowed]
  const without: BoxMcpOptions = floor.length > 0 ? { disallowedTools: floor } : {}
  if (!sessionMcpServers || !principalId) return without
  try {
    const token = (await revealPrincipalToken(principalId)) ?? (await issuePrincipalToken(principalId))
    return {
      mcpServers: {
        [BOX_MCP_SERVER]: {
          type: 'http',
          url: `http://127.0.0.1:${servicePort()}/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
      allowedTools: [`mcp__${BOX_MCP_SERVER}`],
      disallowedTools: [...floor, ...BOX_MCP_FLOOR.map((tool) => `mcp__${BOX_MCP_SERVER}__${tool}`)],
    }
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error))
    return without
  }
}
