// The Kysely table types, derived from ModelSpec declarations at the type level: one source of
// truth for the DDL, schema:check, the record layer and typed queries. A feature owns its types
// next to its models (`type ArtifactsDb = ModelDb<typeof ARTIFACTS_MODELS>`); nothing is generated
// and no central file lists feature tables.
//
// Declare models with `defineModel` (model-spec.ts) so their literal types survive. Column kinds
// map to what the executor's type parsers return (executor.ts BOX_TYPES):
//
//   text, date, tsvector     string
//   int, float, bigint       number (int8 as a safe number, otherwise an error at the boundary)
//   bool                     boolean
//   json                     unknown on read (jsonb parsed); written as JSON text (`JSON.stringify`)
//   timestamp                ISO-8601 `...Z` text on read; ISO text or a Date on write
//   text[]                   string[]
//   vector                   pgvector text `[x,y]` on read and write (`vectorLiteral`); the record
//                            layer parses it to number[] (RecordOf)
//
// Nullable columns are `T | null` and optional on insert; a column with a default is optional on
// insert (Kysely `Generated`); an enum tuple becomes a union; a `policy` column is read-only.

import type { ColumnType, Selectable } from 'kysely'
import type { ColumnKind, ColumnSpec, ModelSpec } from './model-spec.js'

interface KindTypes {
  text: string
  int: number
  bigint: number
  float: number
  bool: boolean
  json: unknown
  timestamp: string
  date: string
  'text[]': string[]
  tsvector: string
  vector: string
}

interface KindWrites {
  json: string
  timestamp: string | Date
}

type Write<K extends ColumnKind> = K extends keyof KindWrites ? KindWrites[K] : KindTypes[K]

/** An enum tuple of literals as a union; otherwise the kind's type. */
type Base<C extends ColumnSpec, T> = C extends { enum: readonly (infer E)[] } ? (string extends E ? T : E & T) : T

type Nullable<C extends ColumnSpec, T> = C extends { nullable: true } ? T | null : T

/** The Kysely column type of one declared column. */
export type ColumnOf<C extends ColumnSpec> =
  C extends { policy: true }
    ? ColumnType<Nullable<C, Base<C, KindTypes[C['kind']]>>, never, never>
    : C extends { default: string }
      ? ColumnType<Nullable<C, Base<C, KindTypes[C['kind']]>>, Nullable<C, Base<C, Write<C['kind']>>> | undefined, Nullable<C, Base<C, Write<C['kind']>>>>
      : ColumnType<Nullable<C, Base<C, KindTypes[C['kind']]>>, Nullable<C, Base<C, Write<C['kind']>>>, Nullable<C, Base<C, Write<C['kind']>>>>

type Timestamps<M extends ModelSpec> = M extends { timestamps: true }
  ? { created_at: ColumnType<string, string | Date | undefined, string | Date>; updated_at: ColumnType<string, string | Date | undefined, string | Date> }
  : unknown

type Audit<M extends ModelSpec> = M extends { audit: true } ? { created_by: string | null; updated_by: string | null } : unknown

type Flatten<T> = { [K in keyof T]: T[K] }

/** The Kysely table interface of a model: declared columns plus the managed ones. */
export type TableOf<M extends ModelSpec> = Flatten<{ [K in keyof M['columns'] & string]: ColumnOf<M['columns'][K]> } & Timestamps<M> & Audit<M>>

/** The Kysely database interface of a list of models, keyed by bare table name (table names are
 *  unique across the Box; the qualify plugin adds the schema from the area map, kysely.ts). */
export type ModelDb<Ms extends readonly ModelSpec[]> = { [M in Ms[number] as M['table']]: TableOf<M> }

/** A row as the record layer returns it (model.ts rowToRecord): vectors parsed to number[]. */
export type RecordOf<M extends ModelSpec> = Flatten<{
  [K in keyof Selectable<TableOf<M>>]: K extends keyof M['columns']
    ? M['columns'][K] extends { kind: 'vector' } ? Nullable<M['columns'][K], number[]> : Selectable<TableOf<M>>[K]
    : Selectable<TableOf<M>>[K]
}>
