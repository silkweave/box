# The warehouse - core's data layer

One **DuckDB** file is the ground truth for everything a Box stores as rows. DuckDB is an embedded,
columnar OLAP engine: no server, no daemon, one file. There is no JSON source, no seed and no
rebuild step - writes UPSERT straight into it.

- **Engine:** DuckDB via `@duckdb/node-api`, wrapped by
  [`packages/core/src/warehouse/db.ts`](../packages/core/src/warehouse/db.ts).
- **File:** `data/data.db`, resolved by `warehousePath()` in
  [`packages/core/src/io.ts`](../packages/core/src/io.ts). The instance dir (`data/`) contains the
  warehouse and runtime files; root `box.json` contains configuration. It is always
  `<checkout>/data`; no environment variable moves it, so a second
  tenant or a scratch Box is a second checkout. **Gitignored** - the durable copy is the GCS backup
  below, never git.
- **Ownership:** core owns the engine, the record layer, the schema lifecycle and ten tables,
  declared in [`warehouse/core-models.ts`](../packages/core/src/warehouse/core-models.ts)
  (`CORE_MODELS`): `users`, `kv_state`, `events` and `automation_runs`, the signal tables
  `signals`, `signal_points`, `snapshots`, `data_sources` and `signal_boards`
  ([`signals/models.ts`](../packages/core/src/signals/models.ts)), and the currency rates table
  `fx_rates` ([`fx/rates.ts`](../packages/core/src/fx/rates.ts)), all described in
  [SIGNALS.md](SIGNALS.md). Every other table belongs to a feature and is documented in the recipe
  it came from, `recipes/<id>/SPEC.md`. A Box with no features installed has exactly those ten.

This document is core's half. For what a feature's table means, read its feature's SPEC.

## Concurrency: single writer, ephemeral connections

DuckDB is single-writer **across processes**: one read-write handle OR many read-only ones. The
access layer therefore keeps every connection **ephemeral** - open, do one operation, close - so
the file is unlocked between operations and a second process (a read-only MCP server, the `duckdb`
CLI, a one-off script) is never shut out for longer than one statement:

- **`withRead(sql, values)`** opens `access_mode: 'read_only'`, runs the query, returns JSON-safe
  row objects (`getRowObjectsJson()`: no bigints, no `Date`s), and closes.
- **`withWrite(fn)`** opens `access_mode: 'read_write'`, hands `fn` the connection, and closes.
  Writes are **serialized in-process** by chaining every call onto a single promise, so this process
  never opens two read-write instances at once. The chain survives a rejected write.
- **Both retry on a lock conflict**: up to 12 attempts with exponential backoff capped at 1.5s,
  triggered by DuckDB's IO error text (`lock` / `conflicting` / `being used by another`). In-process
  serialization plus cross-process retry is enough because everything funnels through the one
  server process and the operations are tiny.
- **Every connection pins `SET TimeZone = 'UTC'`** on open. This is load-bearing; see the timestamp
  convention below.

`withWrite` also stamps the change bus (`markWarehouseWrite()`) on settle, success or failure, so
the server's file watcher can tell its own write's echo from an external one. A failed write still
touches the lock and the WAL, so stamping only on success would surface phantom external changes.

## The record layer

Every table is described **once** as a `ModelSpec`. From that one description,
[`warehouse/model.ts`](../packages/core/src/warehouse/model.ts) derives all the plumbing that used
to be hand-rolled per entity (a Row interface, a CAST column list, a `toX()` mapper, a
read-previous-then-merge upsert):

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

`ColumnKind` is `text | int | bigint | float | json | timestamp | date`. A column is **NOT NULL unless
declared `nullable`** (PK columns always are). `default` is emitted verbatim into the DDL, so quote
string literals yourself (`default: "'draft'"`).

What the layer derives:

- **`createTableSql(m)`** - the `CREATE TABLE IF NOT EXISTS` baseline DDL.
- **`modelColumns(m)`** - the declared columns plus the managed ones: `timestamps: true` adds
  `created_at` / `updated_at`, `audit: true` adds `created_by` / `updated_by`.
