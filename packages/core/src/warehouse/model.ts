// The record layer: one shared implementation of the row <-> domain plumbing for every table a
// ModelSpec describes. From the spec it derives:
//
//   - the DDL (pg/ddl.ts; the schema runner creates every model at boot),
//   - the SELECT column list and the row -> domain mapping (the executor's type parsers already
//     return timestamps as exact ISO `...Z` strings, dates as `YYYY-MM-DD`, jsonb parsed),
//   - enum validation on write (the app-level gate; enum lists can be tenant configuration),
//   - the partial UPSERT (missing input keys keep the previous row's values), with `timestamps`
//     (created_at/updated_at) and `audit` (created_by/updated_by from `actor`) managed centrally,
//     read, merged and written in one transaction with the previous row locked.
//
// Tables are schema-qualified through the area map (tables.ts); core's shared tables run on
// box_core (`reach: 'core'`), a feature's on the caller's role login. Placeholders are `$n`.
// The statements here are generic over a runtime ModelSpec (table and columns known only at
// run time), so they stay parameterized strings; typed queries on a known table use Kysely
// (kysely.ts) next to this layer.
// Domain semantics stay in the domain modules: cascade deletes, re-keying renames, deep-merge
// bags, derived signals, side-effect hooks.

import { emitAreaChange, emitChange } from '../changes.js'
import { withRead, withWrite, type Tx } from './pg/store.js'
import { quoteIdent } from './pg/areas.js'
import { columnType } from './pg/ddl.js'
import { reachOf, table } from './tables.js'

export { modelColumns, type ColumnKind, type ColumnSpec, type ModelSpec } from './model-spec.js'
import { modelColumns, type ColumnSpec, type ModelSpec } from './model-spec.js'

// --- instants ---------------------------------------------------------------------------------------
// timestamptz columns hold instants. Writes pass ISO-8601 text (an offset, or none for UTC: every
// executor session runs in UTC); reads come back as `YYYY-MM-DDTHH:MM:SS[.ffffff]Z`.

