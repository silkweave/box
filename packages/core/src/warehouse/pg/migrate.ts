// Schema lifecycle on PostgreSQL (PHASE1.md choice 8). Run on one dedicated maintenance session
// (owner login, database `box`) that holds a session advisory lock across the contract objects,
// baseline, migrations and grants, and unlocks on the same session on success and on every failure.
//
//   1. contract objects: cluster logins and groups, database hardening, core / ext / area schemas
//   2. ledger `core.schema_migrations`, keyed `<feature>:<name>`, checked before anything writes:
//      an applied migration missing from installed code, or one whose checksum changed, refuses.
//      `core.schema_contract` holds the fingerprint of the models and baseline DDL last applied, so
//      a change there (a new table or index in an existing area) is planned like a migration
//   3. baseline: every model as CREATE TABLE IF NOT EXISTS in its owner's schema, then each
//      feature's idempotent baseline DDL, in one transaction
//   4. each pending migration and its ledger row commit in one transaction; a `concurrent`
//      migration (CREATE INDEX CONCURRENTLY) runs its statements outside one, then records
//   5. exact grants on core's shared tables and their row security (rls.ts)
//
// The checksum is SHA-256 over a canonical, length-prefixed UTF-8 encoding of the name, the
// ordered statements, the `run` revision and any bound data; never function source text.

import { createHash } from 'node:crypto'
import type pg from 'pg'
import type { ModelSpec } from '../model-spec.js'
import { buildAreaMap, CORE_SCHEMA, featureArea, type AreaMap } from './areas.js'
import { createTableSql } from './ddl.js'
import { ensureClusterObjects, ensureDatabaseObjects, grantCoreTables, grantPolicyTables, policyTablesOf } from './policy.js'
import { applyRowSecurity } from './rls.js'
import { modelColumns } from '../model-spec.js'

/** What a migration may do inside its transaction: parameterized statements on the owner session. */
export interface MigrationTx {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
  run(sql: string, params?: readonly unknown[]): Promise<number>
}

export interface PgMigration {
  /** Stable within the owner; the ledger key is `<owner>:<name>`. `NNN-slug` by convention. */
  name: string
  statements?: readonly string[] | (() => readonly string[])
  /** For a migration that must look at the database first. `revision` names this code's version
   *  and is part of the checksum: bump it when `fn` changes meaning (and only then). */
  run?: { revision: string; fn: (tx: MigrationTx) => Promise<void> }
  /** Data the statements or `run` bind (a fixed id list, a mapping); part of the checksum. */
  data?: unknown
  /** Statements that cannot run in a transaction (CREATE INDEX CONCURRENTLY). No `run`. */
  concurrent?: boolean
}

/** What the runner needs from an owner: core or a registered feature. */
export interface SchemaOwner {
  id: string
  dependsOn?: readonly string[]
  models: readonly ModelSpec[]
  baseline?: readonly string[]
  migrations: readonly PgMigration[]
}

// ---- Checksums ----

