// The area map (PHASE1.md choice 6): which schema each owner's tables live in, and the one
// identifier rule for every name the Box puts into DDL or policy SQL.
//
// - Core's shared tables live in `core`. A feature's tables live in its area's schema; the area is
//   the feature id today, but code asks the map (never assumes feature id equals schema), so an
//   area can be renamed or split later without touching callers.
// - Identifiers are validated after mapping hyphens to underscores (`data-sync` -> `data_sync`)
//   and quoted when emitted. Area schemas may not collide with `core`, `ext`, `public`,
//   `information_schema` or `pg_*`.
// - SQL is schema-qualified (`crm.crm_deals`); no login has a search_path of its own.

import type { CoreFeature } from '../../feature.js'
import type { ModelSpec } from '../model-spec.js'

export const CORE_SCHEMA = 'core'
export const EXT_SCHEMA = 'ext'
const RESERVED = new Set([CORE_SCHEMA, EXT_SCHEMA, 'public', 'information_schema'])
const IDENT = /^[a-z][a-z0-9_]*$/

/** A validated SQL identifier (PostgreSQL's 63-byte limit included). */
export function ident(name: string): string {
  if (!IDENT.test(name) || Buffer.byteLength(name) > 63) throw new Error(`invalid SQL identifier "${name}"`)
  return name
}

/** A validated, double-quoted identifier for DDL. */
export function quoteIdent(name: string): string {
  return `"${ident(name)}"`
}

/** The schema an area's tables live in. */
export function areaSchema(area: string): string {
  const s = ident(area.replace(/-/g, '_'))
  if (RESERVED.has(s) || s.startsWith('pg_')) throw new Error(`area "${area}" maps to the reserved schema "${s}"`)
  return s
}

/** The NOLOGIN group carrying an area's grants at `level` (PERMISSIONS 11.2). */
export function areaGroup(area: string, level: 'read' | 'write'): string {
  return ident(`area_${areaSchema(area)}_${level}`)
}

export interface AreaMap {
  /** Feature areas that own a schema, sorted (core is not one of them). */
  readonly areas: readonly string[]
  /** Owner id (`core` or a feature id) -> schema. */
  schemaOf(owner: string): string
  /** The owner of a table, by its bare name. */
  ownerOf(table: string): string
  /** `"schema"."table"` for a model or bare table name. */
  qualify(table: string | ModelSpec): string
}

/** The area of a feature. One place to change when an area stops being its feature's id. */
export function featureArea(feature: Pick<CoreFeature, 'id'>): string {
  return feature.id
}

/** Build the map from core's models and the registered features; refuses duplicate owners. */
export function buildAreaMap(coreModels: readonly ModelSpec[], features: readonly Pick<CoreFeature, 'id' | 'models'>[]): AreaMap {
  const schemaByOwner = new Map<string, string>([['core', CORE_SCHEMA]])
  const ownerByTable = new Map<string, string>()
  const claim = (table: string, owner: string) => {
    ident(table)
    const prev = ownerByTable.get(table)
    if (prev && prev !== owner) throw new Error(`table "${table}" is declared by both "${prev}" and "${owner}"`)
    ownerByTable.set(table, owner)
  }
  for (const m of coreModels) claim(m.table, 'core')
  const schemas = new Map<string, string>()
  for (const f of features) {
    const schema = areaSchema(featureArea(f))
    const clash = schemas.get(schema)
    if (clash) throw new Error(`features "${clash}" and "${f.id}" map to the same schema "${schema}"`)
    schemas.set(schema, f.id)
    schemaByOwner.set(f.id, schema)
    for (const m of f.models) claim(m.table, f.id)
  }
  const schemaOf = (owner: string): string => {
    const s = schemaByOwner.get(owner)
    if (!s) throw new Error(`no schema for "${owner}": not core and not a registered feature`)
    return s
  }
  const ownerOf = (table: string): string => {
    const o = ownerByTable.get(table)
    if (!o) throw new Error(`table "${table}" is not declared by core or any registered feature`)
    return o
  }
  return {
    areas: features.map(featureArea).sort(),
    schemaOf,
    ownerOf,
    qualify(table) {
      const name = typeof table === 'string' ? table : table.table
      return `${quoteIdent(schemaOf(ownerOf(name)))}.${quoteIdent(name)}`
    },
  }
}
