// Kysely as a query builder on the executor. Kysely builds and compiles the SQL; the executor runs
// it, so the permission contract is the executor's, unchanged (executor.ts): the login comes from
// the current context, no context refuses, every statement passes the classifier on the extended
// protocol, read-only transactions stay read-only, connections come from the budgeted pools.
//
//   featureDb<DB>()   a feature's tables, on the caller's role login (reach `area`)
//   coreDb<DB>()      core's shared tables, on box_core (reach `core`)
//
// A statement inside an open executor transaction (withWrite, withReadOnly, withSerializable, or
// the callback of another statement's transaction) runs in it, whatever the instance's reach:
// exactly what `tx.query` does. Outside one, each statement is its own transaction on the
// instance's reach: read-only for a SELECT, a write transaction otherwise (raw `sql` included).
// Kysely's own transactions (`db.transaction()`, `db.startTransaction()`) are refused: the executor
// owns BEGIN, the context settings and afterCommit; use withWrite and friends. Streaming
// (`.stream()`) is refused too: the executor has no cursor; page with keyset conditions.
//
// Tables are named bare (`selectFrom('artifact_kv')`); the qualify plugin adds the schema from the
// Box's area map at compile time (`"artifacts"."artifact_kv"`), the same rule as `table(m)`, so no
// call site assumes that a feature's schema is its id. Column references keep the bare table name
// or alias, which PostgreSQL resolves against the qualified FROM item.

import {
  Kysely,
  OperationNodeTransformer,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SelectQueryNode,
  TableNode,
  sql,
  type CommonTableExpressionNode,
  type WithNode,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type KyselyPlugin,
  type OperationNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryId,
  type QueryResult,
  type RootOperationNode,
  type SelectModifierNode,
  type FunctionNode,
  type AggregateFunctionNode,
  type ReferenceNode,
  type UnknownRow,
} from 'kysely'
import { executor, openTx, type Reach, type Tx } from './executor.js'
import { boxAreas } from './tables.js'

export { sql } from 'kysely'
export type { Expression, ExpressionBuilder, Insertable, Kysely, RawBuilder, Selectable, SqlBool, Updateable } from 'kysely'
export type { ColumnOf, ModelDb, RecordOf, TableOf } from './model-db.js'

// ---- Qualify plugin ----

/** Maps a bare table name to its schema; undefined leaves the name as written. */
export type SchemaOf = (table: string) => string | undefined

const cteName = (e: CommonTableExpressionNode): string => e.name.table.table.identifier.name

class QualifyTransformer extends OperationNodeTransformer {
  // The CTE names visible where the transformer is now. A statement's own WITH names are visible to
  // the rest of the statement (everything but the WITH list); `transformWith` narrows them per CTE.
  #ctes = new Set<string>()
  // The names visible OUTSIDE a WITH, remembered when its statement was entered.
  #outer = new WeakMap<object, Set<string>>()
  constructor(private readonly schemaOf: SchemaOf) { super() }

  protected override transformNodeImpl<T extends OperationNode>(node: T, queryId?: QueryId): T {
    const w = (node as { with?: WithNode }).with
    if (!w) return super.transformNodeImpl(node, queryId)
    const saved = this.#ctes
    this.#outer.set(w, saved)
    this.#ctes = new Set([...saved, ...w.expressions.map(cteName)])
    try { return super.transformNodeImpl(node, queryId) } finally { this.#ctes = saved }
  }

  // PostgreSQL scoping: a CTE body sees the earlier CTEs of its WITH (not itself, so a base table of
  // the same name stays a base table); WITH RECURSIVE also lets it see itself and the later ones.
  protected override transformWith(node: WithNode, queryId?: QueryId): WithNode {
    const all = this.#ctes
    const outer = this.#outer.get(node) ?? all
    const names = node.expressions.map(cteName)
    try {
      return {
        ...node,
        expressions: node.expressions.map((e, i) => {
          this.#ctes = new Set([...outer, ...(node.recursive ? names : names.slice(0, i))])
          return { ...e, expression: this.transformNode(e.expression, queryId) }
        }),
      }
    } finally { this.#ctes = all }
  }

  protected override transformTable(node: TableNode, queryId?: QueryId): TableNode {
    const t = super.transformTable(node, queryId)
    if (t.table.schema) return t
    const name = t.table.identifier.name
    if (this.#ctes.has(name)) return t
    const schema = this.schemaOf(name)
    return schema ? TableNode.createWithSchema(schema, name) : t
  }

  // `t.col`, `t.*`: the table name or an alias, never schema-qualified.
  protected override transformReference(node: ReferenceNode, queryId?: QueryId): ReferenceNode {
    return { ...node, column: this.transformNode(node.column, queryId) }
  }

  // `for update of t`: PostgreSQL takes a FROM item's name or alias here, not a qualified name.
  protected override transformSelectModifier(node: SelectModifierNode, queryId?: QueryId): SelectModifierNode {
    return { ...super.transformSelectModifier({ ...node, of: undefined }, queryId), of: node.of }
  }

  // `to_json(t)`, `json_agg(t)`: a whole-row reference, not a table.
  protected override transformFunction(node: FunctionNode, queryId?: QueryId): FunctionNode {
    return { ...super.transformFunction({ ...node, arguments: [] }, queryId), arguments: node.arguments.map((a) => (TableNode.is(a) ? a : this.transformNode(a, queryId))) }
  }

  protected override transformAggregateFunction(node: AggregateFunctionNode, queryId?: QueryId): AggregateFunctionNode {
    return { ...super.transformAggregateFunction({ ...node, aggregated: [] }, queryId), aggregated: node.aggregated.map((a) => (TableNode.is(a) ? a : this.transformNode(a, queryId))) }
  }
}

/** Schema-qualifies every bare table a statement names (FROM, JOIN, INTO, UPDATE, USING). */
export class QualifyTablesPlugin implements KyselyPlugin {
  constructor(private readonly schemaOf: SchemaOf) {}
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return new QualifyTransformer(this.schemaOf).transformNode(args.node, args.queryId)
  }
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result
  }
}

/** The running Box's area map as a SchemaOf: declared tables only, anything else as written. */
export function boxSchemaOf(table: string): string | undefined {
  const areas = boxAreas()
  try { return areas.schemaOf(areas.ownerOf(table)) } catch { return undefined }
}

// ---- Executor driver ----

const AFFECTS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE'])

class ExecutorConnection implements DatabaseConnection {
  constructor(private readonly reach: Reach) {}

