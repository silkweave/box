// The Box's agents: one file per agent in `data/config/agents/<id>.md`. The file is the agent:
// front matter holds its identity (`name`, `role`), the body its instructions, appended to the
// engine system prompt at each session start. The system principal stays in box.json `agent`
// (identity lock, bootstrap before the warehouse); its file, when present, holds instructions only.
//
// Read at call time and never cached, like `boxJson()`: deleting a file retires the agent at once
// through `agentConfig` (and the eligibility checks built on it), without a restart. Boot
// reconciliation (auth/bootstrap.ts) only writes the users rows. See docs/AUTH.md.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentIdentity } from './box-config.js'
import { configPath } from './io.js'
import type { UserRole } from './users/types.js'

export interface AgentConfig {
  id: string
  name: string
  role: UserRole
  /** The body of the agent's file, trimmed; '' when there is none. */
  instructions: string
  /** True for the box.json system principal. */
  system: boolean
  /** The agent's file, or null for a system principal without one. */
  file: string | null
}

/** An agent file that does not parse. Boot refuses while one exists; at runtime its agent is inactive. */
export class AgentFileError extends Error {
  constructor(readonly file: string, message: string) {
    super(`${file}: ${message}`)
    this.name = 'AgentFileError'
  }
}

/** The same slug rule as box.json `agent.id`. */
const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/
const KEYS = ['name', 'role'] as const

/** `data/config/agents/`, where each agent's file lives. */
export function agentsDir(): string {
  return configPath('agents')
}

/** The file for agent `id` (whether or not it exists). */
export function agentFilePath(id: string): string {
  return join(agentsDir(), `${id}.md`)
}

const relativeName = (id: string): string => `data/config/agents/${id}.md`

/** One scalar: plain, or wrapped in matching single or double quotes. */
function scalar(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) return v.slice(1, -1)
  return v
}

/**
 * Parse one agent file. Front matter is a fenced block of `key: value` lines and nothing else: no
 * nesting, no lists, no comments, because two keys need no YAML and a strict reader names every
 * mistake. The system principal's file may omit the block and may not set `name` or `role`.
 */
export function parseAgentFile(id: string, text: string, opts: { system: boolean }): { name?: string; role?: UserRole; instructions: string } {
  const where = relativeName(id)
  if (!AGENT_ID.test(id)) throw new AgentFileError(where, 'the file name must be a lowercase slug (a-z, 0-9, -) ending in .md')
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const fields: Record<string, string> = {}
  let body = src
  if (src.startsWith('---\n')) {
    const end = src.indexOf('\n---', 3)
    if (end < 0 || (src[end + 4] !== undefined && src[end + 4] !== '\n')) {
      throw new AgentFileError(where, 'front matter opened with --- is not closed by a --- line')
    }
    for (const line of src.slice(4, end).split('\n')) {
      if (!line.trim()) continue
      const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(line)
      if (!m) throw new AgentFileError(where, `front matter line ${JSON.stringify(line)} is not "key: value"`)
      const key = m[1]!
      if (!(KEYS as readonly string[]).includes(key)) {
        throw new AgentFileError(where, `unknown key ${JSON.stringify(key)} (allowed: ${KEYS.join(', ')})`)
      }
      if (key in fields) throw new AgentFileError(where, `key ${JSON.stringify(key)} appears twice`)
      fields[key] = scalar(m[2]!)
    }
    body = src.slice(end + 4)
  } else if (!opts.system) {
    throw new AgentFileError(where, 'needs front matter: ---, name: <display name>, role: admin | member, ---')
  }
  const instructions = body.trim()
  if (opts.system) {
    const set = KEYS.filter((k) => k in fields)
    if (set.length) throw new AgentFileError(where, `the system principal's ${set.join(' and ')} come from box.json agent; this file holds instructions only`)
    return { instructions }
  }
  const name = fields['name']
  if (!name) throw new AgentFileError(where, 'name is required')
  const role = fields['role']
  if (role !== 'admin' && role !== 'member') throw new AgentFileError(where, 'role is required: admin or member')
  return { name, role, instructions }
}

/**
 * A regular file only. A symlink (or anything else) is not an agent file: enumeration, the
 * eligibility read, reconciliation and backups must all see the same set.
 */
function isAgentFile(file: string): boolean {
  try {
    return lstatSync(file).isFile()
  } catch {
    return false
  }
}

function readAgentFile(id: string): string | null {
  const file = agentFilePath(id)
  if (!isAgentFile(file)) return null
  return readFileSync(file, 'utf8')
}

/**
 * Agent `id`'s configuration, or null when no such agent is configured (no file, and not the system
 * principal). Throws `AgentFileError` when its file does not parse: an invalid file never falls
 * back to whatever the users row says.
 */
export function agentConfig(id: string): AgentConfig | null {
  const system = agentIdentity()
  if (id === system.id) {
    const text = readAgentFile(id)
    const parsed = text === null ? { instructions: '' } : parseAgentFile(id, text, { system: true })
    return { id, name: system.name, role: system.role, instructions: parsed.instructions, system: true, file: text === null ? null : agentFilePath(id) }
  }
  if (!AGENT_ID.test(id)) return null
  const text = readAgentFile(id)
  if (text === null) return null
  const parsed = parseAgentFile(id, text, { system: false })
  return { id, name: parsed.name!, role: parsed.role!, instructions: parsed.instructions, system: false, file: agentFilePath(id) }
}

