// `bun run schema:check` runs the schema matrix as part of `box verify`.
// It exercises the installed feature set against isolated databases, without schema lockfiles or
// byte-equality checks on adaptable source. Runtime migration identity and checksum refusals
// remain in the runner (warehouse/pg/migrate.ts) because those protect the database rather than
// enforce authoring style.
//
// What this proves, on one throwaway cluster (pgrust, or BOX_TEST_ENGINE=native) with one database
// per pass:
//
//   1. FRESH + REBOOT - the schema of every owner on an empty database, then again on the same
//      database. Every table every manifest declares exists afterwards, in its owner's schema.
//      (The second pass is the boot path of an existing Box: baselines are IF NOT EXISTS / OR
//      REPLACE, ledger rows are already there.)
//   2. ENABLED LATER, for each feature F - the schema without F and everything that depends on F
//      on a new database, then the full set on it. This catches an undeclared dependency: a view
//      or a migration reaching for a table its feature never listed in `dependsOn` works on a full
//      Box and fails on the Box without that feature.
//   3. OWNERSHIP - migrations whose static SQL names a table the feature does not own, or a table
//      that is not schema-qualified, reported as a WARNING (migration-ownership.ts explains why).
//
// Run it after changing a model, a baseline or a migration. What it cannot prove: a data migration
// against real rows. Back the database up and rehearse against a restored copy whose rows match
// the migration's WHERE clause. A migration's `run` is opaque to the lint; review it.

import pg from 'pg'
import type { DatabaseEngine } from '../src/box-json.js'
import { OWNER_LOGIN } from '../src/db/cluster.js'
import { startTestCluster } from '../src/db/testing.js'
import { FEATURE_LIST as FEATURES } from '../src/generated/features.js'
import { migrationOwnershipErrors } from '../src/warehouse/migration-ownership.js'
import { buildAreaMap } from '../src/warehouse/pg/areas.js'
import { applyPgSchema } from '../src/warehouse/pg/migrate.js'
import { ensureDatabase } from '../src/warehouse/pg/policy.js'
import { boxSchemaOwners, orderOwners, type SchemaOwner } from '../src/warehouse/schema.js'
import type { CoreFeature } from '../src/feature.js'

const failures: string[] = []
const { core, features: allOwners } = boxSchemaOwners(FEATURES)

/** Every table the given feature set (plus core) declares, as `schema.table`. */
const declared = (owners: readonly SchemaOwner[]): string[] => {
  const map = buildAreaMap(core.models, owners)
  return [...core.models, ...owners.flatMap((o) => o.models)].map((m) => `${map.schemaOf(map.ownerOf(m.table))}.${m.table}`)
}

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
  const engine = (process.env.BOX_TEST_ENGINE ?? 'pgrust') as DatabaseEngine
  const cluster = await startTestCluster(engine)
  const { socket, port } = cluster.running
  let n = 0
  /** A fresh database and an owner session on it. Caller closes. */
  const open = async () => {
    const name = `schema_check_${++n}`
    const admin = new pg.Client({ host: socket, port, user: OWNER_LOGIN, database: 'postgres' })
    await admin.connect()
    try { await ensureDatabase(admin, name) } finally { await admin.end() }
    const c = new pg.Client({ host: socket, port, user: OWNER_LOGIN, database: name })
    await c.connect()
    return {
      apply: (owners: readonly SchemaOwner[]) => applyPgSchema(c, core, owners),
      tables: async () => new Set((await c.query<{ t: string }>(
        `select table_schema || '.' || table_name as t from information_schema.tables where table_type = 'BASE TABLE'`)).rows.map((r) => r.t)),
      close: () => c.end(),
    }
  }
  try {
    const allTables = declared(allOwners)
    const ordered = orderOwners(core, allOwners)
    const ownership = migrationOwnershipErrors(FEATURES as readonly CoreFeature[])
    for (const warning of ownership) console.warn(`schema:check: ${warning}`)

    // 1. fresh, then reboot on the same database.
    {
      const w = await open()
      try {
        await w.apply(allOwners)
        expectTables('fresh', allTables, await w.tables())
        await w.apply(allOwners)
        expectTables('reboot', allTables, await w.tables())
      } catch (err) {
        failures.push(`fresh/reboot: ${String((err as Error)?.message ?? err)}`)
      } finally {
        await w.close()
      }
    }

    // 2. every feature enabled later, onto a Box that never had it.
    for (const f of FEATURES) {
      const dropped = withDependents(f.id)
      const subset = allOwners.filter((x) => !dropped.has(x.id))
      const label = `without ${[...dropped].sort().join(' + ')}`
      const w = await open()
      try {
        await w.apply(subset)
        expectTables(label, declared(subset), await w.tables())
        await w.apply(allOwners)
        expectTables(`${label} -> enabled later`, allTables, await w.tables())
      } catch (err) {
        failures.push(`${label}: ${String((err as Error)?.message ?? err)}`)
      } finally {
        await w.close()
      }
    }

    if (failures.length) {
      console.error(`schema:check found ${failures.length} problem(s):\n  ${failures.join('\n  ')}`)
      return 1
    }
    console.info(
      `schema:check (${engine}): ${ordered.length} owners (core first), ${allTables.length} tables - fresh, reboot and ${FEATURES.length} enabled-later paths all apply` +
        (ownership.length ? `; ${ownership.length} ownership warning(s) above` : '; no ownership warnings'),
    )
    return 0
  } finally {
    await cluster.stop()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('schema:check failed:', err)
    process.exit(1)
  })
