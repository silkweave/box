# The warehouse - core's data layer

One **PostgreSQL-compatible database** is the ground truth for everything a Box stores as rows.
Each Box runs its own cluster on the same machine, with no network listener; writes go straight
into it. There is no JSON source, no seed and no rebuild step.

- **Engines:** `pgrust` (the default for a new Box) or native PostgreSQL 18 with pgvector, chosen
  by `database.engine` in `box.json` ([CONFIGURATION.md](CONFIGURATION.md)). pgrust is downloaded
  on the first start, checked against its publisher's checksum and unpacked into `data/engines/`;
  native PostgreSQL, pgvector and the client tools (`pg_dump`, `pg_restore`, needed by both engines)
  come from the host's package manager: `box setup` runs the install command (Homebrew, or apt with
  sudo) on the owner's confirmation, and a start without them refuses with that command. Version ranges are checked at every
  start; exact builds are recorded in `data/db/active.json` and in every restore point.
- **Where:** `data/db/<engine>-<n>/` holds one cluster (`pgdata/`, `server.log`, `cluster.json`);
  `data/db/active.json` names the active one. The instance dir (`data/`) is always
  `<checkout>/data`; no environment variable moves it, so a second tenant or a scratch Box is a
  second checkout. **Gitignored**: the durable copies are the restore points below, never git.
- **Lifecycle:** the supervisor (`box start` / `box dev`) owns the running cluster and keeps it
  across application restarts. A CLI script that finds a running owner only connects; one that
  finds none starts the cluster under the instance lock and stops it on exit. Editing
  `database.engine` never moves existing data: a mismatch with the active cluster refuses to start
  and names `box db switch`.
- **Ownership:** core owns the engine, the executor, the record layer, the schema lifecycle and its
  tables in schema `core`, declared in
  [`warehouse/core-models.ts`](../packages/core/src/warehouse/core-models.ts) (`CORE_MODELS`):
  `users`, `kv_state`, `events` and `automation_runs`, the signal tables `signals`,
  `signal_points`, `snapshots` and `data_sources`
  ([`signals/models.ts`](../packages/core/src/signals/models.ts)), the currency rates table
  `fx_rates` ([`fx/rates.ts`](../packages/core/src/fx/rates.ts)), all described in
  [SIGNALS.md](SIGNALS.md), plus the policy tables (`roles`, role logins, policy state; see
  [AUTH.md](AUTH.md)). Every other table belongs to a feature, lives in its area's schema, and is
  documented in the recipe it came from, `recipes/<id>/SPEC.md`.

This document is core's half. For what a feature's table means, read its feature's SPEC. Files
(chat uploads and artifact trees) are outside the database; their recipes describe
them.

## Schemas, logins and the executor

**One schema per area.** A feature's tables live in its area's schema, resolved through the area
map ([`warehouse/pg/areas.ts`](../packages/core/src/warehouse/pg/areas.ts); hyphens become
underscores), core's shared tables in `core`, extensions in `ext`. SQL is always
schema-qualified: `table(m)` from [`warehouse/tables.ts`](../packages/core/src/warehouse/tables.ts)
gives `"schema"."table"`. Nothing relies on a `search_path`.

**Logins.** Every login authenticates by OS peer over the cluster's Unix socket (one ident map for
the Box's OS account); there is no password and no TCP.