- **`selectCols(m)`** - the SELECT list, with JSON and TIMESTAMP columns `CAST(... AS VARCHAR)` so
  a read is always JSON-safe strings.
- **`rowToRecord(m, row)`** - the row to domain mapping: JSON parsed (a malformed value falls back
  to `null` rather than throwing a read), timestamps re-attached a `Z`, ints and floats `Number`-ed.
- **`validateEnums(m, values)`** - the **app-level CHECK constraint**. DuckDB enforces none here, so
  this is the only gate. `enum` may be a thunk when the allowed list is tenant configuration rather
  than code, so the gate reads what the team's list says at write time instead of what it said at
  import time.
- **`upsertRecord(m, input)`** - the partial UPSERT (below).
- **`readRecords` / `readRecord` / `deleteRecord`** - the rest of the CRUD.

Domain semantics stay in the domain modules on top: create-defaults, cascade deletes, slug re-keys,
derive hooks, deep merges. This layer only owns the mechanical plumbing.

### Timestamps are naive UTC, and SQL `now()` is the trap

DuckDB's `TIMESTAMP` is timezone-naive and a CAST **silently drops** a string's offset. One
convention settles it: **a naive value in the file IS UTC.** Writes normalize any ISO offset to
naive UTC (`toNaiveUtc`), reads re-attach the `Z` (`fromNaiveUtc`).

The convention has one enemy: **SQL `now()` returns the session's local wall time**, and on a host
that is not UTC that writes local timestamps into columns everything else reads as UTC. Two
defences, both live:

1. Every connection runs `SET TimeZone = 'UTC'` before anything else, so a `now()` or
   `current_date` that does survive is UTC-correct, on reads too.
2. **A raw write stamps its own time** rather than reaching for `now()` - `events.ts` computes
   `toNaiveUtc(new Date().toISOString())`. A `default: 'now()'` in a ModelSpec is fine (the session
   is pinned before the DDL runs), but hand-written SQL should not add new ones.

`sameRecord(m, prev, next)` compares a candidate write against the stored row over the **declared**
columns only (managed timestamps and audit excluded), each at the precision the table stores it:
JSON by content rather than key order (`stableJson` sorts keys at every level), timestamps at whole
seconds (a DuckDB TIMESTAMP write drops milliseconds, so an ISO input ending `.123Z` must not read
as a change against its own stored value), numbers as numbers. It exists for the machine writers: a
nightly sync re-asserting unchanged data must NOT write, because an upsert always restamps
`updated_at` / `updated_by`, and a human's decision stamped over by "the agent, last night" every
night is an audit trail that says nothing.

### The partial upsert and the audit stamp

`upsertRecord` reads the previous row (or takes it via `opts.prev` when the caller already read it
for its own merge decisions), merges, validates, stamps, writes one
`INSERT ... ON CONFLICT DO UPDATE`, and returns the re-read row. The merge rule: **an input key wins,
including an explicit `null`; an absent key keeps the previous value**, falling to the column
default only when there is no previous row. A domain module that needs a non-shallow merge resolves
it *before* calling.

`created_at` and `created_by` are excluded from the conflict UPDATE list, so they are set once and
are unrewritable through the tool surface. `actor` on the input becomes `updated_by` (and
`created_by` on insert); a blank or whitespace actor is treated as "nobody said" and stamped NULL,
because `''` would be a third value beside a real id and NULL that nothing downstream
distinguishes. Because `created_by` is permanent, the actor is validated here rather than per
domain module: `assertKnownActor(actor)` requires it to name an existing `users.id` (see
[`docs/AUTH.md`](./AUTH.md)).

Every write path emits `emitChange('table:<name>')` on commit - see the changes seam below.

## Applying the schema

[`warehouse/schema.ts`](../packages/core/src/warehouse/schema.ts) owns the lifecycle, and it has no
global list of anything. It iterates the **ordered feature registry**.

`applySchema(conn, features)`, in order:

1. Evaluate migration statements once and inspect the existing ledger. Refuse a changed checksum
   or a missing migration for an installed feature before baseline DDL or pending migrations run.
