// `pnpm schema:check` runs the schema matrix as part of `pnpm verify`.
// It exercises the installed feature set against isolated files, without schema lockfiles or
// byte-equality checks on adaptable source. Runtime migration identity and checksum refusals
// remain in applySchema because those protect the database rather than enforce authoring style.
//
// What this proves, on throwaway files under a temp dir:
//
//   1. FRESH + REBOOT - applySchema(FEATURES) on an empty file, then again on the same file. Every
//      table every manifest declares exists afterwards. (The second pass is the boot path of an
//      existing Box: baselines are IF NOT EXISTS / OR REPLACE, ledger rows are already there.)
//   2. ENABLED LATER, for each feature F - applySchema(FEATURES minus F minus everything that
//      depends on F) on a new file, then applySchema(FEATURES) on it. This is the pass that catches
//      an undeclared dependency: a view or a migration reaching for a table its feature never
//      listed in `dependsOn` works on a full Box and fails on the Box without that feature. Every
//      Box has a different feature set, so "the schema applies" is not one question, and the unit
//      tests cannot see this: it takes a real DuckDB file.
//   3. OWNERSHIP - migrations whose static SQL names a table the feature does not own, reported as
//      a WARNING (migration-ownership.ts explains why it is advice now).
//
// Run it after changing a model, a baseline or a migration. What it cannot prove: a data migration
// against real rows. Back the warehouse up (`pnpm db:backup`) and rehearse against a restored copy
// whose rows match the migration's WHERE clause. The `run(conn)` hook is opaque to the lint;
// complex SQL and transitive code changes need review, not a regex.

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { applySchema, orderFeatures, type MigrationConn } from '../src/warehouse/schema.js'
import { CORE_MODELS } from '../src/warehouse/core-models.js'
import { FEATURE_LIST as FEATURES } from '../src/generated/features.js'
import { repoRoot } from '../src/io.js'
import { migrationOwnershipErrors } from '../src/warehouse/migration-ownership.js'
import type { CoreFeature } from '../src/feature.js'

const root = repoRoot()
const dir = mkdtempSync(join(root, 'box-projection-schema-check-'))
let file = 0
const failures: string[] = []

/** A fresh warehouse file and a connection to it. Caller closes. */
async function open(): Promise<{ conn: MigrationConn; tables: () => Promise<Set<string>>; close: () => void }> {
  const instance = await DuckDBInstance.create(join(dir, `w${++file}.db`))
  const conn = await instance.connect()
  await conn.run(`SET TimeZone = 'UTC'`)
  return {
    conn: conn as unknown as MigrationConn,
    tables: async () => {
      const rows = (await conn.runAndReadAll(`SELECT table_name FROM information_schema.tables`)).getRowObjectsJson()
      return new Set(rows.map((r) => String(r.table_name)))
    },
    close: () => {
      conn.disconnectSync()
      instance.closeSync()
    },
  }
}

/** Every table the given feature set (plus core) declares. */
const declared = (features: readonly CoreFeature[]): string[] => [
  ...CORE_MODELS.map((m) => m.table),
  ...features.flatMap((f) => f.models.map((m) => m.table)),
]

function expectTables(label: string, want: readonly string[], have: Set<string>): void {
  const missing = want.filter((t) => !have.has(t))
  if (missing.length) failures.push(`${label}: missing table(s) ${missing.join(', ')}`)
}

/** F plus everything that (transitively) depends on F - the set that must leave together. */
function withDependents(id: string): Set<string> {
  const out = new Set([id])
  for (;;) {
    const before = out.size
    for (const f of FEATURES) if ((f.dependsOn ?? []).some((d) => out.has(d))) out.add(f.id)
    if (out.size === before) return out
  }
}

async function main(): Promise<number> {
  const all = [...FEATURES]
  const allTables = declared(all)
  const ordered = orderFeatures(all)
  const ownership = migrationOwnershipErrors(ordered)
  for (const warning of ownership) console.warn(`schema:check: ${warning}`)

  // 1. fresh, then reboot on the same file.
  {
    const w = await open()
    try {
      await applySchema(w.conn, all)
      expectTables('fresh', allTables, await w.tables())
      await applySchema(w.conn, all)
      expectTables('reboot', allTables, await w.tables())
    } catch (err) {
      failures.push(`fresh/reboot: ${String((err as Error)?.message ?? err)}`)
    } finally {
      w.close()
    }
  }

  // 2. every feature enabled later, onto a Box that never had it.
  for (const f of FEATURES) {
    const dropped = withDependents(f.id)
    const subset = all.filter((x) => !dropped.has(x.id))
    const label = `without ${[...dropped].sort().join(' + ')}`
    const w = await open()
    try {
      await applySchema(w.conn, subset)
      expectTables(label, declared(subset), await w.tables())
      await applySchema(w.conn, all)
      expectTables(`${label} -> enabled later`, allTables, await w.tables())
    } catch (err) {
      failures.push(`${label}: ${String((err as Error)?.message ?? err)}`)
    } finally {
      w.close()
    }
  }

  if (failures.length) {
    console.error(`schema:check found ${failures.length} problem(s):\n  ${failures.join('\n  ')}`)
    return 1
  }
  console.info(
    `schema:check: ${ordered.length} features (core first), ${allTables.length} tables - fresh, reboot and ${FEATURES.length} enabled-later paths all apply` +
      (ownership.length ? `; ${ownership.length} ownership warning(s) above` : '; no ownership warnings'),
  )
  return 0
}

main()
  .then((code) => {
    rmSync(dir, { recursive: true, force: true })
    process.exit(code)
  })
  .catch((err) => {
    rmSync(dir, { recursive: true, force: true })
    console.error('schema:check failed:', err)
    process.exit(1)
  })
