// The passthrough hook on `/mcp`: a feature may add actions to the Box's own MCP surface per
// request, for the principal making it. The `mcp` recipe uses it to show each person the outside
// MCP servers' tools they may use (`StripeStripeApiRead`), which also makes them `box <tool>` CLI
// commands. Without a registered source `/mcp` is the Box's own actions, unchanged.
//
// Rules core enforces before asking the source: only `tools/list` and `tools/call` consult it (no
// lookup for `initialize` or `ping`); a request carrying `?passthrough=0` (a server-owned agent
// session's own `box` server, box-mcp.ts) never gets passthrough actions; a `tools/call` naming a
// Box action never consults it. The source decides who sees what (agent principals see nothing,
// by the recipe's rule). A passthrough action whose name collides with a Box action is dropped, so
// a Box tool can never be shadowed.

import type { Action } from '@silkweave/core'
import { authenticatePrincipal, type Principal } from '@silkweave/box-core'

export interface McpActionRequest {
  principal: Principal
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

/** The `filterActions` option of core's `/mcp` adapter. */
export async function filterMcpActions(actions: Action[], request: FilterRequest): Promise<Action[]> {
  if (!source) return actions
  if (request.method !== 'tools/list' && request.method !== 'tools/call') return actions
  if (passthroughOff(request.url)) return actions
  const own = new Set(actions.map((a) => pascal(a.name)))
  if (request.method === 'tools/call' && request.toolName && own.has(request.toolName)) return actions
  const authz = header(request.headers, 'authorization')
  if (!/^Bearer\s+/i.test(authz)) return actions
  const principal = await authenticatePrincipal(authz.replace(/^Bearer\s+/i, '').trim())
  if (!principal) return actions
  const surface = header(request.headers, 'x-box-surface') === 'cli' ? 'cli' : 'mcp'
  let added: Action[]
  try {
    added = await source.fn({ principal, surface, method: request.method, ...(request.toolName ? { toolName: request.toolName } : {}) })
  } catch (error) {
    // A broken source must not take the Box's own tools down with it.
    console.error(`[mcp] passthrough tools unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return actions
  }
  const seen = new Set(own)
  const extra: Action[] = []
  for (const action of added) {
    const name = pascal(action.name)
    if (seen.has(name)) continue
    seen.add(name)
    extra.push(action)
  }
  return [...actions, ...extra]
}
