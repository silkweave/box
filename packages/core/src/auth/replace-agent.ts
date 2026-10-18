// Replace an agent with a new one: the supported way to change an agent's id. A user id is the key
// every feature's history points at (messages, runs, owners), so an id is never rewritten in place.
// Instead the new agent takes over the old one's configuration (the system principal in box.json
// and its identity lock, or its agent file; its instructions, agent profiles and browser identity),
// and the old agent is retired by the reconciliation that follows: its token stops, its row stays
// as the author of its history. Run on a stopped Box after a backup (`box auth replace`). The
// warehouse rows that still name the old id are reported, so configuration that lives in feature
// tables (an automation trigger's run_as, a linked device) can be moved deliberately.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentConfig, agentFilePath, agentFileText, parseAgentFile } from '../agents.js'
import { agentIdentity, boxJsonPath } from '../box-config.js'
import { parseBoxJsonText, readBoxConfig } from '../box-json.js'
import { configPath, configRoot } from '../io.js'
import { withRead } from '../warehouse/db.js'
import { readUser, upsertUser } from '../users/state.js'
import { ensureAgentPrincipals } from './bootstrap.js'

const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/

export interface ReplaceAgentInput {
  from: string
  to: string
  /** The new agent's display name; defaults to the old agent's. */
  name?: string
}

export interface ReplaceAgentResult {
  from: string
  to: string
  system: boolean
  /** Files written or moved, relative to the checkout. */
  changed: string[]
  /** `table.column: n` for warehouse rows that still name the old id (history and feature config). */
  references: string[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function readJson(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null
  const raw = parseBoxJsonText(readFileSync(file, 'utf8'), file)
  if (!isRecord(raw)) throw new Error(`${file}: must contain a JSON object`)
  return raw
}

function writeJson(file: string, value: Record<string, unknown>, mode?: number): void {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, mode === undefined ? {} : { mode })
  renameSync(temp, file)
}

/** Move `map[from]` to `map[to]` in place; true when something moved. */
function moveKey(map: unknown, from: string, to: string): boolean {
  if (!isRecord(map) || !(from in map)) return false
  if (to in map) throw new Error(`configuration already has an entry for "${to}"`)
  map[to] = map[from]
  delete map[from]
  return true
}

/** Exact references to `id` in the warehouse's text columns, outside the users table. */
async function warehouseReferences(id: string): Promise<string[]> {
  const columns = await withRead<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'main' AND data_type = 'VARCHAR' AND table_name <> 'users' ORDER BY table_name, column_name`,
  )
  if (!columns.length) return []
  // One query over every column: the id is a validated slug, so it is safe as a literal.
  const literal = `'${id.replaceAll("'", "''")}'`
  const union = columns
    .map(({ table_name: t, column_name: c }) => `SELECT '${t}.${c}' AS ref, count(*) AS n FROM "${t}" WHERE "${c}" = ${literal}`)
    .join(' UNION ALL ')
  const rows = await withRead<{ ref: string; n: bigint | number }>(`SELECT ref, n FROM (${union}) WHERE n > 0 ORDER BY ref`)
  return rows.map((r) => `${r.ref}: ${Number(r.n)}`)
}

export async function replaceAgent(input: ReplaceAgentInput): Promise<ReplaceAgentResult> {
  const { from, to } = input
  if (!AGENT_ID.test(to)) throw new Error(`"${to}" is not a valid agent id (a lowercase slug: a-z, 0-9, -)`)
  if (from === to) throw new Error('the new id must differ from the old one')
  await ensureAgentPrincipals()
  const old = agentConfig(from)
  const oldRow = await readUser(from)
  if (!old || !oldRow || oldRow.kind !== 'agent' || oldRow.status === 'revoked') throw new Error(`"${from}" is not an active agent`)
  if (await readUser(to)) throw new Error(`"${to}" exists already; choose a new id`)
  if (existsSync(agentFilePath(to))) throw new Error(`data/config/agents/${to}.md exists already`)
  const name = (input.name ?? old.name).trim()
  if (!name || name.length > 64 || /[\r\n"]/.test(name)) throw new Error('the name must be 1 to 64 characters on one line, without double quotes')

  const root = configRoot()
  const files = [boxJsonPath(), join(root, 'box.local.json')]
  const json = files.map(readJson)
  const changed: string[] = []

  // Validate the whole edit before writing anything: config first, then the row, then the files.
  if (old.system) {
    const holder = json[1] && isRecord(json[1].agent) && 'id' in json[1].agent ? 1 : 0
    const agent = json[holder]?.agent
    if (!isRecord(agent)) throw new Error('box.json has no agent block')
    agent.id = to
    agent.name = name
  }
  const moved = json.map((raw) => raw ? [moveKey(raw.agentProfiles, from, to), moveKey(isRecord(raw.browsers) ? raw.browsers.users : null, from, to)].some(Boolean) : false)
  const fileText = old.system ? null : agentFileText({ name, role: old.role, instructions: old.instructions })
  if (fileText) parseAgentFile(to, fileText, { system: false })

  // The new row first, as an agent: boot refuses a configured system agent without one.
  await upsertUser({ id: to, first_name: name, last_name: '', nickname: name, role: old.role, sort: 99 }, { kind: 'agent' })

  json.forEach((raw, i) => {
    const file = files[i]!
    if (raw && (moved[i] || (old.system && isRecord(raw.agent) && raw.agent.id === to))) {
      writeJson(file, raw, i === 1 ? 0o600 : undefined)
      changed.push(i === 1 ? 'box.local.json' : 'box.json')
    }
  })
  readBoxConfig(root)
  if (old.system) {
    writeFileSync(configPath('agent-identity.lock.json'), `${JSON.stringify({ id: to })}\n`)
    changed.push('data/config/agent-identity.lock.json')
    if (old.file && existsSync(old.file)) {
      renameSync(old.file, agentFilePath(to))
      changed.push(`data/config/agents/${from}.md -> ${to}.md`)
    }
  } else {
    writeFileSync(agentFilePath(to), fileText!, { flag: 'wx', mode: 0o644 })
    rmSync(agentFilePath(from), { force: true })
    changed.push(`data/config/agents/${from}.md -> ${to}.md`)
  }
  if (old.system && agentIdentity().id !== to) throw new Error('the system principal did not move to the new id')

  // Reconcile like a boot: the new agent is configured, the old one has no config and is retired.
  await ensureAgentPrincipals()
  return { from, to, system: old.system, changed, references: await warehouseReferences(from) }
}