  async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
    const run = (tx: Tx) => tx.exec<R>(q.sql, q.parameters)
    const open = openTx()
    const r = open ? await run(open) : await executor().transaction(run, { reach: this.reach, readOnly: SelectQueryNode.is(q.query) })
    return AFFECTS.has(r.command) ? { rows: r.rows, numAffectedRows: BigInt(r.rowCount) } : { rows: r.rows }
  }

  // oxlint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streaming is not supported on the executor: page with keyset conditions')
  }
}

const OWN_TRANSACTION = 'Kysely transactions are not used here: run the statements inside withWrite, withReadOnly or withSerializable (warehouse/db)'

class ExecutorDriver implements Driver {
  private readonly connection: ExecutorConnection
  constructor(reach: Reach) { this.connection = new ExecutorConnection(reach) }
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> { return this.connection }
  async beginTransaction(): Promise<void> { throw new Error(OWN_TRANSACTION) }
  async commitTransaction(): Promise<void> { throw new Error(OWN_TRANSACTION) }
  async rollbackTransaction(): Promise<void> { throw new Error(OWN_TRANSACTION) }
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

/** The dialect: PostgreSQL's compiler and adapter, the executor as the driver. */
export function executorDialect(reach: Reach): Dialect {
  return {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new ExecutorDriver(reach),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  }
}

function create<DB>(reach: Reach, schemaOf: SchemaOf = boxSchemaOf): Kysely<DB> {
  // Built on first use: features create theirs at module scope, and the feature registry that the
  // area map reads (tables.ts) imports those modules while this one may still be loading.
  let k: Kysely<DB> | undefined
  const real = () => (k ??= new Kysely<DB>({ dialect: executorDialect(reach), plugins: [new QualifyTablesPlugin(schemaOf)] }))
  return new Proxy({} as Kysely<DB>, {
    get(_, p) {
      const v: unknown = Reflect.get(real(), p)
      return typeof v === 'function' ? v.bind(real()) : v
    },
  })
}

/** Typed queries on a feature's tables, on the caller's role login. Create once per feature
 *  (`export const db = featureDb<ArtifactsDb>()`); it holds no connection. */
export function featureDb<DB>(schemaOf?: SchemaOf): Kysely<DB> {
  return create<DB>('area', schemaOf)
}

/** Typed queries on core's shared tables, on box_core (core accessors only). */
export function coreDb<DB>(schemaOf?: SchemaOf): Kysely<DB> {
  return create<DB>('core', schemaOf)
}

/** `now()`: the transaction's timestamp, for timestamptz columns. */
export const now = () => sql<string>`now()`

/** A value for a `json` column: its JSON text, which PostgreSQL casts to jsonb by the column's type.
 *  Never pass a JavaScript array as a json value: the driver sends arrays as PostgreSQL arrays. */
export function json(value: unknown): string {
  const text = JSON.stringify(value)
  if (text === undefined) throw new Error('a json value must be JSON-serializable')
  return text
}

const ARRAY_TYPES = new Set(['text', 'int', 'bigint', 'float8', 'boolean', 'timestamptz', 'date'])

/** `any($1::<type>[])`: membership in a list as ONE array parameter, for `where(col, '=', anyOf(ids))`.
 *  Unlike `in (...)` it keeps one statement shape for any list length and an empty list matches
 *  nothing instead of failing to compile. */
export function anyOf<T>(values: readonly T[], type: 'text' | 'int' | 'bigint' | 'float8' | 'boolean' | 'timestamptz' | 'date' = 'text') {
  if (!ARRAY_TYPES.has(type)) throw new Error(`anyOf: unsupported element type "${type}"`)
  return sql<T>`any(${[...values]}::${sql.raw(type)}[])`
}
