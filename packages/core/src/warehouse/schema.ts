// Schema lifecycle on PostgreSQL. The runner is pg/migrate.ts (applyPgSchema); boot runs it once
// per process under the schema lock (pg/boot.ts bootDatabase).
//
//   - Baseline: every present owner's ModelSpecs (core first) as CREATE TABLE IF NOT EXISTS in the
//     owner's schema, then each feature's `baseline` DDL (views, indexes; idempotent). A fresh
//     database gets the CURRENT schema in one shot.
//   - Migrations: each owner has an ordered, append-only list starting at its own 001, recorded in
//     `core.schema_migrations` as `<owner>:<name>` with a checksum over its canonical content.
//     Each runs once, in one transaction with its ledger row.
//
// Adding a column means: extend the ModelSpec (fresh databases get it via CREATE) AND append a
// migration with the ALTER (existing databases get it once). Never edit or reorder past migrations.
// Static migration SQL names only owned tables, schema-qualified.

import type { CoreFeature } from '../feature.js'
import { FEATURE_LIST } from '../generated/features.js'
import { CORE_MODELS } from './core-models.js'
import type { PgMigration, SchemaOwner } from './pg/migrate.js'

export type { MigrationTx, PgMigration as Migration, SchemaOwner } from './pg/migrate.js'
export { orderOwners } from './pg/migrate.js'

/** Core's own migrations, keyed `core:<name>`. Core has none; its tables come from the baseline. */
export const CORE_MIGRATIONS: readonly PgMigration[] = []

/** Core's idempotent DDL after its tables: identity uniqueness on users (users/state.ts). */
export const CORE_BASELINE: readonly string[] = [
  `create unique index if not exists users_tailscale_login_key on core.users (tailscale_login) where tailscale_login is not null`,
  `create unique index if not exists users_email_key on core.users (lower(trim(email))) where email is not null and trim(email) <> ''`,
  `create unique index if not exists users_phone_key on core.users (phone) where phone is not null`,
]

export const CORE_OWNER: SchemaOwner = { id: 'core', models: CORE_MODELS, baseline: CORE_BASELINE, migrations: CORE_MIGRATIONS }

/** A registered feature as a schema owner. */
export function featureOwner(f: CoreFeature): SchemaOwner {
  return { id: f.id, dependsOn: f.dependsOn, models: f.models, baseline: f.baseline, migrations: f.migrations }
}

/** Core plus every registered feature, for bootDatabase. */
export function boxSchemaOwners(features: readonly CoreFeature[] = FEATURE_LIST): { core: SchemaOwner; features: SchemaOwner[] } {
  return { core: CORE_OWNER, features: features.map(featureOwner) }
}