/** What a new agent file holds (Settings > Users > New agent). */
export interface NewAgentFile {
  id: string
  name: string
  role: UserRole
  instructions?: string
}

/** The text of an agent file: front matter with the name (quoted) and role, then the instructions. */
export function agentFileText(a: Omit<NewAgentFile, 'id'>): string {
  const instructions = (a.instructions ?? '').trim()
  return `---\nname: "${a.name}"\nrole: ${a.role}\n---\n${instructions ? `${instructions}\n` : ''}`
}

/**
 * Write a new agent's file, refusing a bad id or name, the system principal's id and an id that
 * already has a file (written exclusively, so two creates cannot both win). The text is read back
 * through the parser, so a file it writes always parses. Returns the file path.
 */
export function writeNewAgentFile(a: NewAgentFile): string {
  const name = a.name.trim()
  if (!AGENT_ID.test(a.id)) throw new AgentFileError(relativeName(a.id), 'the id must be a lowercase slug (a-z, 0-9, -)')
  if (a.id === agentIdentity().id) throw new AgentFileError(relativeName(a.id), 'that is the system principal\'s id')
  if (!name || name.length > 64 || /[\r\n"]/.test(name)) throw new AgentFileError(relativeName(a.id), 'the name must be 1 to 64 characters on one line, without double quotes')
  if (a.role !== 'admin' && a.role !== 'member') throw new AgentFileError(relativeName(a.id), 'role must be admin or member')
  const text = agentFileText({ ...a, name })
  parseAgentFile(a.id, text, { system: false })
  const file = agentFilePath(a.id)
  if (existsSync(file) || isAgentFile(file)) throw new AgentFileError(relativeName(a.id), 'an agent with this id exists already')
  mkdirSync(agentsDir(), { recursive: true })
  writeFileSync(file, text, { flag: 'wx', mode: 0o644 })
  return file
}

/** The ids with a file in `data/config/agents/` (`.md` only; other files are ignored). */
function agentFileIds(): string[] {
  const dir = agentsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name.slice(0, -'.md'.length))
    .sort()
}

/**
 * Every configured agent, the system principal first, then the files by id. Throws on the first
 * file that does not parse (boot refuses; see `agentFileProblems` for a non-throwing read).
 */
export function configuredAgents(): AgentConfig[] {
  const system = agentIdentity().id
  const out = [agentConfig(system)!]
  for (const id of agentFileIds()) {
    if (id === system) continue
    if (!AGENT_ID.test(id)) throw new AgentFileError(relativeName(id), 'the file name must be a lowercase slug (a-z, 0-9, -) ending in .md')
    out.push(agentConfig(id)!)
  }
  return out
}

/** Every agent file that does not parse, with the reason. Empty when all are valid. */
export function agentFileProblems(): string[] {
  const problems: string[] = []
  const system = agentIdentity().id
  for (const id of agentFileIds()) {
    try {
      if (!AGENT_ID.test(id)) throw new AgentFileError(relativeName(id), 'the file name must be a lowercase slug (a-z, 0-9, -) ending in .md')
      agentConfig(id === system ? system : id)
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }
  return problems
}

/** Whether `id` is a configured agent (system principal or a file), valid or not. Never throws. */
export function isConfiguredAgent(id: string): boolean {
  if (!id) return false
  if (id === agentIdentity().id) return true
  return AGENT_ID.test(id) && isAgentFile(agentFilePath(id))
}

/** The instructions appended to agent `id`'s system prompt, or '' when it has none or is not configured. */
export function agentInstructions(id: string): string {
  return agentConfig(id)?.instructions ?? ''
}

/** What the eligibility predicate reads from a users row. */
export interface AgentRowState {
  id: string
  kind: string | null
  status: string | null
  token_revoked_at?: string | null
}

/**
 * The eligibility predicate (design: an agent is active iff its row is `kind = 'agent'`, not
 * revoked, AND its file exists and parses; the system principal's config is box.json). Returns why
 * the row may not act, or null when it may. A human row is not judged here (null): its own checks
 * (status, token) stay where they are. Checked at call time by agent authentication,
 * `sessionPrincipalToken`, chat dispatch and automation `run_as`.
 */
export function agentRowProblem(row: AgentRowState): string | null {
  if (row.kind !== 'agent') return null
  if (row.status === 'revoked' || row.token_revoked_at) return `agent "${row.id}" is retired`
  // The system principal's identity is box.json's, which is always there; its optional file only
  // adds instructions, and a bad one is refused at boot rather than locking the Box's agent out.
  if (row.id === agentIdentity().id) return null
  try {
    if (!agentConfig(row.id)) return `agent "${row.id}" is retired: ${relativeName(row.id)} does not exist`
  } catch (error) {
    return `agent "${row.id}" is inactive: ${error instanceof Error ? error.message : String(error)}`
  }
  return null
}

/** Agent `id`'s config when the row passes `agentRowProblem`, else null. Never throws. */
export function activeAgentConfig(row: AgentRowState): AgentConfig | null {
  if (row.kind !== 'agent' || agentRowProblem(row)) return null
  try {
    return agentConfig(row.id)
  } catch {
    const system = agentIdentity()
    return row.id === system.id ? { ...system, instructions: '', system: true, file: null } : null
  }
}
