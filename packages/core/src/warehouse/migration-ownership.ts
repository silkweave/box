// A migration's static SQL should touch only its own feature's tables, schema-qualified
// (`crm.crm_deals`; no login has a search_path). Cross-feature reads belong in `run(tx)`, through a declared dependency's reader, so the dependency is visible in the
// manifest rather than buried in a string.
//
// This is ADVICE, not a gate. `pnpm schema:check` reports it as a warning: a team that merges two
// adopted apps into one vocabulary is doing exactly what the model invites, and finding out from a
// failing build would be the wrong answer. On the maintainer checkout, where apps are meant to stay
// separable, treat a warning here as something to fix.

import type { CoreFeature } from '../feature.js'
import { areaSchema, featureArea } from './pg/areas.js'
import { migrationStatements } from './pg/migrate.js'

/** Catalog schemas a migration may read without owning them. */
const CATALOGS = new Set(['information_schema', 'pg_catalog'])

/** A deliberately conservative SQL lint; complex SQL and run hooks still need review. */
export function migrationOwnershipErrors(features: readonly CoreFeature[]): string[] {
  const errors: string[] = []
  for (const feature of features) {
    // A feature's own tables include the ones it retired (`retiredTables`): its migrations drop them.
    const schema = areaSchema(featureArea(feature))
    const owned = new Set([...feature.models.map((model) => model.table.toLowerCase()), ...(feature.retiredTables ?? []).map((t) => t.toLowerCase())].map((t) => `${schema}.${t}`))
    for (const migration of feature.migrations) {
      for (const statement of migrationStatements(migration)) {
        // Remove comments and string literals before scanning identifiers. Quoted identifiers stay.
        const sql = statement.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
        // `IS [NOT] DISTINCT FROM x` compares values; its FROM names no table.
        const target = /\b(?<!DISTINCT\s+)(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?)/gi
        for (const [, raw] of sql.matchAll(target)) {
          const name = raw!.replaceAll('"', '').toLowerCase()
          if (CATALOGS.has(name.split('.')[0]!)) continue
          if (!name.includes('.')) { errors.push(`${feature.id}:${migration.name}: table "${name}" is not schema-qualified (write ${schema}.${name})`); continue }
          if (!owned.has(name)) errors.push(`${feature.id}:${migration.name}: static SQL references unowned table "${name}"; cross-feature reads belong in run() through a declared dependency's reader`)
        }
      }
    }
  }
  return errors
}