const ISO_TEXT = /^(\d{4}-\d\d-\d\d)(?:[T ](\d\d:\d\d(?::\d\d)?)(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d\d(?::?\d\d)?)?$/i

/** An instant for a timestamptz write: ISO text passes through unchanged (precision kept); any
 *  other date string JavaScript understands is converted; anything else throws. */
export function toInstant(v: unknown): string {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error('invalid timestamp (Invalid Date)')
    return v.toISOString()
  }
  const s = String(v).trim()
  if (ISO_TEXT.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw new Error(`invalid timestamp "${s}"`)
  return d.toISOString()
}

/** Microseconds since the epoch, for comparing instants written in different forms. */
export function instantMicros(v: unknown): bigint {
  const s = toInstant(v)
  const m = ISO_TEXT.exec(s)
  if (!m) return BigInt(Date.parse(s)) * 1000n
  let off = (m[4] ?? 'Z').toUpperCase()
  if (off !== 'Z') off = off.length === 3 ? `${off}:00` : off.includes(':') ? off : `${off.slice(0, 3)}:${off.slice(3)}`
  const time = m[2] ? (m[2].length === 5 ? `${m[2]}:00` : m[2]) : '00:00:00'
  const ms = Date.parse(`${m[1]}T${time}${off}`)
  if (Number.isNaN(ms)) throw new Error(`invalid timestamp "${s}"`)
  const micros = BigInt((m[3] ?? '').padEnd(6, '0').slice(0, 6))
  return BigInt(ms) * 1000n + micros
}

// --- columns ---------------------------------------------------------------------------------------

/** The quoted SELECT list of every column. */
export function selectCols(m: ModelSpec): string {
  return Object.keys(modelColumns(m)).map(quoteIdent).join(', ')
}

// --- row -> domain mapping --------------------------------------------------------------------------

const parseJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

/** Map a row to the domain shape: JSON parsed, numbers as numbers, booleans as booleans. */
export function rowToRecord<T>(m: ModelSpec, row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [name, c] of Object.entries(modelColumns(m))) {
    const v = row[name]
    if (v == null) {
      out[name] = null
      continue
    }
    if (c.kind === 'json') out[name] = parseJson(v)
    else if (c.kind === 'int' || c.kind === 'float') out[name] = Number(v)
    else if (c.kind === 'bool') out[name] = v === true || v === 'true'
    else if (c.kind === 'vector') out[name] = typeof v === 'string' ? (JSON.parse(v) as number[]) : v
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
 * The fields of an update that change the row as it was read, with its key and the actor. An update
 * sends only these and upsertRecord merges every other column from the row it locks in its own
 * write: carrying a column forward from an unlocked read would write a stale value back over a
 * concurrent writer's change (a lost update). A value that does not compare equal is sent. `prev`
 * is the row as stored (the column representation sameRecord compares).
 *
 * `groups` names columns the caller derives together (a status and its completion stamp, a sprint
 * and its day slot): when any column of a group changes, the whole group is sent. Without it a
 * derived clear that equals the read (done_at already null when reopening) is dropped, and the
 * merge keeps a concurrent writer's value beside this write's status: a row neither write asked for.
 */
export function changedColumns(
  m: ModelSpec,
  prev: object,
  next: Record<string, unknown>,
  groups: readonly (readonly string[])[] = [],
): Record<string, unknown> {
  const changed = new Set(
    Object.entries(next)
      .filter(([k, v]) => {
        const c = m.columns[k]
        return !c || m.pk.includes(k) || !sameRecord({ ...m, columns: { [k]: c } }, prev, { [k]: v })
      })
      .map(([k]) => k),
  )
  for (const group of groups) {
    if (group.some((k) => changed.has(k))) for (const k of group) if (k in next) changed.add(k)
  }
  return Object.fromEntries(Object.entries(next).filter(([k]) => changed.has(k)))
}

/**
 * Would writing `next` change what `prev` already says? Compared column by column over the model's
 * DECLARED columns only (managed timestamps/audit excluded): JSON by content not key order,
 * timestamps as instants (`...+01:00` equals the same instant in `Z`), numbers as numbers.
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
      if (stableJson(parseJson(a)) !== stableJson(parseJson(b))) return false
    } else if (c.kind === 'timestamp') {
      if (instantMicros(a) !== instantMicros(b)) return false
    } else if (c.kind === 'int' || c.kind === 'float' || c.kind === 'bigint') {
      if (Number(a) !== Number(b)) return false
    } else if (c.kind === 'bool') {
      if ((a === true || a === 'true') !== (b === true || b === 'true')) return false
    } else if (String(a) !== String(b)) return false
  }
  return true
}

// --- validation -------------------------------------------------------------------------------------

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

// --- CRUD -------------------------------------------------------------------------------------------

export interface ReadOptions {
  /** A condition with `$n` placeholders numbered from 1, matching `params`. */
  where?: string
  params?: readonly unknown[]
  /** Spliced verbatim: code-owned column lists only, never input. */
  orderBy?: string
  limit?: number
}

function selectSql(m: ModelSpec, opts: ReadOptions): string {
  if (opts.limit !== undefined && !(Number.isInteger(opts.limit) && opts.limit >= 0)) throw new Error(`invalid limit ${opts.limit}`)
  return `select ${selectCols(m)} from ${table(m)}${opts.where ? ` where ${opts.where}` : ''}${
    opts.orderBy ? ` order by ${opts.orderBy}` : ''
  }${opts.limit !== undefined ? ` limit ${opts.limit}` : ''}`
}

export async function readRecords<T>(m: ModelSpec, opts: ReadOptions = {}): Promise<T[]> {
  const rows = await withRead<Record<string, unknown>>(selectSql(m, opts), opts.params, { reach: reachOf(m) })
  return rows.map((r) => rowToRecord<T>(m, r))
}

const pkWhere = (m: ModelSpec, from = 1) => m.pk.map((c, i) => `${quoteIdent(c)} = $${i + from}`).join(' and ')
const pkValues = (m: ModelSpec, pk: Record<string, unknown>) => m.pk.map((c) => pk[c] ?? null)

export async function readRecord<T>(m: ModelSpec, pk: Record<string, unknown>): Promise<T | null> {
  const rows = await readRecords<T>(m, { where: pkWhere(m), params: pkValues(m, pk) })
  return rows[0] ?? null
}

/** The upsert input: PK columns required, everything else optional; `actor` stamps the audit trail. */
export type UpsertInput = Record<string, unknown> & { actor?: string }

export interface UpsertOptions {
  /** The previous row, when the caller already read it for its own merge decisions - skips the
   *  internal read. Pass `null` for a known-absent row. The caller is then responsible for having
   *  read it in the same transaction (with FOR UPDATE) when concurrent writers matter. */
  prev?: object | null
  /** Columns this write may not touch (not inserted, not updated). */
  omit?: readonly string[]
  /** Refuse instead of inserting when the row (locked in this transaction) is gone: an update of
   *  an existing row must never fall back to column defaults. */
  mustExist?: boolean
  /** Create only: a plain INSERT; a row already under the key refuses (never turned into an update). */
  createOnly?: boolean
  /** The caller ran `assertKnownActor` on `input.actor` before opening its own transaction: needed
   *  when this upsert runs inside a feature write, where the check (core.users on box_core) cannot. */
  actorChecked?: boolean
}

/** A value as a query parameter for a column of `kind`. */
export function toParam(c: ColumnSpec, v: unknown): unknown {
  if (v == null) return null
  if (c.kind === 'json') return JSON.stringify(v)
  if (c.kind === 'timestamp') return toInstant(v)
  if (c.kind === 'bool') return v === true || v === 'true'
  if (c.kind === 'vector') return vectorLiteral(v)
  return v
}

/** pgvector's text form `[x,y,...]` of a number list; refuses anything else. */
export function vectorLiteral(v: unknown): string {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new Error('a vector value must be a list of finite numbers')
  return `[${v.join(',')}]`
}

/**
 * Partial UPSERT in one transaction: locks and reads the previous row, merges (input keys -
 * including explicit nulls - override; absent keys keep previous values or fall to defaults),
 * validates enums, stamps timestamps + audit, writes INSERT ... ON CONFLICT DO UPDATE, and returns
 * the written row. Domain modules that need a non-shallow merge resolve it BEFORE calling this.
 */
export async function upsertRecord<T>(m: ModelSpec, input: UpsertInput, opts: UpsertOptions = {}): Promise<T> {
  const { actor: rawActor, ...fields } = input
  // An empty/blank actor is "nobody said" - stamping '' would be a third value beside a real id and
  // NULL that nothing downstream distinguishes.
  const actor = rawActor?.trim() || undefined
  for (const c of m.pk) {
    if (fields[c] == null || fields[c] === '') throw new Error(`${m.table}: upsert needs "${c}"`)
  }
  validateEnums(m, fields)
  // The audit stamp is validated here rather than per domain module: this is the only place an
  // `actor` becomes created_by/updated_by, and created_by is unrewritable through the tool surface,
  // so a bad id is permanent. It reads core.users on box_core, so it runs before the write opens
  // (a feature write runs on the role login; the executor refuses a second login inside it).
  // Lazily imported - users/state.ts is built on this module.
  if (m.audit && actor && !opts.actorChecked) {
    const { assertKnownActor } = await import('../users/state.js')
    await assertKnownActor(actor)
  }
  const cols = modelColumns(m)
  // `omit`: columns this path may not write (a user's role is the policy service's): neither
  // inserted (a new row takes the default) nor updated.
  const names = Object.keys(cols).filter((n) => !opts.omit?.includes(n) && !cols[n]!.policy)
  const pk = Object.fromEntries(m.pk.map((c) => [c, fields[c]]))

  const row = await withWrite(async (tx) => {
    const prev = (opts.prev !== undefined ? opts.prev : await lockedRow(tx, m, pk)) as Record<string, unknown> | null
    if (opts.mustExist && !prev) throw new Error(`${m.table}: ${JSON.stringify(pk)} no longer exists`)
    const now = new Date().toISOString()
    const merged: Record<string, unknown> = {}
    for (const name of Object.keys(m.columns)) merged[name] = name in fields ? fields[name] : (prev?.[name] ?? null)
    if (m.timestamps) {
      merged.created_at = prev?.created_at ?? now
      merged.updated_at = now
    }
    if (m.audit) {
      merged.created_by = prev ? (prev.created_by ?? null) : (actor ?? null)
      merged.updated_by = actor ?? (prev?.updated_by ?? null)
    }
    const updates = names
      .filter((n) => !m.pk.includes(n) && n !== 'created_at' && n !== 'created_by')
      .map((n) => `${quoteIdent(n)} = excluded.${quoteIdent(n)}`)
    // A new row takes a column's declared default when neither the input nor a previous row says.
    const params: unknown[] = []
    const values = names.map((n) => {
      const c = cols[n]!
      if (!prev && merged[n] == null && !(n in fields) && c.default !== undefined) return 'default'
      params.push(toParam(c, merged[n]))
      return c.kind === 'json' ? `$${params.length}::jsonb` : c.kind === 'vector' ? `$${params.length}::${columnType(n, c)}` : `$${params.length}`
    })
    const rows = await tx.query<Record<string, unknown>>(
      `insert into ${table(m)} (${names.map(quoteIdent).join(', ')})
       values (${values.join(', ')})
       ${opts.createOnly ? `on conflict (${m.pk.map(quoteIdent).join(', ')}) do nothing` : `on conflict (${m.pk.map(quoteIdent).join(', ')}) ${updates.length ? `do update set ${updates.join(', ')}` : 'do nothing'}`}
       returning ${selectCols(m)}`,
      params,
    )
    if (opts.createOnly && !rows[0]) throw new RecordExistsError(m.table, pk)
    const col = areaColumn(m)
    changed(m, col ? [prev?.[col], rows[0]?.[col] ?? merged[col]] : [])
    return rows[0] ?? (await tx.query<Record<string, unknown>>(`select ${selectCols(m)} from ${table(m)} where ${pkWhere(m)}`, pkValues(m, pk)))[0]
  }, { reach: reachOf(m) })
  return rowToRecord<T>(m, row!)
}

/** A create-only write found a row already under its key. */
export class RecordExistsError extends Error {
  constructor(readonly table: string, readonly pk: Record<string, unknown>) {
    super(`${table}: ${JSON.stringify(pk)} already exists`)
    this.name = 'RecordExistsError'
  }
}

/** The current row by primary key, locked FOR UPDATE until the transaction ends. */
export async function lockedRow<T = Record<string, unknown>>(tx: Tx, m: ModelSpec, pk: Record<string, unknown>): Promise<T | null> {
  const rows = await tx.query<Record<string, unknown>>(`select ${selectCols(m)} from ${table(m)} where ${pkWhere(m)} for update`, pkValues(m, pk))
  return rows[0] ? rowToRecord<T>(m, rows[0]) : null
}

export async function deleteRecord(m: ModelSpec, pk: Record<string, unknown>): Promise<void> {
  await withWrite(async (tx) => {
    const col = areaColumn(m)
    const gone = await tx.query<Record<string, unknown>>(`delete from ${table(m)} where ${pkWhere(m)} returning ${col ? quoteIdent(col) : '1'}`, pkValues(m, pk))
    changed(m, col ? gone.map((r) => r[col]) : [])
  }, { reach: reachOf(m) })
}

/** The column holding a row's owning area (`area`) or areas (`areas`, events), if any. */
function areaColumn(m: ModelSpec): 'area' | 'areas' | null {
  if (m.columns.area?.kind === 'text') return 'area'
  return m.columns.areas?.kind === 'text[]' ? 'areas' : null
}

/**
 * Announce a write: a table whose rows carry owning areas announces the areas of the rows it
 * touched (change-access.ts delivers them to those areas' readers), any other its scope.
 */
function changed(m: ModelSpec, values: unknown[]): void {
  if (!areaColumn(m)) return emitChange(`table:${m.table}`)
  const areas = values.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((a): a is string => typeof a === 'string')
  emitAreaChange(`table:${m.table}`, areas)
}
