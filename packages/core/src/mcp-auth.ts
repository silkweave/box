// The MCP sign-in port: how a person's own MCP client (Claude Code, Codex, Claude Desktop, ...)
// proves who it acts for on the `/mcp` transport. Core accepts the Box's access tokens there
// (admin-handed, `authenticatePrincipal`); a feature (the `mcp` recipe) may add an OAuth
// authorization server whose tokens core then also accepts, on `/mcp` only.
//
// The extension is declared in the feature's server entry (`ServerFeature.mcpAuth`) rather than
// registered from `onModuleInit`: the `/mcp` adapter mounts its OAuth and discovery routes while
// Nest configures middleware, before any module initialises.
//
// One resolver serves every place that authenticates an `/mcp` call (the adapter's token check, the
// tool-list filter and AuthGuard for calls the `/mcp` adapter opened), so they cannot disagree. A token
// the extension recognises is judged by the extension alone and fails closed: it never falls back to
// the access-token check. `authenticatePrincipal` itself stays access-token-only, so an OAuth token
// is refused on REST, tRPC, path mounts, `/mcp/servers/<id>` and the login box.

import { authenticatePrincipal, type Principal, type PrincipalCredential } from './auth/principal.js'
import { requestHolder } from './request-context.js'

/** What the extension knows about a valid token it issued. */
export interface McpOAuthIdentity {
  principal: Principal
  /** The approved connection the token belongs to. */
  grantId: string
  /** The client the person approved (a CIMD URL or a registered client id). */
  clientId: string
}

/** A client's sign-in request waiting for the person's decision: what the consent page shows. */
export interface McpConsentRequest {
  id: string
  clientId: string
  /** Self-declared by the client: show it escaped; for `dcr` it proves nothing. */
  clientName: string | null
  /** `cimd`: the client is identified by a metadata document at `clientHost`; `dcr`: unverified. */
  clientKind: 'cimd' | 'dcr'
  clientHost: string | null
  /** Where the browser returns after the decision. */
  redirectHost: string
  /** Epoch seconds. */
  expiresAt: number
}

/** One approved connection, as Connected apps shows it. */
export interface McpConnectedApp {
  grantId: string
  principalId: string
  clientId: string
  clientName: string | null
  clientKind: 'cimd' | 'dcr'
  clientHost: string | null
  connectedAt: string
  lastUsedAt: string | null
  /** When the person has to connect again. */
  expiresAt: string
  /** The browser the person approved in ("Chrome on macOS"): a hint for telling connections apart. */
  device: string | null
}

/** One entry of MCP sign-in's audit trail. Never tokens, codes or cookies. */
export interface McpSignInEvent {
  at: string
  event: 'registered' | 'consented' | 'connected' | 'refreshed' | 'revoked'
  grantId: string | null
  principalId: string | null
  clientId: string | null
  /** Who revoked (a person's id, `cli`), or null for the Box itself (a replay, a URL change). */
  actor: string | null
  /** Why a grant was revoked: `revoked`, `user_revoked`, `replay`, `url_changed`. */
  reason: string | null
  /** The caller's address as the Box saw it (trusted-proxy aware), when there was a caller. */
  ip: string | null
}

/**
 * Consent and Connected apps, as the extension supplies them. Core owns the routes, the pages and
 * the CLI (any signed-in person, whatever their areas, may approve a client for themselves and see
 * and revoke their own connections); the extension owns the decisions. Who is asking always comes
 * from the caller's session, passed in by core.
 */
export interface McpSignIn {
  /** The canonical MCP URL people connect to, or null when sign-in is not offered at this address. */
  url(): string | null
  /** A pending request, or null when it is unknown, decided or expired. */
  request(id: string): Promise<McpConsentRequest | null>
  /**
   * Approve for `principalId` (the session's person): the client redirect, or null when the request
   * is gone or the person may not hold connections. `device` labels the approving browser.
   */
  approve(id: string, principalId: string, info?: { device?: string | null }): Promise<string | null>
  /** Deny: the client redirect carrying `access_denied`, or null when the request is gone. */
  deny(id: string): Promise<string | null>
  /** Active connections: one person's, or everyone's for null. */
  apps(principalId: string | null): Promise<McpConnectedApp[]>
  /** Revoke one connection; `owner` set limits it to that person's. False when there is none. */
  revoke(grantId: string, opts: { owner: string | null; actor: string }): Promise<boolean>
  /** Revoke every connection of one person. The count revoked. */
  revokeAll(principalId: string, actor: string): Promise<number>
  /** The audit trail, newest first: one person's, or everyone's for null. */
  log(principalId: string | null, limit: number): Promise<McpSignInEvent[]>
}

/**
 * The OAuth side of `/mcp`, supplied by one feature. `auth` is handed to the MCP adapter as is
 * (provider, resource and authorization-server URLs); core adds `required` and the token check.
 */
export interface McpAuthExtension {
  /** The adapter's auth fields besides `verifyToken`, or null when sign-in is not offered (no usable URL). */
  auth(): Record<string, unknown> | null
  /** Whether a bearer value has this extension's token shape. Cheap and synchronous: no I/O. */
  recognizes(token: string): boolean
  /** The identity behind a recognised token, or null when it is invalid, expired or revoked. */
  verify(token: string): Promise<McpOAuthIdentity | null>
  /** Consent and Connected apps (core's `/connect` page, Profile, Users and `box auth connections`). */
  signIn: McpSignIn
}

let extension: { owner: string; ext: McpAuthExtension } | null = null

/** Install the extension (core's app module, from the feature list, before the adapter mounts). One per Box. */
export function installMcpAuth(owner: string, ext: McpAuthExtension): () => void {
  if (extension) throw new Error(`MCP sign-in supplied twice ("${extension.owner}", then "${owner}")`)
  const entry = { owner, ext }
  extension = entry
  return () => {
    if (extension === entry) extension = null
  }
}

/** The installed extension, or null on a Box without MCP sign-in. */
export function mcpAuthExtension(): McpAuthExtension | null {
  return extension?.ext ?? null
}

/** A resolved `/mcp` caller. */
export interface McpCredential {
  principal: Principal
  credential: Extract<PrincipalCredential, 'bearer' | 'oauth'>
  /** Set for `oauth`: the approved connection. */
  grantId?: string
  clientId?: string
}

/** Resolve a bearer value presented on the `/mcp` transport. Null for a missing or invalid one. */
export async function resolveMcpCredential(token: string): Promise<McpCredential | null> {
  const value = token.trim()
  if (!value) return null
  const ext = extension?.ext
  if (ext?.recognizes(value)) {
    const identity = await ext.verify(value)
    return identity ? { principal: identity.principal, credential: 'oauth', grantId: identity.grantId, clientId: identity.clientId } : null
  }
  const principal = await authenticatePrincipal(value)
  return principal ? { principal, credential: 'bearer' } : null
}

/**
 * Whether the current call came through the `/mcp` transport: its request frame was opened by the
 * `/mcp` adapter's call wrapper (apps/server auth/call-context.ts), on the server side, so nothing a
 * caller sends can set it.
 */
export function isMcpCall(): boolean {
  return requestHolder()?.transport === 'mcp'
}
