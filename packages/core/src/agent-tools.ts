// Agent toolsets: which MCP servers and tools a server-owned agent session gets beyond the Box's
// own (`box`). A session that names no toolset gets the Box's tools only, so another server's
// reach is always granted by name, per chat room or per agent trigger, never by default.
//
// Settings live under `agentMcp` (box.json for shared shape, box.local.json for tokens and for
// edits made in Settings):
//   servers:  id -> { url, type?: 'http' | 'sse', label?, token? }   id is the tool prefix
//   toolsets: id -> { label?, description?, servers: [id], allow: [tool], deny: [tool] }
// A null entry removes one (box.local.json overrides box.json by merge, which cannot delete).
//
// `allow` lists tools that run without an approval (`mcp__<server>` or `mcp__<server>__<Tool>`);
// tools of an attached server that are not allowed still need one, which an unattended trigger
// run cannot get. `deny` removes tools from the session: an MCP tool or whole server, or a
// built-in such as `Bash` (an external-facing room can lose the shell this way).
//
// A server's credentials are the Box's, not the session principal's: whoever a session acts for,
// a toolset's server answers with its configured token.

import { boxJson } from './box-config.js'
import { configRoot } from './io.js'
import { writeBoxLocal } from './box-json.js'

export interface AgentMcpServer {
  id: string
  url: string
  type: 'http' | 'sse'
  label: string
  /** The bearer token, when one is configured. Never sent to a client. */
  token: string | null
}

export interface AgentToolset {
  id: string
  label: string
  description: string
  servers: string[]
  allow: string[]
  deny: string[]
}

/** A server as a client sees it: whether a token is set, never the token. */
export type AgentMcpServerView = Omit<AgentMcpServer, 'token'> & { hasToken: boolean }

export interface AgentToolsSettings {
  servers: AgentMcpServerView[]
  toolsets: AgentToolset[]
  /** Entries that are skipped, with the reason (a server or toolset that does not parse). */
  problems: string[]
}

/** The session options a toolset adds (CreateSessionRequest's fields of the same names). */
export interface ToolsetSessionOptions {
  mcpServers: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>
  allowedTools: string[]
  disallowedTools: string[]
}

/** The server name the Box's own MCP surface has in a session; no configured server may take it. */
export const BOX_TOOLS_SERVER = 'box'

const ID = /^[a-z][a-z0-9-]{0,39}$/
const SERVER_ID = /^[a-z][a-z0-9_]{0,39}$/
const TOOL = /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : []
}

function section(): { servers: Record<string, unknown>; toolsets: Record<string, unknown> } {
  const raw = boxJson().agentMcp
  return {
    servers: isRecord(raw.servers) ? raw.servers : {},
    toolsets: isRecord(raw.toolsets) ? raw.toolsets : {},
  }
}

function parseServer(id: string, raw: unknown): AgentMcpServer | string {
  if (!SERVER_ID.test(id)) return `server "${id}": the id is lowercase letters, digits and _ (it becomes the tool prefix)`
  if (id === BOX_TOOLS_SERVER) return `server "${id}": "box" is the Box's own server`
  if (!isRecord(raw)) return `server "${id}": not an object`
  const url = text(raw.url)
  if (!/^https?:\/\/\S+$/.test(url)) return `server "${id}": url must be an http(s) URL`
  const type = raw.type === undefined || raw.type === null ? 'http' : raw.type
  if (type !== 'http' && type !== 'sse') return `server "${id}": type is http or sse`
  return { id, url, type, label: text(raw.label) || id, token: text(raw.token) || null }
}

/** The tool names a toolset entry may hold: a built-in, an MCP server, or one MCP tool. */
function toolProblem(tool: string, servers: readonly string[]): string | null {
  if (!TOOL.test(tool)) return `"${tool}" is not a tool name`
  const mcp = /^mcp__([a-z][a-z0-9_]*?)(?:__(.+))?$/.exec(tool)
  if (mcp && mcp[1] !== BOX_TOOLS_SERVER && !servers.includes(mcp[1]!)) return `"${tool}" names server "${mcp[1]}", which this toolset does not attach`
  return null
}

function parseToolset(id: string, raw: unknown, known: ReadonlySet<string>): AgentToolset | string {
  if (!ID.test(id)) return `toolset "${id}": the id is a lowercase slug`
  if (!isRecord(raw)) return `toolset "${id}": not an object`
  const servers = strings(raw.servers)
  for (const s of servers) if (!known.has(s)) return `toolset "${id}": no server "${s}"`
  const allow = strings(raw.allow)
  const deny = strings(raw.deny)
  for (const tool of allow) {
    const problem = toolProblem(tool, servers)
    if (problem) return `toolset "${id}" allow: ${problem}`
    if (!tool.startsWith('mcp__')) return `toolset "${id}" allow: "${tool}" is a built-in tool; allow lists MCP tools only`
  }
  for (const tool of deny) {
    const problem = toolProblem(tool, servers)
    if (problem) return `toolset "${id}" deny: ${problem}`
  }
  return { id, label: text(raw.label) || id, description: text(raw.description), servers, allow, deny }
}

