// The `/mcp` tool filter. Two jobs, in this order, on every `tools/list` and `tools/call`:
//
// 1. The Box's own tools, filtered by the caller's access (docs/AUTH.md "Roles and areas"): a tool
//    whose handler the caller's role does not reach is absent from the list, and the silkweave MCP
//    transport refuses a call to a tool not in the list. The same decision AuthGuard makes
//    (handler-map.ts `refusalFor`), so list and call agree. A missing or invalid bearer gets nothing.
//    No early return skips this: not a missing passthrough source, not `?passthrough=0`.
// 2. Passthrough: a feature may add actions per request, for the principal making it. The `mcp`
//    recipe uses it to show each person the outside MCP servers' tools they may use
//    (`StripeStripeApiRead`), which also makes them `box <tool>` CLI commands. Only with `mcp` read
//    access; a request carrying `?passthrough=0` (a server-owned agent session's own `box` server,
//    box-mcp.ts) never gets them; a `tools/call` naming a Box tool never consults the source; a
//    passthrough action whose name collides with any Box tool, listed or not, is dropped, so a Box
//    tool can never be shadowed.

import type { Action } from '@silkweave/core'
import { accessOf, authenticatePrincipal, levelCovers, levelOf, type Access, type Principal } from '@silkweave/box-core'
import { mcpToolPolicy, refusalFor } from '../auth/handler-map.js'

export interface McpActionRequest {
  principal: Principal
  /** The principal's access now: passthrough tools are judged by its `mcp` level. */
  access: Access
  /** `mcp` for an MCP client, `cli` for the `box` CLI proxy (it sends `x-box-surface: cli`). */
  surface: 'mcp' | 'cli'
  method: string
  /** The PascalCase tool name of a `tools/call`. */
  toolName?: string
}

export type McpActionSource = (request: McpActionRequest) => Promise<Action[]>

/** The request stand-in the adapter's `filterActions` receives (`@silkweave/mcp` FilterRequest). */
export interface FilterRequest {
  headers: Record<string, string | string[] | undefined>
  url: string
  method: string
  toolName?: string
}

let source: { owner: string; fn: McpActionSource } | null = null

/** Register the source (the `mcp` recipe, from onModuleInit). One per Box. Returns the unregister. */
export function registerMcpActionSource(owner: string, fn: McpActionSource): () => void {
  if (source) throw new Error(`MCP action source registered twice ("${source.owner}", then "${owner}")`)
  const entry = { owner, fn }
  source = entry
  return () => {
    if (source === entry) source = null
  }
}

const pascal = (name: string): string =>
  name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')

function header(headers: FilterRequest['headers'], name: string): string {
  const value = headers[name]
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

/** Whether the request URL opts out of passthrough actions (`?passthrough=0`). */
export function passthroughOff(url: string): boolean {
  const query = url.split('?', 2)[1] ?? ''
  return new URLSearchParams(query).get('passthrough') === '0'
}

/** The bearer's principal, or null for a missing or invalid one. */
async function bearerPrincipal(headers: FilterRequest['headers']): Promise<Principal | null> {
  const authz = header(headers, 'authorization')
  if (!/^Bearer\s+/i.test(authz)) return null
  return authenticatePrincipal(authz.replace(/^Bearer\s+/i, '').trim())
}

/** The `filterActions` option of core's `/mcp` adapter. */
export async function filterMcpActions(actions: Action[], request: FilterRequest): Promise<Action[]> {
  // `initialize` and `ping` expose no tools.
  if (request.method !== 'tools/list' && request.method !== 'tools/call') return actions
  const principal = await bearerPrincipal(request.headers)
  if (!principal) return []
  const access = await accessOf(principal)
  const own = actions.filter((action) => {
    const policy = mcpToolPolicy(action.name)
    return policy !== null && refusalFor(policy, access, principal.session) === null
  })
  if (!source) return own
  if (passthroughOff(request.url)) return own
  if (!levelCovers(levelOf(access, 'mcp'), 'read')) return own
  const boxNames = new Set(actions.map((a) => pascal(a.name)))
  if (request.method === 'tools/call' && request.toolName && boxNames.has(request.toolName)) return own
  const surface = header(request.headers, 'x-box-surface') === 'cli' ? 'cli' : 'mcp'
  let added: Action[]
  try {
    added = await source.fn({ principal, access, surface, method: request.method, ...(request.toolName ? { toolName: request.toolName } : {}) })
  } catch (error) {
    // A broken source must not take the Box's own tools down with it.
    console.error(`[mcp] passthrough tools unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return own
  }
  const seen = new Set(boxNames)
  const extra: Action[] = []
  for (const action of added) {
    const name = pascal(action.name)
    if (seen.has(name)) continue
    seen.add(name)
    extra.push(action)
  }
  return [...own, ...extra]
}
