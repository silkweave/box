// Schema lifecycle: baseline + per-feature migration ledgers.
//
//   • Baseline: every present feature's ModelSpecs (core first) as CREATE TABLE IF NOT EXISTS,
//     then each feature's `baseline` DDL (views, indexes; CREATE OR REPLACE, order-free). A fresh
//     warehouse gets the CURRENT schema in one shot.
//   • Migrations: each feature owns an ordered, append-only list starting at its own 001. Each
//     runs ONCE per warehouse file, atomically with its ledger row, and is recorded in
//     `schema_migrations` as `<feature>:<name>` - the ledger travels with the .db file, so a
//     restored older backup upgrades itself on its first boot here. Statements should still be
//     idempotent (IF EXISTS forms) so a crash mid-migration re-runs safely.
//
// Order is per feature in array position, features in dependency order (dependsOn), ties by id.
// Two features' 001s have no relationship; the only cross-feature guarantee is that a dependency's
// tables and migrations are complete before a dependent's migration runs. Static migration SQL
// names only owned tables; cross-feature reads use a declared dependency's reader inside run().
//
// Adding a column means: extend the ModelSpec (fresh DBs get it via CREATE) AND append a migration
// with the ALTER (existing DBs get it once). Never edit or reorder past migrations.
//
// DuckDB constraints that shaped this: one table-altering operation per transaction is safest, and
// there is no `INSERT ... FROM IF EXISTS` - a migration that must look at the database first uses
// `run`. Naive TIMESTAMP values in the file are UTC (warehouse/model.ts owns that rule).

import { withWrite } from './db.js'
import { warehousePath } from '../io.js'
import { dumpMigration, migrationChecksum } from './migration-digest.js'
import { snapshotBeforeMigration } from './migration-snapshot.js'
import { createTableSql } from './model.js'
import { CORE_MODELS } from './core-models.js'
import { CORE_MIGRATIONS } from './core-migrations.js'
import { FEATURE_LIST } from '../generated/features.js'
import type { CoreFeature } from '../feature.js'

export interface Migration {
  /** Stable within the feature - the ledger key is `<feature>:<name>`. `NNN-slug` by convention. */
  name: string
  /** Static statements, or a factory for machine-dependent ones. */
  statements?: string[] | (() => string[])
  /**
   * Escape hatch for a migration that must LOOK at the database first. Runs inside the same
   * transaction as `statements` and the ledger insert, so the atomicity guarantee is unchanged.
   * Prefer plain statements; reach for this only when a decision depends on what is stored.
   */
  run?: (conn: MigrationConn) => Promise<void>
}

/** The slice of the DuckDB connection a migration is allowed to use. */
export interface MigrationConn {
  run(sql: string, params?: unknown[]): Promise<unknown>
  runAndReadAll(sql: string, params?: unknown[]): Promise<{ getRowObjectsJson(): Record<string, unknown>[] }>
}

// Core's own migrations live in their own file (they are a list that grows, like a feature's).
export { CORE_MIGRATIONS } from './core-migrations.js'

const CORE: CoreFeature = { id: 'core', models: CORE_MODELS, migrations: CORE_MIGRATIONS }

/**
 * Core first, then features in dependency order; ties broken by id so two Boxes with the same
 * directories apply the same sequence. Throws on a cycle or a dependsOn naming an absent feature.
 */
