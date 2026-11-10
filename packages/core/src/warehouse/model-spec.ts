// The table description every model shares (record layer: model.ts; DDL: pg/ddl.ts). Import-free,
// so DDL and the schema runner load without the area map or the feature registry.

export type ColumnKind = 'text' | 'int' | 'bigint' | 'float' | 'bool' | 'json' | 'timestamp' | 'date' | 'text[]' | 'tsvector' | 'vector'

export interface ColumnSpec {
  kind: ColumnKind
  /** Columns are NOT NULL unless explicitly nullable (PK columns are always NOT NULL). */
  nullable?: boolean
  /** SQL default, emitted verbatim into the DDL (quote string literals yourself: `"'draft'"`). */
  default?: string
  /** Allowed values, validated on every write - the app-level CHECK constraint. A thunk when the
   *  list is tenant configuration rather than code (`initiatives.kind`), so the gate reads whatever
   *  the team's list says at write time instead of what it said at import time. */
  enum?: readonly string[] | (() => readonly string[])
  /** Written only by the policy service (`users.role`): the record layer never inserts or updates
   *  it, and the runtime logins hold no grant on it (pg/policy.ts). */
  policy?: true
  /** A CHECK constraint on the column, emitted verbatim (`cardinality(areas) > 0`). */
  check?: string
  /** `vector` only: the fixed number of dimensions (pgvector `ext.vector(n)`). */
  dimensions?: number
}

export interface ModelSpec {
  table: string
  /** Primary-key column names (must exist in `columns`). */
  pk: readonly string[]
  columns: Record<string, ColumnSpec>
  /** Adds managed created_at/updated_at timestamptz columns. */
  timestamps?: boolean
  /** Adds managed created_by/updated_by columns, stamped from the upsert input's `actor`. */
  audit?: boolean
  /** Unique constraints beyond the primary key (a foreign key's target, for one). */
  unique?: readonly (readonly string[])[]
  /** Foreign keys to tables in the same schema, declared after their target (model order). */
  foreignKeys?: readonly ForeignKeySpec[]
  /** A feature table the policy service also writes (PERMISSIONS 9.2): box_policy holds select,
   *  insert, update and delete on it beside the area's groups, so a change to it commits in the
   *  same transaction as role and user-role changes (chat's rooms, members and agent seats). */
  policyTable?: true
}

/** A foreign key. An update of the parent key cascades; a delete cascades too unless `onDelete` is
 *  `no action`, which refuses to delete a parent that still has children at the end of the
 *  statement (the store must remove or detach them first, so forgetting is an error, not a leak). */
export interface ForeignKeySpec {
  columns: readonly string[]
  table: string
  references: readonly string[]
  onDelete?: 'cascade' | 'no action'
}

/** Every column of the model, managed ones included, in declaration order. */
export function modelColumns(m: ModelSpec): Record<string, ColumnSpec> {
  const cols: Record<string, ColumnSpec> = { ...m.columns }
  if (m.timestamps) {
    cols.created_at = { kind: 'timestamp', default: 'now()' }
    cols.updated_at = { kind: 'timestamp', default: 'now()' }
  }
  if (m.audit) {
    cols.created_by = { kind: 'text', nullable: true }
    cols.updated_by = { kind: 'text', nullable: true }
  }
  return cols
}


/**
 * Declare a model with its literal types kept (`kind: 'text'`, `table: 'artifacts'`, enum tuples),
 * so the Kysely table type can be derived from it (model-db.ts). Returns `m` unchanged.
 */
export function defineModel<const M extends ModelSpec>(m: M): M {
  return m
}