2. If an existing warehouse has pending migrations, `ensureSchema` takes a pre-migration snapshot
   while holding its write connection. An empty new warehouse needs no snapshot.
3. Create or extend `schema_migrations (name, feature, applied_at, checksum)`, PK `name`. Backfill
   NULL checksums for migrations present in the current code, without rerunning them.
4. Create current ModelSpec tables with `CREATE TABLE IF NOT EXISTS`, then apply baseline DDL
   (views/indexes) in feature order.
5. Execute pending migrations, each atomically with its ledger row and checksum.

`ensureSchema()` is the boot entry point. It runs this inside `withWrite`, including the snapshot,
so the checkpoint and file copy retain the same writer lock. Concurrent callers share its promise;
a failed attempt clears it for retry. Direct `applySchema` callers such as tests must supply a
snapshot callback if they need a filesystem snapshot.

### Ordering

`orderFeatures(features)` returns **core first, then features in dependency order, ties broken by
id**. Deterministic ordering is the point: two Boxes with the same directories apply the same
sequence, whatever order the generated registry happened to list them in (there is a unit test for
exactly that, `warehouse/schema.test.ts`). It throws on a cycle, naming the trail, and on a
`dependsOn` that names a feature which is not present.

`assertOwnership` then refuses two features declaring the same table, and a duplicate migration name
within one feature (the ledger key would collide).

The **only** cross-feature guarantee is that a dependency's tables and migrations are complete
before a dependent's migration runs. Two features' `001`s have no relationship to each other.

### The migration ledger

Each feature owns an **append-only list starting at its own `001`**, and each entry is recorded in
`schema_migrations` as `<feature>:<name>` - `crm:001-deal-shape`. The author writes
`name: '001-deal-shape'`; the runner adds the prefix. The `feature` column exists so removal and
purge can reason per feature.

```ts
export interface Migration {
  name: string                                       // 'NNN-slug' by convention
  statements?: string[] | (() => string[])           // a factory when they are machine-dependent
  run?: (conn: MigrationConn) => Promise<void>       // when a decision depends on what is stored
}
```

Rules that hold the whole thing together:

- **The ledger travels inside the `.db` file**, so a restored older backup upgrades itself on its
  first boot. That is the entire durability story for schema state.
- **Each migration commits atomically with its ledger row** (`BEGIN`, statements, `run()`, the
  ledger INSERT, `COMMIT`; `ROLLBACK` and a wrapped error otherwise). A crash mid-migration re-runs
  it whole, never half-applied. Statements should still use `IF EXISTS` forms so a re-run is safe.
- **A migration name is an immutable ledger key.** A migration is born with the vocabulary of its
  day and never renames.
- **Never edit or reorder a migration that has shipped.** Adding a column means *both*: extend the
  ModelSpec (fresh Boxes get it from CREATE) AND append a migration with the ALTER (existing Boxes
  get it once).
- **Static migration SQL names only its own feature's tables**, for reads as well as writes.
  Cross-feature reads belong inside `run`, through a declared dependency's exported reader, so
  a skipped version does not replay SQL against a dependency's obsolete column names.
  `schema:check` warns on common table references; complex SQL and hooks still need review.
  A table the feature once owned and its migrations now drop or reshape (a retired model, a
  renamed table) goes in the feature's `retiredTables`: never baselined, but counted as its own
  by the ownership check, so `DROP TABLE old_name` is not read as a cross-feature write.
- **`ensureSchema` refuses a ledger row with no feature prefix**, with "this is not a Box
  warehouse". The original app's unprefixed ledger is deliberately unsupported.
- **One table-altering statement per migration.** DuckDB is happiest that way, and it is the rule
  both `schema.ts` and `core-migrations.ts` state in their own comments. The failure to watch for is
  at COMMIT: `Attempting to modify table <t> but another transaction has altered this table`. Since
  a migration IS a transaction and `ensureSchema` runs at boot, that failure is a boot failure. A
  migration that both changes a table's shape and rewrites its rows can be two migrations, and on a
  data-touching one that is the safer shape anyway, because it can then be proved separately.