function stableJson(v: unknown): string {
  if (v === undefined) return ''
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

export function migrationStatements(m: PgMigration): string[] {
  return [...(typeof m.statements === 'function' ? m.statements() : m.statements ?? [])]
}

export function pgMigrationChecksum(m: PgMigration, statements = migrationStatements(m)): string {
  const field = (s: string) => `${Buffer.byteLength(s, 'utf8')}:${s}`
  const parts = ['box-migration-v1', m.name, String(statements.length), ...statements, m.run?.revision ?? '', m.concurrent ? 'concurrent' : 'tx', stableJson(m.data)]
  return createHash('sha256').update(parts.map(field).join('\n'), 'utf8').digest('hex')
}

// ---- Order and ownership ----

/** Core first, then owners in dependency order; ties by id. Throws on a cycle or a missing dependency. */
export function orderOwners<T extends SchemaOwner>(core: T, features: readonly T[]): T[] {
  const byId = new Map(features.map((f) => [f.id, f]))
  for (const f of features) for (const d of f.dependsOn ?? []) {
    if (!byId.has(d)) throw new Error(`feature "${f.id}" depends on "${d}", which is not present`)
  }
  const out: T[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (f: T, trail: string[]): void => {
    const s = state.get(f.id)
    if (s === 'done') return
    if (s === 'visiting') throw new Error(`feature dependency cycle: ${[...trail, f.id].join(' -> ')}`)
    state.set(f.id, 'visiting')
    for (const d of [...(f.dependsOn ?? [])].sort()) visit(byId.get(d)!, [...trail, f.id])
    state.set(f.id, 'done')
    out.push(f)
  }
  for (const f of [...features].sort((a, b) => a.id.localeCompare(b.id))) visit(f, [])
  return [core, ...out]
}

// ---- Runner ----

/** One key for the whole Box: schema work, restores and switches exclude each other. */
export const SCHEMA_LOCK_KEY = 0x426f7853 // "BoxS"
/** Agent changes through the Box and backups exclude each other on this key (after the schema lock). */
export const AGENTS_LOCK_KEY = 0x426f7841 // "BoxA"

export interface ApplyOptions {
  /** Called under the lock, before anything changes, when an existing database has pending
   *  migrations or a new area. */
  beforeMigrate?: (pending: readonly string[]) => Promise<unknown>
}

export interface ApplyResult {
  areas: AreaMap
  applied: string[]
  fresh: boolean
}

const ledger = `${CORE_SCHEMA}.schema_migrations`
const contractTable = `${CORE_SCHEMA}.schema_contract`

/** SHA-256 over the ordered models' CREATE TABLE text and baseline DDL, owner by owner. */
function contractFingerprint(ordered: readonly SchemaOwner[], areas: AreaMap): string {
  const h = createHash('sha256')
  const put = (s: string) => { const b = Buffer.from(s, 'utf8'); h.update(`${b.length}:`); h.update(b) }
  for (const o of ordered) {
    put(`owner ${o.id}`)
    const schema = areas.schemaOf(o.id)
    for (const m of o.models) put(createTableSql(m, schema))
    for (const sql of o.baseline ?? []) put(sql)
  }
  return h.digest('hex')
}

function txOf(c: pg.Client): MigrationTx {
  return {
    async query<T>(sql: string, params?: readonly unknown[]) { return (await c.query({ text: sql, values: params ? [...params] : [] })).rows as T[] },
    async run(sql: string, params?: readonly unknown[]) { return (await c.query({ text: sql, values: params ? [...params] : [] })).rowCount ?? 0 },
  }
}

async function inTx<T>(c: pg.Client, fn: () => Promise<T>): Promise<T> {
  await c.query('begin')
  try { const r = await fn(); await c.query('commit'); return r }
  catch (e) { await c.query('rollback').catch(() => {}); throw e }
}

/**
 * Bring the Box database to the installed schema. `owner` is a connected owner-login client on
 * the `box` database used for nothing else while this runs.
 */
export async function applyPgSchema(owner: pg.Client, core: SchemaOwner, features: readonly SchemaOwner[], opts: ApplyOptions = {}): Promise<ApplyResult> {
  const ordered = orderOwners(core, features)
  const areas = buildAreaMap(core.models, features)
  const planned = ordered.flatMap((o) => o.migrations.map((m) => {
    const statements = migrationStatements(m)
    if (m.concurrent && m.run) throw new Error(`migration ${o.id}:${m.name} is concurrent and cannot have run()`)
    return { owner: o.id, m, statements, key: `${o.id}:${m.name}`, checksum: pgMigrationChecksum(m, statements) }
  }))
  const seen = new Set<string>()
  for (const p of planned) { if (seen.has(p.key)) throw new Error(`migration ${p.key} is declared twice`); seen.add(p.key) }

  const fingerprint = contractFingerprint(ordered, areas)
  await owner.query('select pg_advisory_lock($1)', [SCHEMA_LOCK_KEY])
  try {
    const featureAreas = features.map((f) => featureArea(f))
    const fresh = !(await owner.query(`select 1 from pg_namespace where nspname = $1`, [CORE_SCHEMA])).rowCount
    const hasTable = async (t: string) => (await owner.query(`select 1 from pg_tables where schemaname = $1 and tablename = $2`, [CORE_SCHEMA, t])).rowCount! > 0
    // The ledger is checked before anything writes: edited or missing history refuses here.
    const rows = await hasTable('schema_migrations') ? (await owner.query<{ name: string; checksum: string }>(`select name, checksum from ${ledger}`)).rows : []
    const current = new Map(planned.map((p) => [p.key, p]))
    const installed = new Set(ordered.map((o) => o.id))
    for (const { name, checksum } of rows) {
      const entry = current.get(name)
      const ownerId = name.slice(0, name.indexOf(':'))
      if (!entry && installed.has(ownerId)) throw new Error(`applied migration ${name} is missing from installed code; restore its append-only history`)
      if (entry && checksum !== entry.checksum) throw new Error(`migration ${name} checksum changed; restore the shipped migration and append a new one`)
    }
    const applied = new Set(rows.map((r) => r.name))
    const pending = planned.filter((p) => !applied.has(p.key))
    // Plan before any mutation (R5): an existing database with pending migrations, a new area or
    // a changed model/baseline contract gets its pre-migrate restore point while nothing changed.
    if (!fresh && opts.beforeMigrate) {
      const stored = await hasTable('schema_contract') ? (await owner.query<{ fingerprint: string }>(`select fingerprint from ${contractTable} where id = 1`)).rows[0]?.fingerprint ?? null : null
      const schemas = new Set((await owner.query<{ n: string }>(`select nspname n from pg_namespace`)).rows.map((r) => r.n))
      const newAreas = featureAreas.filter((a) => !schemas.has(areas.schemaOf(a))).map((a) => `area ${a}`)
      const contract = stored === fingerprint ? [] : ['models and baseline DDL changed']
      const changes = [...pending.map((p) => p.key), ...newAreas, ...contract]
      if (changes.length) await opts.beforeMigrate(changes)
    }
    await inTx(owner, async () => {
      await ensureClusterObjects(owner, featureAreas)
      await ensureDatabaseObjects(owner, featureAreas)
      await owner.query(`create table if not exists ${ledger} (
        name text primary key check (position(':' in name) > 1),
        feature text not null,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`)
      await owner.query(`create table if not exists ${contractTable} (
        id int primary key check (id = 1),
        fingerprint text not null,
        applied_at timestamptz not null default now()
      )`)
    })

    await inTx(owner, async () => {
      for (const o of ordered) {
        const schema = areas.schemaOf(o.id)
        for (const m of o.models) await owner.query(createTableSql(m, schema))
      }
      for (const o of ordered) for (const sql of o.baseline ?? []) await owner.query(sql)
      await owner.query(`insert into ${contractTable} (id, fingerprint) values (1, $1)
        on conflict (id) do update set fingerprint = excluded.fingerprint, applied_at = now()
        where ${contractTable}.fingerprint is distinct from excluded.fingerprint`, [fingerprint])
    })

    const done: string[] = []
    for (const p of pending) {
      try {
        if (p.m.concurrent) {
          for (const sql of p.statements) await owner.query(sql)
          await owner.query(`insert into ${ledger} (name, feature, checksum) values ($1, $2, $3)`, [p.key, p.owner, p.checksum])
        } else {
          await inTx(owner, async () => {
            for (const sql of p.statements) await owner.query(sql)
            await p.m.run?.fn(txOf(owner))
            await owner.query(`insert into ${ledger} (name, feature, checksum) values ($1, $2, $3)`, [p.key, p.owner, p.checksum])
          })
        }
      } catch (err) {
        throw new Error(`migration ${p.key} failed: ${String((err as Error)?.message ?? err)}`, { cause: err })
      }
      done.push(p.key)
    }

    await inTx(owner, async () => {
      await grantCoreTables(owner, core.models.map((m) => m.table), usersColumns(core))
      await grantPolicyTables(owner, policyTablesOf(features.map((f) => ({ id: featureArea(f), models: f.models }))))
      await applyRowSecurity(owner, core.models.map((m) => m.table))
    })
    return { areas, applied: done, fresh }
  } finally {
    await owner.query('select pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY]).catch(() => {})
  }
}

/** core.users' columns, for the column grants (empty when core declares no users model). */
function usersColumns(core: SchemaOwner): string[] {
  const users = core.models.find((m) => m.table === 'users')
  return users ? Object.keys(modelColumns(users)) : []
}
