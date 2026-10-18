// Agent toolsets: which MCP servers and tools a server-owned agent session gets beyond the Box's
// own (`box`). A session that names no toolset gets the Box's tools only, so another server's
// reach is always granted by name, per chat room or per agent trigger, never by default.
//
// Settings live under `agentMcp.toolsets` (box.json for shared shape, box.local.json for edits made
// in Settings):
//   toolsets: id -> { label?, description?, servers: [connection id], allow: [tool], deny: [tool] }
// A null entry removes one (box.local.json overrides box.json by merge, which cannot delete).
//
// The servers a toolset attaches are connections of the `mcp` recipe (mcp-connections.ts): the
// recipe holds their credentials and relays every call, so a session gets a loopback URL and its
// own principal's Box token, never an upstream credential. Without the recipe there are no
// connections, and a toolset naming one is skipped with the reason.
//
// `allow` lists tools that run without an approval (`mcp__<server>` or `mcp__<server>__<tool>`);
// tools of an attached server that are not allowed still need one, which an unattended trigger
// run cannot get. `deny` removes tools from the session: an MCP tool or whole server, or a
// built-in such as `Bash` (an external-facing room can lose the shell this way).
//
// Features may register built-in toolsets (`registerBuiltinToolset`): code-owned, listed beside the
// configured ones but not editable, and the only ones that can carry `boxTools`, an allowlist of the
// Box's own tools. A session with such a toolset gets every other Box tool denied by name (from the
// server's live tool list), so a tool added later is denied until a feature allows it. Comms
// registers `comms-draft` this way for jobs that answer people outside the team.

import { boxJson } from './box-config.js'
import { configRoot } from './io.js'
import { writeBoxLocal } from './box-json.js'
import { mcpConnectionList, mcpConnections, type McpConnectionEntry } from './mcp-connections.js'

export interface AgentToolset {
  id: string
  label: string
  description: string
  servers: string[]
  allow: string[]
  deny: string[]
  /** Built in: the only Box tools (kebab-case MCP names, `comms-draft`) the session keeps; null keeps them all. */
  boxTools: string[] | null
  /** Registered by a feature in code (registerBuiltinToolset), not configured; Settings cannot edit it. */
  builtIn: boolean
}

/** A feature's built-in toolset: Box tools only (no other servers). */
export interface BuiltinToolset {
  id: string
  label: string
  description: string
  /** The Box tools it keeps (kebab-case MCP names); every other Box tool is denied. */
  boxTools: readonly string[]
  /** Built-in engine tools it removes (`Bash`, `WebFetch`, ...). */
  deny: readonly string[]
}

const builtins = new Map<string, BuiltinToolset>()

/** Register a built-in toolset (at import). A configured toolset of the same id is refused. */
export function registerBuiltinToolset(toolset: BuiltinToolset): void {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(toolset.id)) throw new Error(`built-in toolset "${toolset.id}": the id is a lowercase slug`)
  builtins.set(toolset.id, toolset)
}

/** The engine's name for a Box MCP tool (`comms-send` -> `CommsSend`), as the MCP adapter registers it. */
export const mcpToolName = (name: string): string =>
  name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')

export interface AgentToolsSettings {
  /** The connections a toolset can attach (the `mcp` recipe's); empty without it. */
  connections: McpConnectionEntry[]
  /** Whether a feature provides connections at all (the `mcp` recipe is adapted). */
  connectionsAvailable: boolean
  toolsets: AgentToolset[]
  /** Entries that are skipped, with the reason (a toolset that does not parse). */
  problems: string[]
}

/** The session options a toolset adds (CreateSessionRequest's fields of the same names). */
export interface ToolsetSessionOptions {
  /** The connection ids the toolset attaches; box-mcp.ts turns each into a loopback server. */
  servers: string[]
  allowedTools: string[]
  disallowedTools: string[]
  /** The only Box tools the session keeps (engine names, `CommsDraft`), or null for all of them. */
  boxTools: string[] | null
}

/** The server name the Box's own MCP surface has in a session; no configured server may take it. */
export const BOX_TOOLS_SERVER = 'box'

const ID = /^[a-z][a-z0-9-]{0,39}$/
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

