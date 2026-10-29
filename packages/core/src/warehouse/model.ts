// The record layer - one shared implementation of the row↔domain plumbing every warehouse entity
// used to hand-roll (the Row interface + CAST column list + toX() mapper + read-prev-then-merge
// upsert, previously copied ~8 times across the state modules). A ModelSpec describes a table once
// (warehouse/models.ts); this module derives from it:
//
//   • the CREATE TABLE DDL (schema.ts baselines every model at boot),
//   • the SELECT column list (JSON/TIMESTAMP columns CAST to VARCHAR for JSON-safe reads),
//   • the row → domain mapping (JSON parsed, naive-UTC timestamps re-attached a Z),
//   • enum validation on write (DuckDB has no CHECK constraints here - this is the app-level gate),
//   • the partial UPSERT (missing input keys keep the previous row's values), with `timestamps`
//     (created_at/updated_at) and `audit` (created_by/updated_by from `actor`) managed centrally.
//
// Domain semantics stay in the domain modules: cascade deletes, re-keying renames, deep-merge
// bags, derived signals, side-effect hooks. This layer only owns the mechanical plumbing.

import type { DuckDBValue } from '@duckdb/node-api'
import { emitChange } from '../changes.js'
import { ensureSchema, withRead, withWrite } from './db.js'

export type ColumnKind = 'text' | 'int' | 'bigint' | 'float' | 'bool' | 'json' | 'timestamp' | 'date'

export interface ColumnSpec {
  kind: ColumnKind
  /** Columns are NOT NULL unless explicitly nullable (PK columns are always NOT NULL). */
  nullable?: boolean
  /** SQL default, emitted verbatim into the DDL (quote string literals yourself: `"'draft'"`). */
  default?: string
  /** Allowed values, validated on every write - the app-level CHECK constraint. A thunk when the
   *  list is tenant configuration rather than code (`initiatives.kind`), so the gate reads whatever
   *  the team's list says at write time instead of what it said at import time. */
  enum?: readonly string[] | (() => readonly string[])
}

export interface ModelSpec {
  table: string
  /** Primary-key column names (must exist in `columns`). */
  pk: readonly string[]
  columns: Record<string, ColumnSpec>
  /** Adds managed created_at/updated_at TIMESTAMP columns. */
  timestamps?: boolean
  /** Adds managed created_by/updated_by columns, stamped from the upsert input's `actor`. */
  audit?: boolean
}

// --- timestamp handling (one rule for every table) -------------------------------------------------
// DuckDB TIMESTAMP is timezone-naive and a CAST silently DROPS a string's offset. One convention:
// naive values in the file ARE UTC. Writes normalize any ISO offset to naive UTC; reads re-attach
// the Z. (Previously solved only in content/state.ts; every other module had its own ad-hoc path.)

/** ISO-8601 (any offset) → naive UTC `YYYY-MM-DD HH:MM:SS` for a DuckDB TIMESTAMP write. */
export function toNaiveUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`invalid timestamp "${iso}"`)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/** Naive UTC string from a DuckDB read (`YYYY-MM-DD HH:MM:SS[.ffffff]`) → ISO-8601 with Z. */
export function fromNaiveUtc(value: string): string {
  if (value.includes('Z') || /[+-]\d\d:\d\d$/.test(value)) return value
  return `${value.replace(' ', 'T')}Z`
}

// --- DDL + column lists ---------------------------------------------------------------------------

const SQL_TYPE: Record<ColumnKind, string> = {
  text: 'VARCHAR',
  int: 'INTEGER',
  // For values that outgrow INTEGER's 32 bits - epoch milliseconds being the case that
  // introduced it (auth's sign-in-link watermark). Deliberately NOT a TIMESTAMP: a value the
  // record layer round-trips through toNaiveUtc loses its milliseconds, and a watermark that
  // silently moves BACKWARDS re-arms an already-consumed credential.
  bigint: 'BIGINT',
  float: 'DOUBLE',
  bool: 'BOOLEAN',
  json: 'JSON',
  timestamp: 'TIMESTAMP',
  date: 'DATE',
}

/** Every column of the model, managed ones included, in declaration order. */
export function modelColumns(m: ModelSpec): Record<string, ColumnSpec> {
  const cols: Record<string, ColumnSpec> = { ...m.columns }
  if (m.timestamps) {
    cols.created_at = { kind: 'timestamp', default: 'now()' }
    cols.updated_at = { kind: 'timestamp', default: 'now()' }
  }
  if (m.audit) {
    cols.created_by = { kind: 'text', nullable: true }
    cols.updated_by = { kind: 'text', nullable: true }
  }
  return cols
}

