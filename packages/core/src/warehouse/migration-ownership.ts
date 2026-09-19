// A migration's static SQL should touch only its own feature's tables. Cross-feature reads belong
// in `run(conn)`, through a declared dependency's reader, so the dependency is visible in the
// manifest rather than buried in a string.
//
// This is ADVICE, not a gate. `pnpm schema:check` reports it as a warning: a team that merges two
// adopted apps into one vocabulary is doing exactly what the model invites, and finding out from a
// failing build would be the wrong answer. On the maintainer checkout, where apps are meant to stay
// separable, treat a warning here as something to fix.

import type { CoreFeature } from '../feature.js'
import { dumpMigration } from './migration-digest.js'

/** A deliberately conservative SQL lint; complex SQL and run hooks still need review. */
export function migrationOwnershipErrors(features: readonly CoreFeature[]): string[] {
  const errors: string[] = []
  for (const feature of features) {
    const owned = new Set(feature.models.map((model) => model.table.toLowerCase()))
    for (const migration of feature.migrations) {
      for (const statement of dumpMigration(migration).statements) {
        // Remove comments and string literals before scanning identifiers. Quoted identifiers stay.
        const sql = statement.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
        const target = /\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?)/gi
        for (const [, raw] of sql.matchAll(target)) {
          const name = raw!.replaceAll('"', '').toLowerCase()
          if (!owned.has(name)) errors.push(`${feature.id}:${migration.name}: static SQL references unowned table "${name}"; cross-feature reads belong in run() through a declared dependency's reader`)
        }
      }
    }
  }
  return errors
}