- **An ALTER cannot carry a constraint.** DuckDB answers "Adding columns with constraints not yet
  supported", so a column added by migration is NULLABLE on an upgraded Box where a fresh one gets
  NOT NULL from CREATE. The two must agree in *behaviour*: `core:001-users-role` gets away with it
  because every read narrows through `roleOf()`, which maps anything that is not exactly `admin` -
  NULL included - to `member`.

**Checksums cover the migration name, evaluated SQL and a hash of `run.toString()` when present.**
An edited or removed applied migration refuses boot while its feature is installed. Ledger rows
for removed features stay untouched. Legacy NULL checksums are backfilled from current code:
this cannot detect an edit that happened before checksum protection was installed. Hook hashes
are sensitive to compilation/formatting and do not capture changes in imported helpers or closure
values. Keep the runtime toolchain consistent and review hook dependencies. SQL factories must
produce stable statements across machines and boots.

Each feature documents its own migrations. Chat's SQLite migrations are separate and are not
covered by the DuckDB backups or pre-migration snapshots.

## `bun run schema:check`

Run `bun run schema:check` after changing a model, baseline or migration. It uses throwaway databases
under a temp directory and writes nothing to the tree.

```bash
bun run schema:check
```

It proves three things:

1. **Fresh + reboot.** Apply the current schema twice on one file; every declared table must exist.
2. **Enabled later.** For each feature, create a database without it and its dependents, then enable
   the whole set. This is the pass that catches an undeclared assumption about a neighbour's
   presence: a view or migration reaching for a table its feature never listed in `dependsOn` works
   on a full Box and fails on the Box that left that neighbour out. Unit tests cannot see this; it
   takes a real DuckDB file.
3. **Ownership,** as a **warning**. Static SQL that names a table the feature does not own is
   reported, not rejected. A team merging two integrated features into one vocabulary is doing exactly what
   the model invites. On the maintainer checkout, where apps are meant to stay separable, treat a
   warning as something to fix. It is a conservative heuristic, not a SQL parser.

It cannot prove a data migration against real rows; every table it creates starts empty. That is
what `box db backup` plus a rehearsal on a restored copy is for (see below), plus tests with rows
that match the migration's WHERE clause. See
[`roles.test.ts`](../packages/core/src/auth/roles.test.ts) and
[`schema-upgrade.test.ts`](../packages/core/src/warehouse/schema-upgrade.test.ts).

### What still refuses to boot

Two guards are about correctness rather than compliance, so they stayed in `applySchema` at runtime:

- an **applied migration missing from installed code**, while its feature is installed;
- an applied migration whose **checksum no longer matches** the code.

In both cases the code on disk no longer describes the database on disk, and continuing would apply
the rest of the schema on top of a state nobody can name. Neither is a style rule you can waive.

If you genuinely meant to rewrite history - squashing a Box's migrations into a new baseline, say -
the honest move is to say so to the database rather than to argue with the guard:

```bash
box db backup                      # first, always
# then either start the warehouse over:
rm data/data.db && box dev
# or drop the ledger rows you deliberately un-shipped, in a duckdb session, and reboot
```