/** Idempotent CREATE TABLE for the model - the baseline DDL schema.ts runs at boot. */
export function createTableSql(m: ModelSpec): string {
  const cols = modelColumns(m)
  const lines = Object.entries(cols).map(([name, c]) => {
    const notNull = m.pk.includes(name) || !c.nullable ? ' NOT NULL' : ''
    const def = c.default !== undefined ? ` DEFAULT ${c.default}` : ''
    return `        ${name} ${SQL_TYPE[c.kind]}${notNull}${def}`
  })
  lines.push(`        PRIMARY KEY (${m.pk.join(', ')})`)
  return `CREATE TABLE IF NOT EXISTS ${m.table} (\n${lines.join(',\n')}\n      )`
}

/** SELECT list with JSON/TIMESTAMP columns CAST to VARCHAR so reads stay JSON-safe strings. */
export function selectCols(m: ModelSpec): string {
  return Object.entries(modelColumns(m))
    .map(([name, c]) =>
      c.kind === 'json' || c.kind === 'timestamp' ? `CAST(${name} AS VARCHAR) AS ${name}` : name,
    )
    .join(', ')
}

// --- row → domain mapping -------------------------------------------------------------------------

const parseJson = <T>(json: string | null | undefined, fallback: T): T => {
  if (json == null) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

/** Map a raw (VARCHAR-cast) row to the domain shape: JSON parsed, timestamps → ISO-Z strings. */
export function rowToRecord<T>(m: ModelSpec, row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [name, c] of Object.entries(modelColumns(m))) {
    const v = row[name]
    if (v == null) {
      out[name] = null
      continue
    }
    if (c.kind === 'json') out[name] = parseJson(v as string, null)
    else if (c.kind === 'timestamp') out[name] = fromNaiveUtc(String(v))
    else if (c.kind === 'int' || c.kind === 'float') out[name] = Number(v)
    else if (c.kind === 'bool') out[name] = v === true || v === 'true'
    else out[name] = v
  }
  return out as T
}

/** JSON with keys sorted at every level, so two bags with the same content compare equal whatever
 *  order a fetcher happened to build them in. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/**
 * Would writing `next` change what `prev` already says? Compared column by column over the model's
 * DECLARED columns only (managed timestamps/audit excluded), each at the precision the table stores
 * it: JSON by content not key order, timestamps at whole seconds (a DuckDB TIMESTAMP write drops the
 * milliseconds, so an ISO input with `.123Z` must not read as a change against its own stored
 * value), numbers as numbers.
 *
 * This exists for the machine writers: a nightly sync re-asserting unchanged data must NOT write,
 * because an upsert always restamps `updated_at` / `updated_by` - and a human's assignment stamped
 * over by "nova, last night" every night is an audit trail that says nothing.
 */
export function sameRecord(m: ModelSpec, prev: object, next: object): boolean {
  const p = prev as Record<string, unknown>
  const n = next as Record<string, unknown>
  for (const [name, c] of Object.entries(m.columns)) {
    const a = p[name]
    const b = n[name]
    if (a == null || b == null) {
      if ((a ?? null) !== (b ?? null)) return false
      continue
    }
    if (c.kind === 'json') {
      if (stableJson(a) !== stableJson(b)) return false
    } else if (c.kind === 'timestamp') {
      if (toNaiveUtc(String(a)) !== toNaiveUtc(String(b))) return false
    } else if (c.kind === 'int' || c.kind === 'float') {
      if (Number(a) !== Number(b)) return false
    } else if (c.kind === 'bool') {
      if ((a === true || a === 'true') !== (b === true || b === 'true')) return false
    } else if (String(a) !== String(b)) return false
  }
  return true
}

// --- validation -----------------------------------------------------------------------------------

/** App-level CHECK constraint: reject values outside a column's declared enum. */
export function validateEnums(m: ModelSpec, values: Record<string, unknown>): void {
  for (const [name, c] of Object.entries(m.columns)) {
    const v = values[name]
    if (v == null || !c.enum) continue
    const allowed = typeof c.enum === 'function' ? c.enum() : c.enum
    if (!allowed.includes(v as string)) {
      throw new Error(`${m.table}.${name}: invalid value "${String(v)}" (allowed: ${allowed.join(', ')})`)
    }
  }
}

// --- CRUD -----------------------------------------------------------------------------------------

export interface ReadOptions {
  where?: string
  params?: DuckDBValue[]
  orderBy?: string
}

export async function readRecords<T>(m: ModelSpec, opts: ReadOptions = {}): Promise<T[]> {
  await ensureSchema()
  const sql = `SELECT ${selectCols(m)} FROM ${m.table}${opts.where ? ` WHERE ${opts.where}` : ''}${
    opts.orderBy ? ` ORDER BY ${opts.orderBy}` : ''
  }`
  const rows = await withRead<Record<string, unknown>>(sql, opts.params)
  return rows.map((r) => rowToRecord<T>(m, r))
}

