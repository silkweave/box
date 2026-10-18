// The MCP connection directory port: the outside MCP servers this Box relays (Stripe, Linear, ...),
// as toolsets and agent sessions see them. Core owns the grant (agent-tools.ts toolsets); the `mcp`
// recipe owns the connections, their credentials and the relay, and registers itself here from its
// server module (SEAM: the dependent registers into the dependency).
//
// Without the recipe the directory is empty: toolsets can still carry deny lists and built-ins, a
// toolset naming a server is skipped with the reason, and `/mcp/connections/<id>` answers 404.
//
// A session never holds an upstream credential. It reaches a connection at
// `http://127.0.0.1:<port>/mcp/connections/<id>` with its own principal's Box token (box-mcp.ts), and
// the recipe's relay adds the credential, applies the tool levels and writes the audit row.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Principal } from './auth/principal.js'
import { authSecret } from './auth/secrets.js'

/** A connection as core sees it: enough to validate and label a toolset's `servers`. */
export interface McpConnectionEntry {
  id: string
  label: string
}

/** One request to a connection's session endpoint, already authenticated by core. */
export interface McpConnectionRequest {
  req: IncomingMessage & { body?: unknown }
  res: ServerResponse
  /** The connection id from the path. */
  id: string
  principal: Principal
}

export interface McpConnectionDirectory {
  /** Every configured connection (sync: read from box.json on each call). */
  list(): McpConnectionEntry[]
  /**
   * Why a session may not start with this connection, or null when it may. Fail closed: a
   * connection that does not exist, has no credential or needs reconnecting refuses the session;
   * an unreachable one starts it (calls then fail with the reason).
   */
  sessionProblem(id: string): Promise<string | null>
  /**
   * The connections a person may use themselves (their audience), which a session acting as that
   * person gets beside its toolset's. None for an agent principal: its toolset is its whole grant.
   */
  personal(principalId: string): Promise<string[]>
  /** Serve `POST /mcp/connections/<id>` (the session endpoint) for an authenticated principal. */
  serve(request: McpConnectionRequest): Promise<void>
}

let directory: { owner: string; port: McpConnectionDirectory } | null = null

/** Register the directory (the `mcp` recipe, from onModuleInit). One per Box. Returns the unregister. */
export function registerMcpConnections(owner: string, port: McpConnectionDirectory): () => void {
  if (directory) throw new Error(`MCP connection directory registered twice ("${directory.owner}", then "${owner}")`)
  const entry = { owner, port }
  directory = entry
  return () => {
    if (directory === entry) directory = null
  }
}

/** The registered directory, or null when no feature provides connections. */
export function mcpConnections(): McpConnectionDirectory | null {
  return directory?.port ?? null
}

/** The configured connections, or none without the recipe. */
export function mcpConnectionList(): McpConnectionEntry[] {
  return directory ? directory.port.list() : []
}

/** The header a session's toolset-granted connection carries (box-mcp.ts sets it). */
export const MCP_GRANT_HEADER = 'x-box-grant'

const grantMac = (principalId: string, connectionId: string): string =>
  createHmac('sha256', authSecret('AUTH_TOKEN_SECRET')).update(`mcp-grant:${principalId}:${connectionId}`).digest('base64url')

/**
 * Proof that a toolset granted `connectionId` to a session acting as `principalId`. Only core
 * mints it, so a person calling the connection endpoint with their own token cannot claim a grant
 * their audience does not give them.
 */
export function mcpConnectionGrant(principalId: string, connectionId: string): string {
  return grantMac(principalId, connectionId)
}

/** Whether `presented` is the grant core minted for this principal and connection. */
export function verifyMcpConnectionGrant(presented: string | null | undefined, principalId: string, connectionId: string): boolean {
  if (!presented) return false
  const expected = Buffer.from(grantMac(principalId, connectionId))
  const actual = Buffer.from(presented)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** The path prefix of the per-connection session endpoint. */
export const MCP_CONNECTION_PATH = '/mcp/connections/'

/** The connection id a request path names (`/mcp/connections/stripe`), or null for any other path. */
export function mcpConnectionPathId(path: string): string | null {
  if (!path.startsWith(MCP_CONNECTION_PATH)) return null
  const rest = path.slice(MCP_CONNECTION_PATH.length).replace(/\/+$/, '')
  return /^[a-z][a-z0-9_]{0,23}$/.test(rest) ? rest : null
}