function read(): { servers: AgentMcpServer[]; toolsets: AgentToolset[]; problems: string[] } {
  const raw = section()
  const problems: string[] = []
  const servers: AgentMcpServer[] = []
  for (const [id, value] of Object.entries(raw.servers)) {
    if (value === null || id.startsWith('_')) continue
    const parsed = parseServer(id, value)
    if (typeof parsed === 'string') problems.push(parsed)
    else servers.push(parsed)
  }
  const known = new Set(servers.map((s) => s.id))
  const toolsets: AgentToolset[] = []
  for (const [id, value] of Object.entries(raw.toolsets)) {
    if (value === null || id.startsWith('_')) continue
    const parsed = parseToolset(id, value, known)
    if (typeof parsed === 'string') problems.push(parsed)
    else toolsets.push(parsed)
  }
  const byId = <T extends { id: string }>(a: T, b: T): number => a.id.localeCompare(b.id)
  return { servers: servers.sort(byId), toolsets: toolsets.sort(byId), problems }
}

/** The configured servers (tokens hidden) and toolsets, for Settings. */
export function readAgentTools(): AgentToolsSettings {
  const { servers, toolsets, problems } = read()
  return { servers: servers.map(({ token, ...rest }) => ({ ...rest, hasToken: token !== null })), toolsets, problems }
}

/** One toolset, or null when none by that id is configured (or it does not parse). */
export function agentToolset(id: string): AgentToolset | null {
  return read().toolsets.find((t) => t.id === id) ?? null
}

/** The reason a toolset id cannot be used, or null. Null and '' mean "no toolset" and are fine. */
export function toolsetProblem(id: string | null): string | null {
  if (!id) return null
  if (agentToolset(id)) return null
  const parseProblem = read().problems.find((p) => p.startsWith(`toolset "${id}"`))
  return parseProblem ?? `no toolset "${id}" (Settings > Agent tools)`
}

/**
 * What a toolset adds to a session: its servers with their tokens, its allow list, its deny list.
 * Throws when the toolset is unknown or names a server that is not configured.
 */
export function toolsetSessionOptions(id: string): ToolsetSessionOptions {
  const { servers, toolsets } = read()
  const toolset = toolsets.find((t) => t.id === id)
  if (!toolset) throw new Error(toolsetProblem(id) ?? `no toolset "${id}"`)
  const mcpServers: ToolsetSessionOptions['mcpServers'] = {}
  for (const sid of toolset.servers) {
    const server = servers.find((s) => s.id === sid)
    if (!server) throw new Error(`toolset "${id}": no server "${sid}"`)
    mcpServers[sid] = { type: server.type, url: server.url, ...(server.token ? { headers: { Authorization: `Bearer ${server.token}` } } : {}) }
  }
  return { mcpServers, allowedTools: [...toolset.allow], disallowedTools: [...toolset.deny] }
}

// --- writes (Settings; box.local.json) ------------------------------------------------------------

export interface AgentMcpServerInput {
  id: string
  url: string
  type?: 'http' | 'sse'
  label?: string
}

function writeAgentMcp(patch: Record<string, unknown>): void {
  writeBoxLocal(configRoot(), { agentMcp: patch })
}

/**
 * Create or update a server's connection. Refuses one that does not parse, before writing. The
 * token is not written here: secrets are hand-edited into box.local.json
 * (`agentMcp.servers.<id>.token`), like every other credential, and a save keeps it.
 */
export function saveAgentMcpServer(input: AgentMcpServerInput): AgentMcpServerView {
  const token = read().servers.find((s) => s.id === input.id)?.token ?? null
  const entry = { url: text(input.url), type: input.type ?? 'http', label: text(input.label) || null }
  const parsed = parseServer(input.id, { ...entry, label: entry.label ?? undefined, token: token ?? undefined })
  if (typeof parsed === 'string') throw new Error(parsed)
  writeAgentMcp({ servers: { [input.id]: entry } })
  const { token: _t, ...view } = parsed
  return { ...view, hasToken: parsed.token !== null }
}

/** Remove a server (its token too). Refuses while a toolset attaches it. */
export function deleteAgentMcpServer(id: string): void {
  const users = read().toolsets.filter((t) => t.servers.includes(id)).map((t) => t.id)
  if (users.length) throw new Error(`server "${id}" is attached by toolset ${users.map((u) => `"${u}"`).join(', ')}; detach it first`)
  writeAgentMcp({ servers: { [id]: null } })
}

export interface AgentToolsetInput {
  id: string
  label?: string
  description?: string
  servers?: string[]
  allow?: string[]
  deny?: string[]
}

/** Create or replace a toolset. Refuses one that does not parse, before writing. */
export function saveAgentToolset(input: AgentToolsetInput): AgentToolset {
  const entry = {
    label: text(input.label) || null,
    description: text(input.description) || null,
    servers: strings(input.servers),
    allow: strings(input.allow),
    deny: strings(input.deny),
  }
  const parsed = parseToolset(input.id, { ...entry, label: entry.label ?? undefined, description: entry.description ?? undefined }, new Set(read().servers.map((s) => s.id)))
  if (typeof parsed === 'string') throw new Error(parsed)
  writeAgentMcp({ toolsets: { [input.id]: entry } })
  return parsed
}

/** Remove a toolset. Sessions that name it start with the Box's tools only and say why. */
export function deleteAgentToolset(id: string): void {
  writeAgentMcp({ toolsets: { [id]: null } })
}
