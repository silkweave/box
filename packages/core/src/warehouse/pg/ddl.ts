// Model -> PostgreSQL DDL. One rule per column kind (PHASE1.md choice 7):
//
//   timestamp -> timestamptz  instants; read back as exact ISO-8601 `...Z` (executor BOX_TYPES)
//   date      -> date         read back as `YYYY-MM-DD`, independent of the host time zone
//   json      -> jsonb        read back parsed
//   bigint    -> bigint       a number when safe, otherwise an error at the port boundary
//   float     -> double precision
//   tsvector  -> tsvector     text search terms, written with to_tsvector in the feature's SQL
//   vector    -> ext.vector(n) pgvector embeddings with fixed dimensions; read back as number[]
//
// Every table is created by the owner login, so the owner default privileges of its schema grant
// it to the area groups and box_system without a further step (PERMISSIONS 11.2).

import { modelColumns, type ColumnKind, type ColumnSpec, type ModelSpec } from '../model-spec.js'
import { EXT_SCHEMA, quoteIdent } from './areas.js'

export const PG_TYPE: Record<ColumnKind, string> = {
  text: 'text',
  int: 'integer',
  bigint: 'bigint',
  float: 'double precision',
  bool: 'boolean',
  json: 'jsonb',
  timestamp: 'timestamptz',
  date: 'date',
  'text[]': 'text[]',
  tsvector: 'tsvector',
  vector: `${EXT_SCHEMA}.vector`,
}

/** The column's SQL type: `vector` carries its dimensions, which the model must declare. */
export function columnType(name: string, c: ColumnSpec): string {
  if (c.kind !== 'vector') return PG_TYPE[c.kind]
  if (!(Number.isInteger(c.dimensions) && c.dimensions! >= 1 && c.dimensions! <= 16_000)) throw new Error(`vector column "${name}" needs dimensions between 1 and 16000`)
  return `${PG_TYPE.vector}(${c.dimensions})`
}

/** `CREATE TABLE IF NOT EXISTS` for a model in `schema`. */
export function createTableSql(m: ModelSpec, schema: string): string {
  const cols = modelColumns(m)
  const lines = Object.entries(cols).map(([name, c]) => {
    const notNull = m.pk.includes(name) || !c.nullable ? ' not null' : ''
    const def = c.default !== undefined ? ` default ${c.default}` : ''
    const check = c.check ? ` check (${c.check})` : ''
    return `  ${quoteIdent(name)} ${columnType(name, c)}${notNull}${def}${check}`
  })
  const list = (cols: readonly string[]) => cols.map(quoteIdent).join(', ')
  lines.push(`  primary key (${list(m.pk)})`)
  for (const u of m.unique ?? []) lines.push(`  unique (${list(u)})`)
  for (const fk of m.foreignKeys ?? []) {
    lines.push(`  foreign key (${list(fk.columns)}) references ${quoteIdent(schema)}.${quoteIdent(fk.table)} (${list(fk.references)}) on update cascade on delete ${fk.onDelete ?? 'cascade'}`)
  }
  return `create table if not exists ${quoteIdent(schema)}.${quoteIdent(m.table)} (\n${lines.join(',\n')}\n)`
}
