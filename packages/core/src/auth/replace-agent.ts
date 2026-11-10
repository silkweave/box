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
import { CORE_SCHEMA, quoteIdent } from '../warehouse/pg/areas.js'
import { boxAreas } from '../warehouse/tables.js'
import { asSystem } from '../request-context.js'
import { readUser, upsertUser } from '../users/state.js'
import { ensureAgentPrincipals } from './bootstrap.js'
import { withAgentsLock } from '../warehouse/pg/boot.js'
import { clearReplaceIntent, interruptedAgentChange, readReplaceIntent, replaceIntentPath, writeReplaceIntent } from '../warehouse/agent-snapshot.js'

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

/** Exact references to `id` in the Box's text columns, outside core.users. Reads every area's
 *  tables, so it runs as system work (a named system scope, not the caller's role login). */
function warehouseReferences(id: string): Promise<string[]> {
  return asSystem('replace-agent: reference scan', async () => {
    const areas = boxAreas()
    const schemas = [CORE_SCHEMA, ...areas.areas.map((a) => areas.schemaOf(a))]
    // Raw on purpose (kept off Kysely): a catalog scan of information_schema across every area's
    // schema, and per-table count unions whose table and column names are only known at run time.
    const columns = await withRead<{ table_schema: string; table_name: string; column_name: string }>(
      `select table_schema, table_name, column_name from information_schema.columns
        where table_schema = any($1::text[]) and data_type = 'text'
          and not (table_schema = $2 and table_name in ('users', 'role_logins', 'schema_migrations', 'schema_contract'))
        order by table_schema, table_name, column_name`,
      [schemas, CORE_SCHEMA],
    )
    // A few queries over every column (pgrust caps the size of one plan); identifiers are
    // validated and quoted, the id is a parameter.
    const out: string[] = []
    for (let i = 0; i < columns.length; i += 32) {
      const union = columns.slice(i, i + 32)
        .map(({ table_schema: s, table_name: t, column_name: c }) =>
          `select ${quoteLiteral(`${s === CORE_SCHEMA ? '' : `${s}.`}${t}.${c}`)} as ref, count(*) as n from ${quoteIdent(s)}.${quoteIdent(t)} where ${quoteIdent(c)} = $1`)
        .join(' union all ')
      const rows = await withRead<{ ref: string; n: number }>(`select ref, n from (${union}) r where n > 0`, [id])
      out.push(...rows.map((r) => `${r.ref}: ${Number(r.n)}`))
    }
    return out.sort()
  })
}

const quoteLiteral = (s: string) => `'${s.replaceAll("'", "''")}'`

export async function replaceAgent(input: ReplaceAgentInput): Promise<ReplaceAgentResult> {
  const { from, to } = input
  if (!AGENT_ID.test(to)) throw new Error(`"${to}" is not a valid agent id (a lowercase slug: a-z, 0-9, -)`)
  if (from === to) throw new Error('the new id must differ from the old one')

  // An interrupted run of this same replacement resumes from its intent record; any other
  // replacement waits for it.
  const pending = readReplaceIntent()
  if (pending && (pending.from !== from || pending.to !== to)) throw new Error(interruptedAgentChange()!)
  let intent: ReplaceStep
  if (pending) {
    intent = pending as unknown as ReplaceStep
    if (typeof intent.system !== 'boolean' || typeof intent.name !== 'string' || typeof intent.role !== 'string') {
      throw new Error(`${replaceIntentPath()} is not a replacement this version wrote; complete it by hand and delete it`)
    }
  } else {
    await ensureAgentPrincipals()
    const old = agentConfig(from)
    const oldRow = await readUser(from)
    if (!old || !oldRow || oldRow.kind !== 'agent' || oldRow.status === 'revoked') throw new Error(`"${from}" is not an active agent`)
    if (await readUser(to)) throw new Error(`"${to}" exists already; choose a new id`)
    if (existsSync(agentFilePath(to))) throw new Error(`data/config/agents/${to}.md exists already`)
    const name = (input.name ?? old.name).trim()
    if (!name || name.length > 64 || /[\r\n"]/.test(name)) throw new Error('the name must be 1 to 64 characters on one line, without double quotes')
    const fileText = old.system ? null : agentFileText({ name, role: old.role, instructions: old.instructions })
    if (fileText) parseAgentFile(to, fileText, { system: false })
    intent = { from, to, step: 'start', system: old.system, name, role: old.role, fileText }
    // Validated in full; from here every step is journaled and repeatable.
    writeReplaceIntent(intent)
  }
  const changed = await withAgentsLock(() => applyReplacement(intent))
  clearReplaceIntent()

  // Reconcile like a boot: the new agent is configured, the old one has no config and is retired.
  await ensureAgentPrincipals()
  return { from, to, system: intent.system, changed, references: await warehouseReferences(from) }
}

type ReplaceStep = {
  from: string
  to: string
  step: string
  system: boolean
  name: string
  role: string
  fileText: string | null
}

/**
 * The replacement's writes, each repeatable: a re-run after a crash finds the done steps done and
 * completes the rest. The intent record names the last step started.
 */
async function applyReplacement(intent: ReplaceStep): Promise<string[]> {
  const { from, to, system, name } = intent
  const step = (s: string) => writeReplaceIntent({ ...intent, step: s })
  const changed: string[] = []

  // The new row first, as an agent: boot refuses a configured system agent without one.
  step('row')
  await upsertUser({ id: to, first_name: name, last_name: '', nickname: name, role: intent.role as never, sort: 99 }, { kind: 'agent' })

  step('config')
  const root = configRoot()
  const files = [boxJsonPath(), join(root, 'box.local.json')]
  const json = files.map(readJson)
  if (system) {
    const holder = json[1] && isRecord(json[1].agent) && 'id' in json[1].agent ? 1 : 0
    const agent = json[holder]?.agent
    if (!isRecord(agent)) throw new Error('box.json has no agent block')
    agent.id = to
    agent.name = name
  }
  const moved = json.map((raw) => raw ? [moveKey(raw.agentProfiles, from, to), moveKey(isRecord(raw.browsers) ? raw.browsers.users : null, from, to)].some(Boolean) : false)
  json.forEach((raw, i) => {
    const file = files[i]!
    if (raw && (moved[i] || (system && isRecord(raw.agent) && raw.agent.id === to))) {
      writeJson(file, raw, i === 1 ? 0o600 : undefined)
      changed.push(i === 1 ? 'box.local.json' : 'box.json')
    }
  })
  readBoxConfig(root)

  step('files')
  if (system) {
    writeFileSync(configPath('agent-identity.lock.json'), `${JSON.stringify({ id: to })}\n`)
    changed.push('data/config/agent-identity.lock.json')
    const oldFile = agentFilePath(from)
    if (existsSync(oldFile) && !existsSync(agentFilePath(to))) {
      renameSync(oldFile, agentFilePath(to))
      changed.push(`data/config/agents/${from}.md -> ${to}.md`)
    }
    if (agentIdentity().id !== to) throw new Error('the system principal did not move to the new id')
  } else {
    if (!existsSync(agentFilePath(to))) writeFileSync(agentFilePath(to), intent.fileText!, { flag: 'wx', mode: 0o644 })
    rmSync(agentFilePath(from), { force: true })
    changed.push(`data/config/agents/${from}.md -> ${to}.md`)
  }
  return changed
}