function section(): { servers: unknown; toolsets: Record<string, unknown> } {
  const raw = boxJson().agentMcp
  return { servers: raw.servers, toolsets: isRecord(raw.toolsets) ? raw.toolsets : {} }
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
  for (const s of servers) if (!known.has(s)) return `toolset "${id}": no connection "${s}" (Settings > Connections)`
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
  return { id, label: text(raw.label) || id, description: text(raw.description), servers, allow, deny, boxTools: null, builtIn: false }
}

function read(): { connections: McpConnectionEntry[]; toolsets: AgentToolset[]; problems: string[] } {
  const raw = section()
  const problems: string[] = []
  if (isRecord(raw.servers) && Object.values(raw.servers).some((v) => v !== null)) {
    problems.push('agentMcp.servers is not read: a server is a connection of the mcp recipe (features.mcp.connections)')
  }
  const connections = mcpConnectionList()
  const known = new Set(connections.map((c) => c.id))
  const toolsets: AgentToolset[] = []
  for (const b of builtins.values()) {
    toolsets.push({ id: b.id, label: b.label, description: b.description, servers: [], allow: [], deny: [...b.deny], boxTools: [...b.boxTools], builtIn: true })
  }
  for (const [id, value] of Object.entries(raw.toolsets)) {
    if (value === null || id.startsWith('_')) continue
    if (builtins.has(id)) {
      problems.push(`toolset "${id}": the id is a built-in toolset; this configured one is skipped`)
      continue
    }
    const parsed = parseToolset(id, value, known)
    if (typeof parsed === 'string') problems.push(parsed)
    else toolsets.push(parsed)
  }
  const byId = <T extends { id: string }>(a: T, b: T): number => a.id.localeCompare(b.id)
  return { connections: [...connections].sort(byId), toolsets: toolsets.sort(byId), problems }
}

/** The connections a toolset can attach and the toolsets, for Settings. */
export function readAgentTools(): AgentToolsSettings {
  const { connections, toolsets, problems } = read()
  return { connections, connectionsAvailable: mcpConnections() !== null, toolsets, problems }
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
 * What a toolset adds to a session: the connections it attaches, its allow list, its deny list.
 * Throws when the toolset is unknown or names a connection that does not exist.
 */
export function toolsetSessionOptions(id: string): ToolsetSessionOptions {
  const { toolsets } = read()
  const toolset = toolsets.find((t) => t.id === id)
  if (!toolset) throw new Error(toolsetProblem(id) ?? `no toolset "${id}"`)
  return { servers: [...toolset.servers], allowedTools: [...toolset.allow], disallowedTools: [...toolset.deny], boxTools: toolset.boxTools ? toolset.boxTools.map(mcpToolName) : null }
}

// --- writes (Settings; box.local.json) ------------------------------------------------------------

function writeAgentMcp(patch: Record<string, unknown>): void {
  writeBoxLocal(configRoot(), { agentMcp: patch })
}

export interface AgentToolsetInput {
  id: string
  label?: string
  description?: string
  servers?: string[]
  allow?: string[]
  deny?: string[]
}

/** The toolsets that attach a connection (the recipe refuses to delete one while any does). */
export function toolsetsAttaching(connection: string): string[] {
  return read().toolsets.filter((t) => t.servers.includes(connection)).map((t) => t.id)
}

/** Create or replace a toolset. Refuses one that does not parse, before writing. */
export function saveAgentToolset(input: AgentToolsetInput): AgentToolset {
  if (builtins.has(input.id)) throw new Error(`toolset "${input.id}" is built in and cannot be edited`)
  const entry = {
    label: text(input.label) || null,
    description: text(input.description) || null,
    servers: strings(input.servers),
    allow: strings(input.allow),
    deny: strings(input.deny),
  }
  const parsed = parseToolset(input.id, { ...entry, label: entry.label ?? undefined, description: entry.description ?? undefined }, new Set(mcpConnectionList().map((c) => c.id)))
  if (typeof parsed === 'string') throw new Error(parsed)
  writeAgentMcp({ toolsets: { [input.id]: entry } })
  return parsed
}

/** Remove a toolset. Sessions that name it start with the Box's tools only and say why. */
export function deleteAgentToolset(id: string): void {
  if (builtins.has(id)) throw new Error(`toolset "${id}" is built in and cannot be removed`)
  writeAgentMcp({ toolsets: { [id]: null } })
}