| Login | Runs |
|---|---|
| `box_role_<n>` | a principal's work: one login per role, a member of each area's read or write group at the role's level |
| `box_core` | core's accessors on the shared tables, under row security, and bootstrap (authentication) |
| `box_system` | named system work (`asSystem(reason, fn)`, [AUTH.md](AUTH.md)) and core commands |
| `box_policy` | policy changes: roles and their logins, user and agent roles, the policy journal and the feature tables marked `policyTable` (chat's rooms, members and agent seats), one transaction per change |
| `box_owner` | maintenance only: schema, migrations, backups, restore. Never runtime work |

**The executor** ([`warehouse/executor.ts`](../packages/core/src/warehouse/executor.ts)) is the one
way runtime code reaches the database, and no raw client leaves core:

- **The login comes from the current context, never from the caller.** A principal's request runs
  feature SQL on its role's login and core accessors on `box_core`; system work runs on
  `box_system`. With no request, system or bootstrap context there is no connection.
- **Every statement runs in a transaction.** Nesting on the same login reuses the open transaction
  (no second `BEGIN`, no second client); nesting on another login is refused.
- **Feature SQL is one parameterized data statement** (`SELECT`, `INSERT`, `UPDATE`, `DELETE`,
  `WITH`, `VALUES`, `TABLE`; placeholders `$1`, `$2`, ...). Transaction control and settings belong
  to the executor, which opens each transaction with `SET LOCAL` of the statement timeout (10 s
  unless a caller asks for up to 10 minutes), `timezone = 'UTC'`, the principal, its readable and
  writable areas and its access revision. Row security reads those settings.
- **After commit.** `emitChange` and work queued with `afterCommit(fn)` run after the outermost
  transaction commits; a rollback drops them.

The warehouse API on top ([`warehouse/db.ts`](../packages/core/src/warehouse/db.ts)):

- **`withRead(sql, params, { reach })`** runs one statement in a read-only transaction and returns
  rows (timestamps as exact ISO strings, see below).
- **`withReadOnly(fn, { reach })`** runs several reads in one read-only transaction with one
  admission round trip. It is read committed: each statement sees what was committed when it began.
- **`withSnapshot(fn, { reach })`** is the same with one snapshot for every statement (repeatable
  read), for reads that must agree with each other (a search index). Nested inside a read
  committed transaction it is refused.
- **`withWrite(fn, { reach })`** is a real transaction: `fn(tx)` with `tx.query` / `tx.run`.
- **`withSerializable(fn)`** runs `fn` serializable with a bounded retry on serialization failures
  and deadlocks. `fn` may run more than once, so it must have no side effects outside the database.

`reach: 'core'` targets core's shared tables (`box_core`); the default reaches the caller's areas.
A transaction is necessary, not sufficient: a read-then-insert path uses a unique constraint with a
conflict-aware write, locks a stable parent row, or runs serializable; an existing row is read
`FOR UPDATE`. A callback with external side effects is never retried automatically.

### Typed queries (Kysely)

Queries are built with [Kysely](https://kysely.dev/) and run by the executor
([`warehouse/kysely.ts`](../packages/core/src/warehouse/kysely.ts)). Kysely compiles; it never
owns a connection, so everything above holds for a built query exactly as for `tx.query`.

- **`featureDb<DB>()`** queries a feature's tables on the caller's role login; **`coreDb<DB>()`**
  queries core's shared tables on `box_core`. A feature creates one instance in its `core/db.ts`.
- **Inside an open transaction** (`withWrite`, `withReadOnly`, `withSerializable`) a built query
  runs in it, whatever the instance: one commit, one rollback, `afterCommit` after the commit.
  **Outside one**, each statement is its own transaction: read-only for a `SELECT`, a write
  transaction otherwise.
- **Kysely's own transactions and `.stream()` are refused.** The executor owns `BEGIN`, the
  context settings and `afterCommit`; page large reads with keyset conditions.
- **Tables are named bare** (`selectFrom('artifact_kv')`). A plugin adds the schema from the area
  map at compile time, the same rule as `table(m)`; CTE names, explicit schemas, `FOR UPDATE OF`
  and whole-row references (`to_json(t)`) are left alone.
- **Types come from the ModelSpecs.** Declare a model with `defineModel` and derive the feature's
  database type with `ModelDb<typeof FEATURE_MODELS>`: column kinds map to what the executor's type
  parsers return, nullable columns are `T | null`, a column with a default is optional on insert,
  an enum tuple becomes a union and a `policy` column cannot be written. `RecordOf<typeof MODEL>`
  is the row the record layer returns. Nothing is generated.
- **Values.** A `json` column is read parsed and written as JSON text (`json(value)`; a JavaScript
  array passed directly would be sent as a PostgreSQL array). `now()` is the transaction time.
  `anyOf(ids)` is list membership as one array parameter (`= any($1::text[])`).
- **Raw spots.** `sql` template tags (parameterized) remain for what Kysely does not express
  cleanly: pgvector operators, text search ranking, engine-specific functions. Raw SQL still
  passes the classifier.

### The connection envelope

The cluster allows 40 connections: 3 slots reserved for superusers (maintenance) and 4 for
`box_core` (`pg_use_reserved_connections`), so authentication and core accessors still connect when
other logins fill the rest. In steady state one Box process uses at most:

| | Connections |
|---|---|
| executor pools | 24 open, idle and closing ones included; 4 of them held back for `box_core` (an application limit inside the 24, not extra cluster slots) |
| policy listener | 1 (LISTEN for policy changes made by another process) |
| policy snapshot | 1 `box_core` session while a refresh reads the policy (one repeatable-read transaction) |
| policy lane | 1 `box_policy` session; further policy commands queue (bounded) |

Maintenance adds its own sessions on top: a backup holds the owner's snapshot session plus
`pg_dump`'s, and the schema runner one owner session at boot.

Pools are lazy, one per login. At the limit an acquire closes an idle connection of another login
and waits until the close has completed; when too many callers already wait, it fails with
`BUDGET`. On release a connection is rolled back unless committed, reset with `DISCARD ALL` and its
statement cache cleared; one whose reset fails is destroyed. A CLI script is a process of its own
with its own pools.

## The record layer

Every table is described **once** as a `ModelSpec`. From that one description,
[`warehouse/model.ts`](../packages/core/src/warehouse/model.ts) derives the plumbing (the DDL, the
column list, the row mapper, a locked read-merge-write upsert):

```ts
export const INBOX_STATE: ModelSpec = {
  table: 'inbox_state',
  pk: ['id'],
  columns: {
    id: { kind: 'text' },
    status: { kind: 'text' },
    done_at: { kind: 'timestamp' },
    note: { kind: 'text', nullable: true },
  },
}
```

`ColumnKind` is `text | int | bigint | float | bool | json | timestamp | date | text[] | tsvector |
vector`. A `vector` column declares its `dimensions` and becomes pgvector's `ext.vector(n)`; the
record layer writes a number list and reads one back. A `tsvector` column is written by the
feature's own SQL (`to_tsvector`). A column is **NOT NULL unless declared `nullable`** (PK columns always
are). `default` and `check` (a column CHECK constraint, enforced by the database) are emitted
verbatim into the DDL, so quote string literals yourself (`default: "'draft'"`).

What the layer derives:

- **`createTableSql(m)`** ([`pg/ddl.ts`](../packages/core/src/warehouse/pg/ddl.ts)) - the
  `CREATE TABLE IF NOT EXISTS` baseline DDL in the owner's schema.
- **`modelColumns(m)`** - the declared columns plus the managed ones: `timestamps: true` adds
  `created_at` / `updated_at`, `audit: true` adds `created_by` / `updated_by`.
- **`selectCols(m)`** and **`rowToRecord(m, row)`** - the SELECT list and the row to domain mapping
  (jsonb parsed, numbers as numbers, instants and dates as strings).
- **`validateEnums(m, values)`** - the app-level enum gate. `enum` may be a thunk when the allowed
  list is tenant configuration rather than code, so the gate reads what the team's list says at
  write time instead of what it said at import time.
- **`upsertRecord(m, input)`** - the partial UPSERT (below).
- **`readRecords` / `readRecord` / `deleteRecord` / `lockedRow`** - the rest of the CRUD.

Domain semantics stay in the domain modules on top: create-defaults, cascade deletes, slug re-keys,
derive hooks, deep merges. This layer only owns the mechanical plumbing.

### Value shapes: instants, dates and big integers

The executor's type parsers fix what a read returns, whatever the host's time zone:

- **`timestamp` columns are `timestamptz` instants.** Writes pass ISO-8601 text (`toInstant`: an
  offset, or none for UTC); reads return `YYYY-MM-DDTHH:MM:SS[.ffffff]Z` with the stored precision
  (microseconds), never through a JS `Date`. Every session runs in UTC, so SQL `now()` and
  `current_date` are UTC too.
- **`date` columns** read as `YYYY-MM-DD`.
- **`int8`** reads as a number only when it is a safe integer; anything larger is an error at the
  boundary unless the column is read as text.

`sameRecord(m, prev, next)` compares a candidate write against the stored row over the **declared**
columns only (managed timestamps and audit excluded): JSON by content rather than key order,
instants to the microsecond whatever their written form (`instantMicros`), numbers as numbers. It
exists for the machine writers: a nightly sync re-asserting unchanged data must NOT write, because
an upsert always restamps `updated_at` / `updated_by`, and a human's decision stamped over by "the
agent, last night" every night is an audit trail that says nothing.

### The partial upsert and the audit stamp

`upsertRecord` reads the previous row locked (or takes it via `opts.prev` when the caller already
read it for its own merge decisions), merges, validates, stamps and writes one
`INSERT ... ON CONFLICT DO UPDATE` in one transaction, and returns the stored row. The merge rule:
**an input key wins, including an explicit `null`; an absent key keeps the previous value**, falling
to the column default only when there is no previous row. A domain module that needs a non-shallow
merge resolves it *before* calling.

`created_at` and `created_by` are excluded from the conflict UPDATE list, so they are set once and
are unrewritable through the tool surface. `actor` on the input becomes `updated_by` (and
`created_by` on insert); a blank or whitespace actor is treated as "nobody said" and stamped NULL,
because `''` would be a third value beside a real id and NULL that nothing downstream
distinguishes. Because `created_by` is permanent, the actor is validated here rather than per
domain module: `assertKnownActor(actor)` requires it to name an existing `users.id` (see
[`docs/AUTH.md`](./AUTH.md)).

Every write path emits `emitChange('table:<name>')` after commit - see the changes seam below.

## Applying the schema

[`warehouse/schema.ts`](../packages/core/src/warehouse/schema.ts) declares core as a schema owner
and turns every registered feature into one; the runner is
[`warehouse/pg/migrate.ts`](../packages/core/src/warehouse/pg/migrate.ts), started once per process
by `bootDatabase` ([`pg/boot.ts`](../packages/core/src/warehouse/pg/boot.ts)). It has no global
list of anything: it iterates the **ordered feature registry**.

The runner uses one maintenance session (`box_owner`) that holds an advisory lock across the whole
run and releases it on success and on every failure. It plans before it changes anything:

1. **Ledger check** (read only): an applied migration missing from installed code, or one whose
   checksum changed, refuses boot. `core.schema_contract` holds a fingerprint of the models and
   baseline DDL last applied, so a new table or index in an existing area is planned like a
   migration.
2. **Restore point:** when an existing database has pending migrations, a new area or a changed
   contract, a `pre-migrate` restore point is taken while nothing has changed yet
   ([below](#automatic-pre-migration-restore-points)). A fresh database (no `core` schema) needs
   none.
3. **Contract objects:** the cluster logins and groups, database hardening, the `core`, `ext` and
   area schemas, the ledger tables.
4. **Baseline**, in one transaction: every model as `CREATE TABLE IF NOT EXISTS` in its owner's
   schema (core first), then each feature's idempotent `baseline` DDL (views, indexes).
5. **Migrations:** each pending migration and its ledger row commit in one transaction (a
   `concurrent` one excepted, below).
6. **Grants and row security** on core's shared tables
   ([`pg/rls.ts`](../packages/core/src/warehouse/pg/rls.ts)).

Boot then reconciles the role logins with the stored roles and runs the **catalog check**
([`pg/catalog.ts`](../packages/core/src/warehouse/pg/catalog.ts)): logins and their attributes, no
login passwords, grants, every row-security policy text for text, `security_invoker` views, the
extension inventory, and the cluster's own files and socket directory. A difference fails closed:
the Box does not admit work on a database whose security contract it cannot confirm. The check
covers that contract, not row contents and not an exact inventory of every feature table: an
extra table whose owner, grants and row security follow its area's rules passes, and a data change
is never seen.

### Ordering

`orderOwners` returns **core first, then features in dependency order, ties broken by id**.
Deterministic ordering is the point: two Boxes with the same directories apply the same sequence,
whatever order the registry happened to list them in. It throws on a cycle, naming the trail, and
on a `dependsOn` that names a feature which is not present. Two features declaring the same table,
or a duplicate migration name within one feature, are refused.

The **only** cross-feature guarantee is that a dependency's tables and migrations are complete
before a dependent's migration runs. Two features' `001`s have no relationship to each other.

### The migration ledger

Each owner has an **append-only list starting at its own `001`**, recorded in
`core.schema_migrations` as `<feature>:<name>` - `crm:001-deal-shape`. The author writes
`name: '001-deal-shape'`; the runner adds the prefix.

```ts
export interface Migration {
  name: string                                              // 'NNN-slug' by convention
  statements?: readonly string[] | (() => readonly string[])
  run?: { revision: string; fn: (tx: MigrationTx) => Promise<void> }  // when a decision depends on what is stored
  data?: unknown                                            // data the statements or run bind
  concurrent?: boolean                                      // CREATE INDEX CONCURRENTLY: outside a transaction
}
```

Rules that hold the whole thing together:

- **The ledger travels inside the database**, so a restored older restore point upgrades itself on
  its first boot.
- **Each migration commits atomically with its ledger row.** A crash mid-migration re-runs it whole,
  never half-applied. A `concurrent` migration cannot run in a transaction: its statements run
  first, then its ledger row; write them so a re-run is safe (`IF NOT EXISTS`).
- **A migration name is an immutable ledger key.** A migration is born with the vocabulary of its
  day and never renames.
- **Never edit or reorder a migration that has shipped.** Adding a column means *both*: extend the
  ModelSpec (fresh Boxes get it from CREATE) AND append a migration with the ALTER (existing Boxes
  get it once). PostgreSQL applies an ALTER with its constraints, so an upgraded Box and a fresh
  one end with the same shape: add the column with a DEFAULT (which fills every existing row) or
  backfill it before `SET NOT NULL` in the same migration.
- **Static migration SQL names only its own feature's tables, schema-qualified**, for reads as well
  as writes. Cross-feature reads belong inside `run`, through a declared dependency's exported
  reader, so a skipped version does not replay SQL against a dependency's obsolete column names.
  `schema:check` warns on other references; complex SQL and `run` still need review. A table the
  feature once owned and its migrations now drop or reshape goes in the feature's `retiredTables`:
  never baselined, but counted as its own by the ownership check.

**The checksum** is SHA-256 over a canonical, length-prefixed encoding of the name, the ordered
statements, the `run` revision, any bound `data` and the mode (`concurrent` or transactional);
never function source text. Bump `revision`
when `run` changes meaning, and only then. An edited or removed applied migration refuses boot while
its feature is installed. Ledger rows for removed features stay untouched. SQL factories must
produce stable statements across machines and boots.

Each feature documents its own migrations.

## `bun run schema:check`

Run `bun run schema:check` after changing a model, baseline or migration. It starts one throwaway
cluster (pgrust; `BOX_TEST_ENGINE=native` for the other engine) with one database per pass, and
writes nothing to the tree.

It proves three things:

1. **Fresh + reboot.** Apply every owner's schema on an empty database, then again on the same one;
   every declared table must exist in its owner's schema.
2. **Enabled later.** For each feature, create a database without it and its dependents, then enable
   the whole set. This is the pass that catches an undeclared assumption about a neighbour's
   presence: a view or migration reaching for a table its feature never listed in `dependsOn` works
   on a full Box and fails on the Box that left that neighbour out. Unit tests cannot see this.
3. **Ownership,** as a **warning**. Static migration SQL that names a table the feature does not
   own, or a table that is not schema-qualified, is reported, not rejected. A team merging two
   integrated features into one vocabulary is doing exactly what the model invites. On the
   maintainer checkout, where apps are meant to stay separable, treat a warning as something to
   fix. It is a conservative heuristic, not a SQL parser.

It cannot prove a data migration against real rows; every table it creates starts empty. That is
what `box db backup` plus a rehearsal on a restored copy is for (see below), plus tests with rows
that match the migration's WHERE clause.

### What still refuses to boot

Two guards are about correctness rather than compliance, so they stay in the runner:

- an **applied migration missing from installed code**, while its feature is installed;
- an applied migration whose **checksum no longer matches** the code.

In both cases the code on disk no longer describes the database, and continuing would apply the
rest of the schema on top of a state nobody can name. Neither is a style rule you can waive. If you
genuinely meant to rewrite history, take a restore point first (`box db backup`), then restore one
taken before the change or start the Box over on a new checkout; never edit the ledger by hand.

## Working rules for an agent changing schema

You are allowed to change this team's schema. That is the point of the product. These are the rules
that keep a change recoverable rather than the rules that keep it approved.

**Before you touch a migration, a model or a baseline:**

1. `box db backup`. It takes seconds, it is generationally retained, and it is the difference
   between a bad migration being an inconvenience and being an incident. The automatic
   pre-migration restore point covers the moment the migration runs; it does not cover the half
   hour of experimenting before it.
2. `box db list` to see that the restore point is actually there, with a plausible size.
3. Know whether the database holds real data. On a Box with `crm` or another data feature installed
   and in use, assume it does.

**Rehearsing a data migration.** The only rehearsal worth the name uses real rows:

```bash
box db backup                                   # on the Box with the real data
box db list                                     # copy the name

# in a SECOND CHECKOUT of the repo - its own data/, its own ports in its own box.local.json
git clone git@github.com:silkweave/box.git box-scratch && cd box-scratch && bun install
mkdir -p data/backups/db && cp -R /path/to/real/box/data/backups/db/<name> data/backups/db/
box db restore <name>
box dev                                         # watch the migration apply for real
```

A throwaway Box is a second checkout, because the instance directory is always `<checkout>/data`
and nothing in the environment redirects it. Never rehearse by pointing a second server at the real
data directory: one cluster has one owner, and the instance lock refuses the second.

**Verifying a restore.** A restore point you have never restored is a hope. Once, on a throwaway
Box: restore it, boot, sign in, and look at a page that shows rows you recognise. `box db list`
proves a directory exists; only a boot proves it is a database with your data in it.

**What never to do to a database holding real data:**

- Never run a destructive migration, or any restore, without a restore point taken in the same
  sitting.
- Never delete `data/db/` to "fix" a schema error on a Box with real rows. The error is telling you
  the code and the database disagree; deleting the database resolves the disagreement in the worst
  possible direction.
- Never edit an applied migration in place. Append a new one. The checksum guard exists because the
  alternative is a database whose history is fiction.
- Never point two servers at one checkout's `data/`. A scratch Box gets its own checkout, and its
  own ports in that checkout's `box.local.json`.
- Never hand a restore point to anyone casually. With `crm` installed it holds names, emails and
  correspondence, and a restore point inherits the sensitivity of everything installed.
- Never change schema with `psql` as `box_owner`. The runner and the ledger are the schema's
  authority. The catalog check catches a hand-made grant, policy or login at the next boot, but not
  a hand-made table that happens to follow its area's rules, nor any data change.

## The events spine

[`packages/core/src/events.ts`](../packages/core/src/events.ts) is the **domain-integration** seam.
Every normalized domain event is recorded durably in `events` (PK `(kind, dedup_key)`) **before**
any policy looks at it.

```ts
const fresh = await recordEvent({ kind: 'support.ticket.closed', dedup_key: ticketId, fields: { ... }, areas: ['support'] })
```

`areas` is required: every area a reader needs to see the event, from the data (the producing
feature for its own records; a signal event takes the signal's area plus a formula's inputs,
`signalAreaClosure`; a digest the union of its inputs; `admin` when nothing classifies it). It is
stored sorted and unique in `events.areas`, which a CHECK keeps non-empty with no blank member.

`recordEvent` is the **freshness gate**. The insert is
`INSERT ... ON CONFLICT (kind, dedup_key) DO NOTHING ... RETURNING id`, and it returns `true` only when
a row was actually inserted. A duplicate means "already processed, never react twice", which is what
makes every producer safely re-runnable: a poller that re-reads the same window, a webhook that
retries, a backfill over a range that already landed. That raw insert deliberately stays raw - the
idempotency semantics are exactly what the record layer's partial upsert would destroy. Plain row
reads go back through the record layer (`readRecords(EVENTS, ...)`); aggregate queries stay raw.

**Subscribers are in-process, best-effort and fresh-only.** `onEvent(listener)` returns an
unsubscribe and is registered from a server module's `onModuleInit`. `recordEvent` fans out only on
the fresh path, only after the row is committed, and **awaits** the listeners, so a caller that
chains on "fresh" sees their side effects settled. A listener that throws is logged and never
propagates into the producer.

There is **no outbox and no replay across restarts**. A subscriber that needs at-least-once
semantics reads the table instead - which is cheap, because the table is the durable record. The
read side core ships: `listEvents(kinds, since, limit)`, `dailyKindCounts(kinds)` (events per UTC
day, ascending, days with no events absent - callers zero-fill), and `subjectActivity(kinds, since)`
(per-subject counts plus a representative latest row).

**A listener that starts work must not await it.** `recordEvent` is often called from inside a
funnel run (a pull, a publish), and the funnel has one slot: a listener that awaited a second funnel
run would wait on that slot forever. Queue the work and return, as the automation dispatcher does.

**Event chain depth.** Work that an event started can record events of its own. Run that work
inside `withEventDepth(depth, work)` and every event recorded inside it gets `fields.depth` (unless
the producer set one); `eventDepth(event)` reads it back, 0 when absent. The automation recipe's
event triggers use it to stop a loop of triggers at their max depth. The depth travels in an
`AsyncLocalStorage`, so a long-lived timer armed inside a chain would inherit it: arm those inside
`outsideEventChain(...)`. Events an agent records through Box MCP tool calls carry no depth (the
call does not say which run made it). `recentEventKinds(since)` lists the kinds recorded since a
time, most frequent first.

**Why reacting to events is a subscriber and not part of the spine.** The spine is core; triggers
and alerting are features. `automation`'s event dispatcher registers one `onEvent` listener that
matches event triggers (deliveries among them, through the alerts powerup's runner), and core does not know it
exists. That split is what lets a Box run with `automation` or its alerts powerup removed and still have
content publishing, the run funnel and every other producer emit normally: the events are recorded,
nothing reacts. Fold the policy into `recordEvent` and the spine grows a dependency on a feature,
which is the one thing the seam forbids (`docs/core/SEAM.md` § 1). It also keeps
the spine honest about what it guarantees: durability and idempotency, not delivery.

## `changes.ts` is not `events.ts`

Two seams, different jobs. Do not blur them.

| | `changes.ts` | `events.ts` |
|---|---|---|
| Question | "reload your view" | "this happened in the domain" |
| Payload | a scope string, never row data | a typed record with fields |
| Durability | none, in-memory, resets on restart | a warehouse table |
| Delivery | fire-and-forget to subscribed tabs | idempotent insert, then in-process fan-out |
| Consumers | the SPA's data stores | event triggers (deliveries included), pod automation, digests, derived signals |

[`changes.ts`](../packages/core/src/changes.ts) is the **UI-invalidation** bus. A write path emits a
scope (`table:<name>`, `docs:<section>`, `config:<file>`); the server's
`changesFeed` tRPC subscription fans it out over each tab's live-feed WebSocket; clients map scopes onto their stores and
reload. Events carry **no payloads and no row data**; still, a scope says where activity happens,
so the feed delivers each one only to principals who read its area ([SERVER.md](SERVER.md), "Changes
and events"). A write to a shared core table records the owning areas of the rows it touched
(`emitAreaChange`) for that. `emitChange` never throws: a bad subscriber cannot break a write.

Two producers feed it:

- **precise and immediate** - the record layer (`upsertRecord`, `deleteRecord`) and the signal write
  helpers in `signals/write.ts` and `signals/points.ts`, per table, for every in-process write. The web UI, MCP tools, REST and cron
  all funnel through the one server process, so this covers nearly everything.
- **coarse and watched** - the server's recursive fs watcher on the instance dir
  (`apps/server/src/changes/changes.watcher.ts`) for OUT-of-process file edits: an agent session
  editing markdown under `docs/`, a human in an editor changing `config/`.

Writes made outside the Box (`psql` as `box_owner`) raise no change event: tabs show them after
their next reload.

The first event of every subscription is a `hello` carrying the process boot id. A client that sees
a **second** hello (reconnect, server restart) knows events may have been missed and reloads
everything rather than replaying. A `ping` every 45s keeps idle connections from being reaped.

## Backup, restore points and dev seeds

The database is gitignored and is the ground truth, so a restore point is what stands between a
team and a bad migration. Backup is **core**, **local first** and **reachable on a Box with zero
features installed**, because a bare Box still has a database an agent can restructure.

A restore point is a directory holding three files:

| File | What it is |
|---|---|
| `box.dump` | `pg_dump -Fc` of the Box database |
| `agents.json` | the agent files (`data/config/agents/*.md`) as they were when the snapshot was taken |
| `manifest.json` | written last: source cluster, engine and exact build, client tool version, SHA-256 of the other two, the migration ledger, roles and role logins, a content digest of every table and the sequence values, the system principal |

A restore point covers **the database and the agent files only** (chat's rows included). Chat's uploads and the artifact trees are files with their
own backups (their recipes' INSTALL.md); a copy of the whole Box is a Builder backup
([BUILDER.md](BUILDER.md)). Two directories hold restore points, and the difference is who owns
them:

| | who writes it | pruned? |
|---|---|---|
| `data/backups/db/` | the machine: `manual`, `pre-migrate`, `pre-restore`, `pre-switch` | yes, generationally |
| `data/seeds/` | you: `box db snapshot [name]` (an existing seed is replaced only once the new one is complete) | never |

### The commands

```bash
box db backup                           # a restore point in backups/db/ (+ the bucket when configured)
box db list                             # every restore point: name, label, size, time
box db snapshot [name]                  # a seed in seeds/<name>/ you own (default: baseline)
box db restore <name>                   # Box stopped: restore one into a fresh cluster
box db switch --engine <pgrust|native>  # Box stopped: move the database to the other engine
box db clusters                         # the cluster directories: active, retired, unused
box db prune                            # Box stopped: delete stopped clusters other than the active one
```

`box db seeds` is an alias for `list`. A backup and a snapshot run **online**: the running Box keeps
serving. Restore, switch and prune are **offline maintenance**: they refuse while Box runs.

### Consistency: one snapshot for the dump and the manifest

`box db backup` opens one owner session, takes the schema lock in shared mode (no migration runs
during the dump), takes the agents lock, starts a repeatable-read transaction and exports its
snapshot. It reads the agent files, releases the agents lock, reads the sequence values, and runs
`pg_dump --snapshot` on that snapshot while it reads the manifest's ledger, roles and table digests
on the same one. Sequences are not transactional, so their values are read before the dump starts:
the dump's are then never below the manifest's. So the dump and the manifest describe the same instant, and the agent files are never read halfway
through an agent change made through the Box (creating an agent and `box auth replace` take the
agents lock). The agent files are the agents' authority: boot reconciliation derives the users rows
from them before work is admitted, so a restored Box always serves a consistent set.

A backup refuses while an agent replacement is incomplete (`data/config/agent-replace.json`
exists); re-running the same `box auth replace` completes it. The client tools (`pg_dump`,
`pg_restore`) come from the host, both from the same installation and at least as new as the
server's major version; a backup without them fails with the install command.

### Restore

`box db restore <name>` never modifies the active cluster. In order:

1. **Validate** the restore point in full: the manifest's format, both SHA-256s, the agent files'
   format, the dump's table of contents, the tool and engine versions (no restore into an older
   major), and that the system principal and its identity lock are the live ones. A restore point taken before a
   `box auth replace` of the system principal is refused: restore the whole Box from a Builder
   backup taken before the replacement instead.
2. **Park** the active cluster as a `pre-restore` restore point, started under a maintenance HBA
   that admits no runtime login.
3. **Build** a fresh cluster (`data/db/<engine>-<n>/`) with the configured engine, provision the
   cluster roles the dump's grants name, and `pg_restore` into it in one transaction. Derived,
   engine-specific indexes are left out and rebuilt for the target.
4. **Compare** the restored database with the manifest before anything migrates: the ledger, every
   table's content digest, roles and role logins; sequences may be ahead, never behind.
5. **Prepare**: pending migrations run forward, role logins are reconciled with the restored roles,
   the catalog check runs, and the cluster's own authentication files are checked.
6. **Admit**: the agent files are staged beside the live ones, and each must parse, name a role the
   restored database has and not name a person; the configured system agent's role must exist too.
   Any problem in steps 4 to 6 refuses the restore and deletes the new cluster; nothing live changed.
7. **Commit** under the operation journal `data/db/switch.json`: the staged files are flushed to disk,
   the agent files are swapped in and `active.json` names the new cluster; only then are the parked
   previous files removed. The previous cluster is **retired**, kept stopped for rollback until the
   next retirement; `box db prune` deletes it on request.

Every step that changes something is journaled first and written durably (fsync of the file and its
directory). A process that dies mid-restore is settled at the next start, before anything else
reads the active record: `active.json` already names the new cluster for this operation, so the
commit finishes forward; or it still names the old one, so the new cluster is discarded and the
agent files go back. Anything else refuses with the journal's path. If the rollback itself fails,
the journal stays and the next start retries it; nothing the journal names may be deleted by hand.
While a restore, switch or prune runs, `data/db/maintenance.lock` makes every other open refuse, and
a server a dead maintenance run left running (under the maintenance HBA) is restarted, never adopted.

A restore always puts the restore point's agent files back with its database: the two were taken
together and boot derives the agent rows from the files. To recover agent files alone, read them
from the restore point's `agents.json` (a JSON object of file name to content) and write the ones
you need into `data/config/agents/` with Box stopped; the next start reconciles them.

`box db switch --engine <e>` is the same workflow with the live cluster as its source: it takes a
`pre-switch` restore point, restores it into a fresh cluster of the other engine, and updates
`database.engine` in the configuration file that sets it, under the same journal.

Indexes named `derived_*` are engine-specific and optional (a feature's HNSW index on native
PostgreSQL): a restore or switch leaves them out, and the feature's baseline builds them again on
the next boot where the engine supports them.

### Retention: generational, and only in `backups/db/`

Decided per label, measured back from now. A restore point is kept when any rule holds:

1. it is younger than 24 hours;
2. it is younger than 7 days and the newest of its UTC calendar day;
3. it is younger than 28 days and the newest of its ISO week;
4. it is the newest of its label, whatever its age.

Everything else in `backups/db/` is deleted. Retention never removes a restore point the operation
journal names or a live process is uploading (`.upload-<name>.json`, stale after the six-hour
upload limit), a seed, or a damaged directory (one without a valid manifest: listed as damaged, left
for you to inspect). Its own abandoned `.staging-<id>` directories are swept after a day. Retention
runs after each successful backup and restore; a failure is logged, never raised.

### Automatic pre-migration restore points

At boot, before the schema runner changes anything, it plans: when an existing database has pending
migrations, a feature area without its schema, or models or baseline DDL that differ from those last
applied (`core.schema_contract` holds their fingerprint), it takes a `pre-migrate` restore point first,
while holding the migration lock. A failed dump fails the boot with its reason. Fresh databases get
none. A pre-migrate point covers the database only: migrations may not touch files or other stores.

### The MCP and tRPC surface

`warehouse-backup` (core action), `WarehouseBackup` and `WarehouseRestorePoints` (MCP and tRPC, admin)
take and list restore points. Restore, switch and prune are host commands only, run by someone who
can see the machine, with Box stopped.

### The optional remote copy

With `backup.gcsBucket` set in `box.json`, each `box db backup` also uploads its restore point to the
private bucket as an immutable set, the manifest last, then moves a pointer:

| Object | Holds |
|---|---|
| `db/restore-points/<name>/box.dump`, `agents.json`, `manifest.json` | one restore point, never overwritten |
| `db/latest.json` | `{"restorePoint": "<name>"}`, the newest uploaded |

To restore from the bucket, copy one restore point's three files into `data/backups/db/<name>/` and
run `box db restore <name>` with Box stopped:

```bash
gsutil cp 'gs://<bucket>/db/restore-points/<name>/*' data/backups/db/<name>/
box db restore <name>
```

Create the bucket private, with objectAdmin for the active gcloud identity, and a lifecycle rule
that deletes restore points after the retention you want. Auth is the ambient gcloud credential,
never a key in the database. `assertGcsBucketReachable` fails fast with the `gsutil mb` recipe; an
upload failure after a successful local restore point raises an error that names the local path.
The reachability check runs before the dump, so an unreachable configured bucket stops
`box db backup` from taking a restore point at all.

"Verified" for a backup means structural: the dump's checksum and table of contents. Restoring is
the real proof; rehearse restores on a scratch checkout.

**A restore point inherits the sensitivity of whatever features are installed.** With `crm` present
it holds names, emails and correspondence, so the bucket's access list is part of the privacy
surface. Keep the bucket private, and treat `data/backups/` and `data/seeds/` on the host the same way.

## How a feature adds a table

Three edits inside the feature's own directory, then one command.

1. **Declare the ModelSpec** with `defineModel` in `features/<id>/core/models.ts`, export it in
   the feature's model array, and keep the feature's database type beside it
   (`export type CrmDb = ModelDb<typeof CRM_MODELS>`; `core/db.ts` holds `featureDb<CrmDb>()`).
2. **List it in the manifest** (`manifest.ts`), which is the only thing `schema.ts` reads:

   ```ts
   import { defineCoreFeature } from '@silkweave/box-core/feature'
   import { CRM_MODELS } from './models.js'

   export default defineCoreFeature({
     id: 'crm',
     models: CRM_MODELS,
     migrations: [],
   })
   ```

   A feature that needs views or indexes adds `baseline`, a list of idempotent DDL statements
   (`CREATE OR REPLACE VIEW ...`, `CREATE INDEX IF NOT EXISTS ...`).

   `id` is the directory name and **the migration ledger namespace, so it is never renamed**.
   `dependsOn` must cover every `../<feature>/` import in the directory. `baseline` is idempotent
   DDL re-run on every boot; a view over a *dependency's* table needs that dependency declared, or
   the enabled-later pass of `schema:check` will say so.
   A table whose rows are access policy (who reads a destination an agent writes to: chat's rooms,
   room members and agent seats) sets `policyTable: true`. Migrate then grants `box_policy` usage
   on the area schema and select, insert, update and delete on the table beside the area's groups,
   and the catalog check expects exactly those grants, so a membership change commits in the same
   transaction as the role and user-role changes it is judged with (docs/AUTH.md "Agents and
   coverage"). `box_policy` reads such rows for names and labels in previews too.
3. **Append a migration** if existing Boxes need the change - a new table does not need one (the
   baseline creates it), a new column on an existing table does.
4. **`box verify`** includes **`bun run schema:check`**. After adding or removing a feature,
   first update the maintained feature registration and exports.

### The policy journal

`core.policy_journal` (created with the database objects, written by `box_policy` only) makes a
policy change that also rewrites files crash-safe: an agent's role (its file in
`data/config/agents/`) and a toolset (its entry in `box.local.json`). The policy service closes
the policy gate, commits the coverage check, the database part and a `prepared` row in one
transaction, ends the live sessions of the changed agents and toolsets, writes the files, and
marks the row `done` with the agent's role row in a second transaction. A failed write restores
the files and marks it `rolled-back`. At boot, before agent principals are reconciled, an
unfinished row is rolled forward when the files are as before or after the change, rolled back
when an agent's target role no longer exists, and marked `abandoned` when the files were changed
by hand. While a row is `prepared`, every other policy change is refused.

## Querying it directly

Agents query through the Box's own tools (MCP, tRPC), which run as the caller and see what the
caller's role reads. For a look from the host shell, connect as `box_owner` over the cluster's
socket while the Box runs, from the Box's OS account (peer authentication; no password exists).
The server listens only on a Unix socket, always port 5432, in the active cluster's `run/`
directory, or in `/tmp/box-<hash>` (the first 12 hex digits of the SHA-256 of the cluster
directory's absolute path) when that path is too long for a socket. From the checkout root:

```bash
C="$(pwd -P)/data/db/$(bun -e 'console.log(JSON.parse(await Bun.file("data/db/active.json").text()).cluster)')"
S="$C/run"; [ -S "$S/.s.PGSQL.5432" ] || S="/tmp/box-$(printf %s "$C" | shasum -a 256 | cut -c1-12)"
psql -h "$S" -p 5432 -U box_owner box \
  -c "begin read only" -c "select name, applied_at from core.schema_migrations order by 1" -c "commit"
```

`box_owner` bypasses every area check and row security, so keep such sessions read-only: a write
made there skips the record layer's validation and audit stamps, raises no change event, and is
not detected afterwards (the catalog check covers the security contract, not data).

## Owning areas and row security

Core's shared tables carry the area that owns each row (PERMISSIONS.md 8.1 to 8.3), declared by the
writer and never guessed from free strings ([`auth/owning-area.ts`](../packages/core/src/auth/owning-area.ts)):

| Table | Column | Set from |
| --- | --- | --- |
| `signals` | `area` | a Box tracker's feature (key prefix), `signals` for a data-source binding, else the caller's `area` (a goal's own signal: `planning`), else the stored one; `signals` for a new manual or formula signal |
| `signal_points` | `area` | its signal's `area`, read from the signal row; a foreign key on (`signal_id`, `area`) keeps it equal, cascading a rebind, a rename and a delete |
| `snapshots` | `area` | the writer: `signals` for a provider sync, the feature for its own pulls |
| `automation_runs` | `area` | `actionOwner(action)`: the declaring feature, `ops` for core actions (or a core action's declared area), `automation` for agent jobs; an agent job's run also records `acts_as`, the principal it acted as |
| `events` | `areas` | the producer (above) |

An area is an installed feature id, `signals`, `ops`, or the pseudo-area `admin` for rows nothing
classifies, readable only with admin authority. The row writers take the writer's area
(`replaceChannelSignals(channel, rows, area)`, `upsertBackfillSignals(rows, area)`,
`upsertSnapshot(channel, date, payload, area)`, `autoRegisterDefinitions(rows, area)`).

Row security on those five tables backs the accessors' own checks
([`warehouse/pg/rls.ts`](../packages/core/src/warehouse/pg/rls.ts)). The executor sets
`box.read_areas` and `box.write_areas` for every transaction (an admin's lists include `admin`);
box_core's policies are per command: SELECT needs the row's area readable, INSERT the new row's
writable, UPDATE both the old and the new row writable (moving a row out of or into an unreachable
area is refused), DELETE the row writable. An event needs every area it names; box_core cannot
update or delete events. A point carries its signal's area under the foreign key, so a point
cannot name another area than its signal; the catalog check verifies that key (validated,
enforced, cascading, with its referenced unique key) before runtime admission, since row security
on points relies on it. box_system has its own explicit policies. A missing or empty setting denies. The
catalog check compares every policy with this contract text for text, so an extra or edited policy
fails boot. Boot installs row security on a table only once: `core.row_security_ledger` records
each installed table, and a recorded table found without row security or policies refuses boot
like any other drift.

RLS is a backstop, not isolation from hostile SQL: box_core can only run the executor's classified
statements, but a statement that forged the area settings would pass. The accessors decide; the
policies make a forgotten filter fail closed.

Events: `listEvents` returns only events whose every area the caller can read, and the aggregate
reads (`recentEventKinds`, `dailyKindCounts`, `subjectActivity`) count only those (row security).
A caller that summarizes events into a shared output (a derived signal such as `x.engagement`, the
traction detector, the daily digest) reads them as named system work after its own admission, so
one person's view never becomes everyone's result; a summary event carries the areas of what it
counted (`SubjectActivity.areas`). Data sources belong to `signals`: `readDataSources` and
`readDataSource` return none without signals read.

Runs: `readRuns` and `readRun` return what row security lets through, and an agent job's run only
to a reader who covers its `acts_as` principal (`auth/covers.ts`: every area at least the agent's
level, admin for an admin agent; connection audiences are not part of this check).
Reader and agent are judged at one policy generation: the agent's role is read at the reader's
access generation, the read is retried when the policy moves meanwhile, and an agent whose role
that generation does not define (or who no longer resolves) is read by admins only. `readRuns`
applies its limit after coverage: the covered agents are judged first and filter the page in SQL,
so runs the reader does not cover never crowd out its own. An agent
trigger's skip rows record `acts_as` too. `listAutomationActions` lists the actions whose area the
caller can read. A request run (`executeRecorded`, so Run Now and the backup handlers alike) needs
write on the action's area before its row is written and again, admitted against the committed
policy, after its queue wait; the runner then runs in the caller's frame. The run's own
bookkeeping (running, log flushes, the outcome) is system work on its row, so a run whose caller
lost access still settles. Live tails (`opsRunTail`, `startDetachedRun().tail()`) check
`canFollowRun` before every delivery, buffered lines and the final error included: one admitted
read of the run's row, so a revoke committed by another process ends the tail before this process
hears of it.

Point writers run on the caller's own login (`pointWrite` in `signals/write.ts`): write on each
signal's area is checked, the signals are locked through row security (FOR SHARE), and every point
takes its signal row's area. A rebind or delete of a signal waits for a point write in progress,
then carries or removes its points. Writes that must reach rows in areas the caller cannot (a rename re-pointing
other areas' formulas and `depends_on` edges, a delete pruning them) are core commands
([`warehouse/core-command.ts`](../packages/core/src/warehouse/core-command.ts)):
`coreCommand(reason, authorize, fn)` authorizes in the request, then runs fixed SQL in one
box_system transaction that carries the requester. Admission compares the committed policy
revision with the requester's access generation too, so a policy change committed after the check
re-resolves the requester and runs `authorize` again before any privileged statement. The
generation carried is the one `authorize` checked: when a read inside `authorize` re-resolved the
frame, it runs again. A core command inside another one is refused. `coreRead(reason, authorize,
fn)` is the read form (one read-only box_system transaction, bound to the requester the same way):
`authorize` admits the frame and captures the access the read filters by.

Presets (`presets/presets.ts`, a file, not a table) belong to the feature declaring the module:
listing shows readable modules only, reading a module needs read and changing it needs write. A
reader's `initial` seed of a module nobody seeded yet returns the list unchanged; the first writer
seeds it.

Boards: a board is the boards area's, the objects on it their own areas'. A board node kind may
declare `area` (planning's goal and initiative: `planning`); a caller without read on it never runs
the kind's functions. A placement the caller cannot read (an unreadable area kind, or a ref the
kind's filtered `exists` leaves out, or for anyone but an admin a kind that is not installed) is
served with `hidden: true`, no card and no links, and its ref replaced by a token (an HMAC of
board, kind and ref under the session secret), in the board view and in the board list. A hidden
placement round-trips only through its token: a save maps tokens back and keeps hidden placements
it left out, and a raw ref is judged like any new placement (the caller must read it), whether or
not it is on the board. The save writes only if the row still holds the placements it judged
(locked), otherwise it judges again. Edges, neighbours and candidates leave out what the caller
cannot read.

## Where the signal writers live

`snapshots` and `signal_points` are core tables, and their writers live with them in
[`packages/core/src/signals/`](../packages/core/src/signals/): `upsertSnapshot`,
`replaceChannelSignals`, `replaceSignalRows` and `upsertBackfillSignals` in `write.ts` (each takes
the writing feature's area), and the
manual, windowed-sync and increment writers in `points.ts` ([SIGNALS.md](SIGNALS.md#the-point-store)).
Features write signal history through those helpers, never with their own SQL. If you find yourself
adding a writer to `warehouse/db.ts` for a table it does not own, put it with the table's owner
instead.

A **Box tracker** (`registerTracker`, `signals/trackers.ts`) is the way a feature turns its own
rows into a signal without writing points itself: a signal binds it with `tracker_key` and
`tracker_params` (`signals.tracker_params`, core migrations `011-signals-measure-params` and `014-signals-tracker-params`), and
`signals/tracker-derive.ts` replaces that signal's `live` points with what the tracker computes, on
a bind, when a change scope it `watches` changes, and in `warehouse-derive`
([SIGNALS.md](SIGNALS.md#box-trackers)).