export function orderFeatures(features: readonly CoreFeature[]): CoreFeature[] {
  const byId = new Map(features.map((f) => [f.id, f]))
  for (const f of features) {
    for (const d of f.dependsOn ?? []) {
      if (!byId.has(d)) throw new Error(`feature "${f.id}" depends on "${d}", which is not present`)
    }
  }
  const out: CoreFeature[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (f: CoreFeature, trail: string[]): void => {
    const s = state.get(f.id)
    if (s === 'done') return
    if (s === 'visiting') throw new Error(`feature dependency cycle: ${[...trail, f.id].join(' -> ')}`)
    state.set(f.id, 'visiting')
    for (const d of [...(f.dependsOn ?? [])].sort()) visit(byId.get(d)!, [...trail, f.id])
    state.set(f.id, 'done')
    out.push(f)
  }
  for (const f of [...features].sort((a, b) => a.id.localeCompare(b.id))) visit(f, [])
  return [CORE, ...out]
}

/** Every table has exactly one owner; every migration name is unique within its feature. */
export function assertOwnership(features: readonly CoreFeature[]): void {
  const owner = new Map<string, string>()
  for (const f of features) {
    const names = new Set<string>()
    for (const m of f.models) {
      const prev = owner.get(m.table)
      if (prev) throw new Error(`table "${m.table}" is declared by both "${prev}" and "${f.id}"`)
      owner.set(m.table, f.id)
    }
    for (const mig of f.migrations) {
      if (names.has(mig.name)) throw new Error(`feature "${f.id}" declares migration "${mig.name}" twice`)
      names.add(mig.name)
    }
  }
}

/** Baseline + migrate. A production caller supplies a snapshot hook under its write lock. */
export async function applySchema(
  conn: MigrationConn,
  features: readonly CoreFeature[],
  beforeMigrate?: () => Promise<unknown>,
): Promise<void> {
  const ordered = orderFeatures(features)
  assertOwnership(ordered)
  // Evaluate factories once: the exact statements we fingerprint are the ones we execute.
  const planned = ordered.flatMap((f) => f.migrations.map((migration) => {
    const dump = dumpMigration(migration)
    return { feature: f.id, migration, dump, key: `${f.id}:${migration.name}`, checksum: migrationChecksum(dump) }
  }))
  const tables = (await conn.runAndReadAll(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'BASE TABLE'`,
  )).getRowObjectsJson()
  const hasLedger = tables.some((row) => row.table_name === 'schema_migrations')
  const ledgerColumns = hasLedger ? (await conn.runAndReadAll(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'main' AND table_name = 'schema_migrations'`,
  )).getRowObjectsJson() : []
  const hasChecksum = ledgerColumns.some((row) => row.column_name === 'checksum')
  const appliedRows = hasLedger ? (await conn.runAndReadAll(
    `SELECT name, ${hasChecksum ? 'checksum' : 'NULL AS checksum'} FROM schema_migrations`,
  )).getRowObjectsJson() : []
  const applied = new Map(appliedRows.map((row) => [String(row.name), row.checksum]))
  const current = new Map(planned.map((entry) => [entry.key, entry]))
  const installed = new Set(ordered.map((f) => f.id))
  // Reject changes before baseline DDL, backfill, or any pending migration can write.
  for (const [key, checksum] of applied) {
    const separator = key.indexOf(':')
    if (separator < 1) throw new Error(`ledger row "${key}" has no feature prefix: this is not a Box warehouse`)
    const entry = current.get(key)
    if (!entry && installed.has(key.slice(0, separator))) {
      throw new Error(`applied migration ${key} is missing from installed code; restore its append-only history`)
    }
    if (entry && checksum != null && checksum !== entry.checksum) {
      throw new Error(`migration ${key} checksum changed; restore the shipped migration and append a new one`)
    }
  }
  const pending = planned.filter((entry) => !applied.has(entry.key))
  if (tables.length && pending.length) await beforeMigrate?.()

  await conn.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR NOT NULL PRIMARY KEY,
    feature VARCHAR NOT NULL DEFAULT 'core',
    applied_at TIMESTAMP NOT NULL DEFAULT now(),
    checksum VARCHAR
  )`)
  if (hasLedger && !hasChecksum) await conn.run('ALTER TABLE schema_migrations ADD COLUMN checksum VARCHAR')
  // Legacy rows have no earlier fingerprint to compare. Backfill only migrations present here;
  // residue from an uninstalled feature is left intact until that feature is installed again.
  for (const entry of planned) {
    if (applied.has(entry.key) && applied.get(entry.key) == null) {
      await conn.run('UPDATE schema_migrations SET checksum = ? WHERE name = ?', [entry.checksum, entry.key])
    }
  }
  for (const f of ordered) for (const m of f.models) await conn.run(createTableSql(m))
  for (const f of ordered) for (const sql of f.baseline ?? []) await conn.run(sql)

  for (const { feature, migration, dump, key, checksum } of pending) {
    await conn.run('BEGIN')
    try {
      for (const sql of dump.statements) await conn.run(sql)
      await migration.run?.(conn)
      await conn.run('INSERT INTO schema_migrations (name, feature, checksum) VALUES (?, ?, ?)', [key, feature, checksum])
      await conn.run('COMMIT')
    } catch (err) {
      await conn.run('ROLLBACK').catch(() => undefined)
      throw new Error(`migration ${key} failed: ${String((err as Error)?.message ?? err)}`, { cause: err })
    }
  }
}

let schemaReady: Promise<void> | undefined

/** Baseline the current schema + apply any unapplied migrations. Cheap after the first call. */
export async function ensureSchema(): Promise<void> {
  schemaReady ??= withWrite((conn) => applySchema(
    conn as unknown as MigrationConn,
    FEATURE_LIST,
    () => snapshotBeforeMigration(conn as unknown as MigrationConn, warehousePath()),
  )).catch((error) => {
    schemaReady = undefined
    throw error
  })
  await schemaReady
}