export async function readRecord<T>(m: ModelSpec, pk: Record<string, DuckDBValue>): Promise<T | null> {
  const where = m.pk.map((c) => `${c} = ?`).join(' AND ')
  const rows = await readRecords<T>(m, { where, params: m.pk.map((c) => pk[c] ?? null) })
  return rows[0] ?? null
}

/** The upsert input: PK columns required, everything else optional; `actor` stamps the audit trail. */
export type UpsertInput = Record<string, unknown> & { actor?: string }

export interface UpsertOptions {
  /** The previous row, when the caller already read it for its own merge decisions - skips the
   *  internal read. Pass `null` for a known-absent row. (Typed `object` so domain records assign
   *  without an index signature; the layer only reads columns declared in the model.) */
  prev?: object | null
}

const toDbValue = (c: ColumnSpec, v: unknown): DuckDBValue => {
  if (v == null) return null
  if (c.kind === 'json') return JSON.stringify(v)
  if (c.kind === 'timestamp') return toNaiveUtc(String(v))
  if (c.kind === 'bool') return v === true || v === 'true'
  return v as DuckDBValue
}

/**
 * Partial UPSERT: reads the previous row, merges (input keys - including explicit nulls - override;
 * absent keys keep previous values or fall to defaults), validates enums, stamps timestamps + audit,
 * writes INSERT … ON CONFLICT DO UPDATE, and returns the mapped row. Domain modules that need a
 * non-shallow merge (e.g. a feature's metadata deep-merge) resolve it BEFORE calling this.
 */
export async function upsertRecord<T>(m: ModelSpec, input: UpsertInput, opts: UpsertOptions = {}): Promise<T> {
  await ensureSchema()
  const { actor: rawActor, ...fields } = input
  // An empty/blank actor is "nobody said" - stamping '' would be a third value beside a real id and
  // NULL that nothing downstream distinguishes.
  const actor = rawActor?.trim() || undefined
  for (const c of m.pk) {
    if (fields[c] == null || fields[c] === '') throw new Error(`${m.table}: upsert needs "${c}"`)
  }
  // The audit stamp is validated here rather than per domain module: this is the only place an
  // `actor` becomes created_by/updated_by, and created_by is unrewritable through the tool surface,
  // so a bad id is permanent. Lazily imported - users/state.ts is built on this module.
  if (m.audit && actor) {
    const { assertKnownActor } = await import('../users/state.js')
    await assertKnownActor(actor)
  }
  const prev = (
    opts.prev !== undefined
      ? opts.prev
      : await readRecord<Record<string, unknown>>(
          m,
          Object.fromEntries(m.pk.map((c) => [c, fields[c] as DuckDBValue])),
        )
  ) as Record<string, unknown> | null
  validateEnums(m, fields)

  const now = new Date().toISOString()
  const merged: Record<string, unknown> = {}
  for (const name of Object.keys(m.columns)) {
    merged[name] = name in fields ? fields[name] : (prev?.[name] ?? null)
  }
  if (m.timestamps) {
    merged.created_at = prev?.created_at ?? now
    merged.updated_at = now
  }
  if (m.audit) {
    merged.created_by = prev ? (prev.created_by ?? null) : (actor ?? null)
    merged.updated_by = actor ?? (prev?.updated_by ?? null)
  }

  const cols = modelColumns(m)
  const names = Object.keys(cols)
  const updates = names
    .filter((n) => !m.pk.includes(n) && n !== 'created_at' && n !== 'created_by')
    .map((n) => `${n} = excluded.${n}`)
  await withWrite(async (conn) => {
    await conn.run(
      `INSERT INTO ${m.table} (${names.join(', ')})
       VALUES (${names.map((n) => (cols[n].kind === 'json' ? '?::JSON' : '?')).join(', ')})
       ON CONFLICT (${m.pk.join(', ')}) DO UPDATE SET ${updates.join(', ')}`,
      names.map((n) => toDbValue(cols[n], merged[n])),
    )
  })
  emitChange(`table:${m.table}`)
  return (await readRecord<T>(m, Object.fromEntries(m.pk.map((c) => [c, fields[c] as DuckDBValue]))))!
}

export async function deleteRecord(m: ModelSpec, pk: Record<string, DuckDBValue>): Promise<void> {
  await ensureSchema()
  const where = m.pk.map((c) => `${c} = ?`).join(' AND ')
  await withWrite(async (conn) => {
    await conn.run(`DELETE FROM ${m.table} WHERE ${where}`, m.pk.map((c) => pk[c] ?? null))
  })
  emitChange(`table:${m.table}`)
}