Back up first, and read [the working rules](#working-rules-for-an-agent-changing-schema) below.

## Working rules for an agent changing schema

You are allowed to change this team's schema. That is the point of the product. These are the rules
that keep a change recoverable rather than the rules that keep it approved.

**Before you touch a migration, a model or a baseline:**

1. `box db backup`. It takes seconds, it is generationally retained, and it is the difference
   between a bad migration being an inconvenience and being an incident. The automatic
   pre-migration snapshot covers the moment the migration runs; it does not cover the half hour of
   experimenting before it.
2. `box db list` to see that the backup is actually there, with a plausible size.
3. Know whether the warehouse holds real data. On a Box with `crm` or `content` installed and in
   use, assume it does.

**Rehearsing a data migration.** The only rehearsal worth the name uses real rows:

```bash
box db backup                                   # on the Box with the real data
box db list                                      # copy the name

# in a SECOND CHECKOUT of the repo - its own data/, its own ports in its own box.local.json
git clone git@github.com:silkweave/box.git box-scratch && cd box-scratch && bun install
cp /path/to/real/box/data/backups/<name> data/backups/   # or fetch a version from the GCS copy
box db restore <name>
box dev                                         # watch the migration apply for real
```

A throwaway Box is a second checkout, because the instance directory is always `<checkout>/data`
and nothing in the environment redirects it. Never rehearse by pointing a second server at the real
data directory. DuckDB is single-writer, the
two will fight, and the one that wins is not the one you were watching.

**Verifying a restore.** A backup you have never restored is a hope. Once, on a throwaway Box:
restore it, boot, sign in, and look at a page that shows rows you recognise. `box db list` proves a
file exists; only a boot proves it is a database with your data in it.

**What never to do to a warehouse holding real data:**

- Never run a destructive migration, or any restore, without a backup taken in the same sitting.
- Never `rm data.db` to "fix" a schema error on a Box with real rows. The error is telling you the
  code and the database disagree; deleting the database resolves the disagreement in the worst
  possible direction.
- Never edit an applied migration in place. Append a new one. The checksum guard exists because the
  alternative is a database whose history is fiction.
- Never point two servers at one checkout's `data/`. A scratch Box gets its own checkout, and its
  own ports in that checkout's `box.local.json`.
- Never hand a `.duckdb` copy to anyone casually. With `crm` installed it holds names, emails and
  correspondence, and a backup inherits the sensitivity of everything installed.
- Never leave a restore that needed a restart un-restarted. `ensureSchema()` is memoized per
  process, so a long-lived server that already baselined will not migrate a restored older schema
  forward until you restart it.

## The events spine

[`packages/core/src/events.ts`](../packages/core/src/events.ts) is the **domain-integration** seam.
Every normalized domain event is recorded durably in `events` (PK `(kind, dedup_key)`) **before**
any policy looks at it.

```ts
const fresh = await recordEvent({ kind: 'content.published', dedup_key: pieceId, fields: { ... } })
```

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
| Delivery | fire-and-forget to SSE clients | idempotent insert, then in-process fan-out |
| Consumers | the SPA's data stores | event triggers (deliveries included), pod automation, digests, derived signals |

[`changes.ts`](../packages/core/src/changes.ts) is the **UI-invalidation** bus. A write path emits a
scope (`table:<name>`, `docs:<section>`, `config:<file>`, or the generic `warehouse`); the server's
`changesFeed` tRPC subscription fans it out over SSE; clients map scopes onto their stores and
reload. Events carry **no payloads and no row data**, which is why fanning them out to any
authenticated principal leaks nothing beyond "something in `<scope>` changed". `emitChange` never
throws: a bad subscriber cannot break a write.

Two producers feed it:

- **precise and immediate** - the record layer (`upsertRecord`, `deleteRecord`) and the signal write
  helpers in `signals/write.ts` and `signals/points.ts`, per table, for every in-process write. The web UI, MCP tools, REST and cron
  all funnel through the one server process, so this covers nearly everything.
- **coarse and watched** - the server's recursive fs watcher on the instance dir
  (`apps/server/src/changes/changes.watcher.ts`) for OUT-of-process edits: an agent session editing
  markdown, a human in an editor, an external DuckDB writer. `data.db*` events within 3s of
  `lastWarehouseWriteAt()` are the server's own echo and are skipped, so the precise `table:` event
  is not doubled by a generic `warehouse` one.

The first event of every subscription is a `hello` carrying the process boot id. A client that sees
a **second** hello (SSE reconnect, server restart) knows events may have been missed and reloads
everything rather than replaying. A `ping` every 45s keeps idle connections from being reaped.

## Backup, restore points and dev seeds

`data.db` is gitignored and is the ground truth, so a copy of it is the only thing standing between
a team and a bad migration. Backup is **core**, **local first** and **reachable on a Box with zero
features installed**, because a bare Box still has a warehouse an agent can restructure.

Two directories sit beside the warehouse, and the difference between them is who owns the files:

| | who writes it | pruned? |
|---|---|---|
| `data/backups/` | the machine: `manual`, `pre-migrate`, `pre-restore` | yes, generationally |
| `data/seeds/` | you: named dev fixtures | **never** |

### The commands

```bash
box db backup            # data.db -> backups/manual-<stamp>.db  (+ GCS when configured)
box db list             # every restore point: name, label, size, time
box db restore <name>    # restore one over data.db; the previous state is parked first
box db snapshot [name]   # data.db -> seeds/<name>.db, a fixture you own (default: baseline)
```

`box db backup | list | restore [name] | snapshot [name]` are the same four from anywhere on the
host. `box db seeds` is an alias for `list`.

**Agent files travel with the warehouse.** The users rows of the Box's agents and the files that
say which agents exist (`data/config/agents/<id>.md`, see [AUTH.md](AUTH.md)) belong together, so
every restore point the machine writes (`manual`, `pre-migrate`, `pre-restore`) and every
`box db snapshot` also writes `<name>.agents.json` beside the `.db`: the regular `.md` files by name,
marked `"format": "box-agent-files/1"`, written even when there are none. The agent files are read
under the same lock as the copy, and a backup whose sidecar cannot be written is removed, so a
restore point is published only as a pair. Retention removes the sidecar with its `.db`.

### Consistency: the copy happens inside the write lock

Every copy here runs `CHECKPOINT` and then copies **while the writer connection is still open**
([`copyWarehouseUnderLock`](../packages/core/src/warehouse/restore-points.ts)). That window is the
only one with no writer in it: connections are ephemeral (see the concurrency note in
`warehouse/db.ts`), so the instant `withWrite` returns, the next chained write or another process
may open the file. On `@duckdb/node-api` 1.5.4 a `CHECKPOINT` on a held read-write connection
deletes `data.db.wal` outright, and DuckDB has no background writer, so nothing touches the bytes
until the next statement. The copy's size is checked against the source, and
an empty source is refused: a backup that silently copied nothing is worse than an error.

The **WAL sidecar travels with the file** and a stale `<target>.wal` is removed first. A copied
`.db` beside a mismatched WAL is the worst failure shape a snapshot can have. It does not open
cleanly and silently wrong; it fails on open with "Failure while replaying WAL" and stays broken
until a human removes the sidecar.

### Restore

`box db restore <name>` takes a name from either directory and does five things in order:

1. **Stage.** Copy the restore point (and its WAL) to `data.db.restoring-<id>` beside the live file,
   open it read-write, `CHECKPOINT`, close. This proves the restore point is a database this DuckDB
   can open *before* anything live is touched, and folds away the WAL so the swap has no sidecar to
   sequence. Leftovers from a process that died here are swept by the next restore.
2. **Park.** Under the write lock, checkpoint and copy the live warehouse to
   `backups/pre-restore-<stamp>.db`, so a mistaken restore is itself one restore away.
3. **Swap.** Still under the lock, remove any `data.db.wal` and `rename()` the staged file over
   `data.db`. Same directory, so the rename is atomic: a process dying anywhere in this sequence
   leaves either the old checkpointed file or the new one, never a half-written warehouse.
4. **Agent files.** The sidecar is validated in full before step 1, and the restored
   `data/config/agents/` (its `.md` files plus the live directory's other files) is staged beside
   the live one. Under the lock, after parking (the park carries the current files), the staged
   directory replaces the live one, then the database is swapped; a failed database swap puts the
   previous files back. The file swap writes `config/agents.restore-in-progress.json` first and
   removes it once the database is in place, so a process that dies between the two leaves the
   marker (and the previous files in `config/agents.pre-restore-<id>/`), and the Box refuses to boot
   until you restore again or put the files back and delete the marker. A previous directory that
   cannot be removed after a successful restore is named in the summary and is safe to delete. A backup without a sidecar (taken before agent files
   were backed up, or interrupted) is refused unless `--keep-agent-files` says to keep the live
   files; a seed without one keeps them.
5. **Prove it.** Open the restored file read-only and count its tables, so a restore that does not
   open is an error now rather than a surprise on the next request.

Restoring a point whose schema is **older** than the running code is fine: `ensureSchema()` migrates
it forward. But that step is memoized per process (`schemaReady` in `warehouse/schema.ts`), so a
long-lived server that has already baselined will not re-run it until restarted. **Restart the
service after restoring an older point.** The returned summary says so too. A long-lived read-only
reader, such as the `warehouse` MCP server, also keeps the old inode until it reopens.

Restore is deliberately **not** an MCP tool or a tRPC mutation. It overwrites the running server's
own ground truth and then wants a restart, so it stays a host command where the person running it
can see the machine.

### Retention: generational, and only in `backups/`

[`planRetention`](../packages/core/src/warehouse/restore-points.ts) keeps, per label:

- every backup from the **last 24 hours**;
- the newest one per **UTC day** for the last 7 days;
- the newest one per **ISO week** for the last 4 weeks;
- and always the single newest, whatever its age.

Everything else in `backups/` is deleted, together with its WAL sidecar. Count-based retention was
rejected because five recent `pre-migrate` copies can all come from one agent session, which is
exactly when you want the state from before that session. Retention runs after a successful backup
and after a successful pre-migration snapshot, never during a restore (it could delete the very
point being restored from), and a prune failure is logged and swallowed: a full disk is a disk
problem, a blocked migration would be a data problem.

**Retention never touches `seeds/`.** Named fixtures are yours.

### Automatic pre-migration snapshots

Before applying pending migrations to an existing warehouse, `ensureSchema` writes
`backups/pre-migrate-<utc-stamp>-<id>.db` through the same copy-under-lock helper, holding the
migration's own writer connection across the checkpoint and copy. **A snapshot failure aborts the
migration**, before any schema change. Fresh empty warehouses and boots with no pending migration
take no snapshot, and neither do baseline-only changes.

### The MCP and tRPC surface

`warehouse-backup` is a **core action** (`ops/core-actions.ts`), so it is in every Box's registry,
runnable through `run-now` and recorded in `automation_runs`. Core also exposes it directly
(`apps/server/src/ops/warehouse.controller.ts`), admin-only:

| tRPC | MCP | what |
|---|---|---|
| `warehouseBackup` (mutation) | `WarehouseBackup` | take a backup now |
| `warehouseRestorePoints` (query) | `WarehouseRestorePoints` | list restore points, newest first |

There is no server-side schedule in core; putting backup on a cron is the `automation` feature's job.

### The optional remote copy

Set `backup.gcsBucket` in `box.json` or its gitignored `box.local.json` and every backup is **also**
uploaded, from the local copy, so the two are the same bytes. Every store has one object (or one
tree) in the bucket, overwritten each run; the history comes from the bucket's object versioning:

| Object | Written by | What |
|---|---|---|
| `warehouse/analytics-latest.duckdb` | `warehouse-backup`, `box db backup` | `data.db` |
| `warehouse/agents/<restore-point>.agents.json` | `warehouse-backup`, `box db backup` | the agent files of that backup, uploaded first and never overwritten; `analytics-latest.duckdb` names its pair in the object metadata `restore-point` (`gsutil stat`) |
| `chat/chat-latest.sqlite` | `chat-backup` | `chat.db` |
| `chat/uploads/` | `chat-backup` | copy of `chat-uploads/` |
| `artifacts/artifacts-latest.sqlite` | `artifacts-backup` | `artifacts.db` (page kv, view counts), latest copy |
| `artifacts/files/` | `artifacts-backup` | copy of `data/artifacts/` (published pages) |
| `wiki/wiki-latest.tar.gz` | `wiki-backup` | archive of the vault `data/wiki/` and `data/config/wiki.json`, the same file as the local one in `backups/wiki/` (see `recipes/wiki/INSTALL.md`) |

The SQLite copies go through `VACUUM INTO`, never `cp`. The file trees go up with `gsutil rsync -r`
(`uploadDirToGcs`): new and changed files are copied and **nothing is deleted remotely**, so a host
that loses part or all of a tree can never empty its backup. Their files do not change once written,
so a changed file is the rare case (a republished page), and versioning keeps its previous copy for
the window. The cost is that the bucket keeps files the host has since deleted; on restore, drop artifact trees that have no catalogue row. A missing or empty tree fails
the run, so a vanished store shows up as a failed backup. Schedule each action with a time trigger
beside `warehouse-backup`.

**History is versioning plus a lifecycle rule.** With object versioning on, each overwrite keeps
the previous copy as a noncurrent version, and a lifecycle rule deletes noncurrent versions after a
fixed number of days, so the bucket holds a rolling window of nightly copies and never grows past it.
The Box writes no dated objects and prunes nothing. Without versioning the bucket holds only the
latest copy. Restoring an older one:

```bash
gsutil ls -a gs://<bucket>/warehouse/analytics-latest.duckdb       # every version, with #<generation>
gsutil cp gs://<bucket>/warehouse/analytics-latest.duckdb#<generation> data/backups/manual-<stamp>-gcs.db
box db restore manual-<stamp>-gcs                                  # server stopped
```

No bucket is the normal case, not an error: the run is local-only and says so. Setup is one-time, a
**private** bucket with objectAdmin for the ambient `gcloud` identity, object versioning and the
lifecycle rule (the window is yours; 30 days shown):

```bash
gsutil versioning set on gs://<bucket>
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"isLive":false,"daysSinceNoncurrentTime":30}}]}' > lifecycle.json
gsutil lifecycle set lifecycle.json gs://<bucket>
```
 Auth is the ambient gcloud
credential, never a key in the warehouse. `assertGcsBucketReachable` fails fast with the `gsutil mb`
recipe rather than letting a scheduled run report success against nothing. An upload failure after a
successful local copy raises an error that names the local path, so nothing is silently lost.
The reachability check runs before the local copy, so a configured bucket that has become
unreachable stops `box db backup` from taking any copy at all. Restore the bucket access or remove
`backup.gcsBucket`; until then the Box has no fresh manual restore point.

**A warehouse backup inherits the sensitivity of whatever features are installed.** With `crm`
present the file holds names, emails and correspondence, so the bucket's access list is part of the
privacy surface and a downloaded `.duckdb` is a copy of it. Keep the bucket private, and treat
`backups/` on the host the same way.

**Ad-hoc `data.db.pre-<whatever>` files beside the warehouse are not a mechanism and nothing sweeps
them.** They accumulate one per migration somebody was nervous about, each a full copy of a database
that may hold personal data, and none is ever read again. Use `box db backup`.

## How a feature adds a table

Three edits inside the feature's own directory, then one command.

1. **Declare the ModelSpec** in `features/<id>/core/models.ts` and export it in the
   feature's model array.
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
3. **Append a migration** if existing Boxes need the change - a new table does not need one (the
   baseline creates it), a new column on an existing table does.
4. **`box verify`** includes **`bun run schema:check`**. After adding or removing a feature,
   first update the maintained feature registration and exports.

## Querying it directly

```bash
duckdb data/data.db -box -c "SELECT name, applied_at FROM schema_migrations ORDER BY 1;"
duckdb data/data.db -box -c "SELECT kind, count(*) FROM events GROUP BY 1 ORDER BY 2 DESC;"
```

The optional read-only `warehouse` MCP server uses `mcp-server-motherduck` with
`--db-path /path/to/box/data/data.db` and `--ephemeral-connections`, so an agent can query without
holding the lock. Configure it in the MCP client's own configuration; examples are in
[examples/mcp.json](examples/mcp.json) and [examples/codex-config.toml](examples/codex-config.toml).

## Where the signal writers live

`snapshots` and `signal_points` are core tables, and their writers live with them in
[`packages/core/src/signals/`](../packages/core/src/signals/): `upsertSnapshot`,
`replaceChannelSignals`, `replaceSignalRows` and `upsertBackfillSignals` in `write.ts`, and the
manual, windowed-sync and increment writers in `points.ts` ([SIGNALS.md](SIGNALS.md#the-point-store)).
Features write signal history through those helpers, never with their own SQL. If you find yourself
adding a writer to `warehouse/db.ts` for a table it does not own, put it with the table's owner
instead.
