# `automation` - triggers over core's run funnel

The timer. Core already knows how to *run* things: every feature contributes `ActionSpec`s to the
action registry (`packages/core/src/ops/registry.ts`), and every execution - manual, agent,
triggered - goes through the one funnel `executeRecorded()` (`ops/run.ts`), which records it in the
`automation_runs` table. This feature adds **when**: a trigger names *when* it fires and *what* it
does. This Box runs **time** and **event** triggers that do an **action** or an **agent** prompt,
and event triggers that **deliver** a message when a feature registers the deliver runner (the
`alerts` recipe does; "Ports" below). An agent prompt runs as a WorkerDeck job under an admin's
agent profile, outside the action funnel. The table already carries the columns for webhook
triggers; a trigger of a kind this Box cannot run is refused on write ("not supported in this
Box"), never stored half-working.

- **dependsOn**: nothing. The feature imports core (`ops/registry`, `ops/run`, `warehouse/model`)
  and the server's agent host (`apps/server/src/agent/workerdeck.host.ts`) for the restart drain and
  the job queue. Without the agent surface (`box.json` `workerdeck` null) agent triggers are refused
  on write and everything else works.
- **Depended on by**: `alerts` (registers the deliver runner and a trigger check; reads triggers).
- **Removal**: nothing runs on a timer or an event any more. Every action stays runnable by hand and by agent,
  because Run Now, the registry and the run history are core's `OpsController`. The `triggers`
  table stays in the warehouse, unread.

## Tables

**`triggers`** (owned, `features/automation/core/models.ts`, `timestamps`, `audit`):

| column | meaning |
|---|---|
| `id` | slug pk (`^[a-z0-9][a-z0-9-]*$`), stable: run rows link to it |
| `name`, `description` | display |
| `enabled` | 0/1 |
| `when_kind` | `time` or `event` (run here); `webhook` reserved |
| `cron`, `timezone` | time: 5-field cron; IANA zone, null = the server's zone |
| `event_kind` | event: an exact kind (`content.published`) or a family (`signal.*`) |
| `filters` | event: JSON list of `{path, equals \| regex \| in}`, all must match; refused on a time trigger |
| `do_kind` | `action` or `agent` (run here); `deliver` while a deliver runner is registered (event triggers only) |
| `action_id`, `params` | action: registry id; JSON object of string params handed to the action |
| `run_as` | agent: the admin whose agent profile runs the prompt ("runs as") |
| `engine`, `model` | agent: engine (null = the run_as user's preferred one) and model (null = the profile default) |
| `cwd` | agent: working directory, inside `box.json` `workerdeck.cwdRoots` (null = the first root) |
| `prompt` | agent: sent verbatim |
| `success_marker` | agent: the run is a success only when a line of the final text starts with this word (`SENT_OK` or `SENT_OK 42 sent`) |
| `permission_mode` | agent: null runs the job in the unattended mode (`workerdeck.queue.permissionMode`); `bypassPermissions` runs the main job with no permission checks (the gate keeps the unattended mode). Any other value, or a mode on a non-agent trigger, is refused on write |
| `gate_prompt`, `gate_model`, `gate_marker` | agent: an optional cheap first job; the run goes ahead only when its final text has the marker line |
| `route`, `message`, `notify`, `cooldown_min`, `debounce_sec` | deliver: the runner's fields (recipes/alerts/SPEC.md "Deliver triggers") |
| `daily_cap` | runs per UTC day that event fires stop at; null = 50 for an agent trigger, none for an action; refused on a delivery |
| `max_depth` | event: the chain depth it still fires at, 0-5; null = 2 |
| `owner` | the admin the trigger belongs to; null only for triggers imported from config |
| `webhook_source` | reserved for webhook triggers; null |

`created_by` / `updated_by` record the principal that made the change. When an agent acts for an
admin, `owner` is the admin and `created_by` is the agent.

**Migration `automation:001-import-schedules`** (a `run` hook): Boxes before triggers configured
schedules in `box.json` / `box.local.json` `features.automation.schedules`. On the first boot with
this feature it inserts each well-formed entry as a time trigger that runs its action, keeping the
id (so `trigger_id` of old runs, backfilled from `schedule_id`, points at it), `enabled` and
`description`, with `name = id` and no owner. Existing ids are left alone. After it runs, the key is
not read; the scheduler logs a warning at boot while it is still present, and the owner removes it.

**Migration `automation:002-trigger-permission-mode`** adds `permission_mode` (nullable, no
constraint: an ALTER cannot carry one, so the value is checked on write). Existing triggers keep
null, the unattended mode.

**Runs** are core's `automation_runs`. Core migrations `core:004-runs-trigger-id` (adds
`trigger_id`, backfilled from the legacy `schedule_id`) and `core:005-runs-event-id` link a run to
the trigger and event that started it. `trigger` is `time | event | webhook | manual`; old rows keep
`schedule`. For action triggers the scheduler never writes a row itself: it drains
`executeRecorded()` and calls core's `insertSkippedRun()` / `markOrphanedRuns()`. Agent runs are the
exception, below: their rows have `action_id = agent`.

### The scheduler, and the run semantics it leans on

`SchedulerService` is hand-rolled on purpose (no `@nestjs/schedule`): one chained `setTimeout` per
enabled, valid time trigger, the next fire computed by `cron-parser` in the trigger's zone, the state
readable through `status()`. It reads the table at boot and again after every write: the controller
reloads after its own writes, and a change-feed listener (`table:triggers`, or the generic
`warehouse` scope after a restore) reloads after any other writer, debounced. Edits apply without a
restart. `setTimeout` clamps to a 32-bit signed int, so a far-future delay is capped and re-armed.

Three of core's run semantics make a trigger safe to point at any action (`packages/core/src/ops/run.ts`):

- **The queue is in-process FIFO with concurrency 1**, because the warehouse is single-writer. Two
  triggers firing in the same minute serialize.
- **A time fire whose action is already queued or running records a `skipped` row** rather than
  queueing (`isActionBusy()` -> `insertSkippedRun()`). Manual runs always queue.
- **A run's log is written once at finalization** (the last 2000 lines), so a triggered run's log is
  readable only after it finishes. Nothing prunes `automation_runs`.

A timed run is attributed to the system principal (`triggered_by`) and to its trigger (`trigger_id`).

### Event triggers

`EventTriggersService` registers one `onEvent` listener and keeps the enabled, valid event triggers
in memory, re-read after every write to the table (like the scheduler). Dedup is the events table
itself: `recordEvent` only fans out events it inserted, so a replayed event never fires twice. Each
fresh event runs through every candidate trigger's guards, cheapest first:

1. **Kind**: `event_kind` exact, or `prefix.*`.
2. **Chain depth**: the event's `fields.depth` (0 when absent) must be at most `max_depth` (default
   2, ceiling 5).
3. **Filters**: each `path` is an event property (`kind`, `dedup_key`, `source`, `actor`, `subject`,
   `url`, `event_at`) or `fields.<name>`; each filter sets exactly one of `equals`, `regex` (a
   JavaScript regular expression) or `in`. All must match. A missing value fails, and so does a
   regex that does not compile (fail closed; the write already refuses one).
4. **Daily cap**: runs of this trigger since UTC midnight, counting every started run and every run
   its gate declined, but not guard skips. At the cap, one `skipped` row is recorded per trigger
   and day; later events that day leave no row.
5. **Busy**: an agent trigger whose previous run is in flight, or an action trigger whose action is
   queued or running, records a `skipped` row. An action trigger therefore never fires on an event
   its own action records while it runs.
6. **Gate** (agent triggers): below.

A guard after the filters records a `skipped` run (with `event_id`), so the history says why
nothing ran; an event the kind, depth or filters reject leaves no trace. Time triggers ignore the
daily cap and filters.

**Deliveries** stop after the filters: the event goes to the registered deliver runner, inside the
listener (awaited by `recordEvent`), within `withEventDepth(depth + 1)`. No run row, no daily cap,
no busy check: the runner keeps its own ledger and throttles with cooldown and debounce.

**The work.** An action trigger runs its action through the funnel with `trigger = event`,
`event_id` = the event row's id (`<kind>:<dedup_key>`) and its `params` with `{{path}}` placeholders
filled from the event (`{"content_id": "{{fields.content_id}}"}`; a missing value becomes `''`). An
agent trigger's prompt gets the same placeholders and the event appended as JSON. Event runs are
attributed to the system principal.

**Chain depth.** The work runs inside core's `withEventDepth(depth + 1)`, so every event it records
(including the `run.error` its outcome produces) carries `fields.depth`, and a loop of triggers
stops at `max_depth`. Events an agent records through Box MCP tool calls carry no depth (the call
does not say which run made it); the daily cap is the backstop there. Timers are armed in
`outsideEventChain`, so a reload caused by a write inside a chain does not lend its depth to later
timed runs.

**Not awaited.** `recordEvent` awaits its listeners and is often called from inside a funnel run,
so the listener queues the event and returns; guard checks run one event at a time, and an action
run is started detached (it queues behind the run that recorded the event).

### Ports

`ports.ts` is how a feature that depends on automation takes part without automation importing it.
Both are registered from the dependent's server module (`onModuleInit`), before the scheduler and
the dispatcher read the table (`onApplicationBootstrap`):

- `registerDeliverRunner({ id, validate, deliver })` - one per Box. While registered, `deliver` is a
  supported do kind: `validateTrigger` refuses a delivery on a time or with a daily cap, then calls
  the runner's `validate`; the dispatcher calls `deliver(t, event)`, and `trigger-run` calls
  `deliver(t, event, { now: true })` and answers with its one-line outcome.
- `registerTriggerCheck(id, check)` - `validateTrigger` runs every registered check last, for every
  trigger. Alerts refuses a `signal.increase` / `signal.threshold` trigger that does not name its
  signal and threshold in its filters.

Helpers for dependents: `triggersListeningFor(kind)` (enabled, valid event triggers covering a kind,
any do kind; an event source asks before polling), `filterValues(t, path)`, and
`triggersFilteringOn` / `repointTriggerFilters` (a renamed signal re-points every filter on
`fields.signal_id`, written without validation).

### Agent runs (WorkerDeck jobs)

`AgentRunsService` runs an agent trigger as a job on WorkerDeck's job queue, which the in-process
worker enables whenever the agent surface boots (`box.json` `workerdeck.queue`, below). Per run:

1. Re-check the trigger (`triggerProblem`) and its `run_as` user (`checkTriggerPrincipals`: still an
   admin), so a demoted admin's trigger stops running. Resolve the profile with
   `agentProfileFor(run_as, engine)`.
2. Insert the `automation_runs` row (`action_id = agent`, status `queued`). No funnel slot is held:
   the queue bounds concurrency, so a long agent job never blocks pulls.
3. Submit `POST /v1/jobs` over the loopback listener, so the worker vets it like any session create
   (profile, `cwd` inside `cwdRoots`, permission mode). The session carries `scope.user = run_as`
   (that person can watch it in their Work panel), `meta.app = box-trigger` (it never counts as their
   one live sidebar session), `questionBehavior: deny` and the trigger's `permission_mode` for the
   main job, else the unattended permission mode (`workerdeck.queue.permissionMode`, below). The
   first log line names the mode the job runs in. The job
   `meta` carries `triggerId`, `runId`, `eventId` and `depth`.
4. Follow the job's events: `job_started` marks the row running; tool and text previews become log
   lines; a `permission_requested` is answered with a denial (`denyAgentPermission`; nobody can
   approve an unattended run, and waiting would only reach the watchdog), reported like any other
   denial, and the run carries on; only a request that cannot be answered cancels the job with the
   tool named; `job_completed` finalizes. The
   service also follows the job's session (`onSessionEvent`) for the engine's `permission_denied`
   reports, below.
5. **Gate** (optional): with `gate_prompt` and `gate_marker` set, step 3 first submits a gate job
   (the gate prompt with the event appended, `gate_model` or the profile default, `meta.phase =
   gate`) under the same run row. When it succeeds with the marker as a line, the main job is
   submitted (`meta.phase = main`; events of the other phase are ignored). Otherwise the run ends
   `skipped` with `gate declined: ...` (the gate's text as summary, no run outcome), or `error`
   with `gate failed: ...` when the gate job failed. The gate's tokens and cost are a log line.
6. Finalize: `summary` = the final text (capped at 4000 characters), `log` = the session id line
   first, then the condensed transcript, the permission report and a usage line (tokens, turns,
   cost, duration). Success
   only when the job succeeded and, if the trigger names a marker, a line of the final text starts with it as a word.
   The outcome goes to core's `notifyRunOutcome`, so `run.error` alerts cover agent runs too.

**Permission denials.** In `auto` mode the engine's classifier decides each tool call. It refuses
some outright (the SDK's `permission_denied` system message, which WorkerDeck forwards as an
`sdk_event` on the session) and escalates others to an approval request, which the service denies
(reason type `unattended`; observed for `rm -rf` outside the project, 2026-10-06). A denied call does
not stop the run: the model sees the refusal and carries on, so the run can still succeed with work
missing. Each denial (one per `tool_use_id`) becomes a `denied` log line with the tool and the
deciding component (`classifier`, `mode`, `rule`, `unattended`), the run ends with a `permission
report: N tool call(s) denied on this unattended run ...` line, and each one emits the runtime diagnostic
`{"component":"automation","event":"agent.permission_denied", triggerId, runId, owner, runAs, tool,
reasonType}` (no tool input or reason text). Run detail shows a "Permission denials" panel. A
denial does not change the run's status; the success marker does. Push notifications to unblock a
denied call are future work.

**Bypass.** A trigger with `permission_mode = bypassPermissions` submits its main job in that mode,
for a job whose work the classifier keeps refusing (pushing to a remote, writing outside the
folder). The agent host runs WorkerDeck with `disableBypassPermissions: 'sessions'`: bypass is
refused for sidebar sessions, agents, profile defaults and a live `set_permission_mode`, and allowed
only for a job the host submits as the operator. The Box takes the mode only from the stored
trigger, so only an admin (or an agent acting for one, through `trigger-upsert`) can set it; a
browser user's session can never ask for it. While the job is in bypass WorkerDeck refuses typed
input and peer messages into its session, so nobody can steer it mid-run. `questionBehavior: deny`
still holds. Settings deny rules in the run_as profile and the job folder (e.g.
`Bash(git push:*)`) remain the fence; bypass skips allow checks, not denies. The trigger list marks
a bypass trigger and shows the mode of every agent trigger.

A time fire while the trigger's previous run is still in flight records a `skipped` row. The queue is
in-memory: a restart loses queued and running jobs, and the boot sweep (`markOrphanedRuns`) marks
their rows `orphaned by server restart`. `service-restart` refuses while a job session is mid-turn,
like any agent session.

## Procedures and tools

`AutomationController` (`@Controller('automation')`, class-level `@UseGuards(AuthGuard)`):

| tRPC | MCP | who | what |
|---|---|---|---|
| `automationTriggers` (query) | `triggers-list` | member | every trigger, validated (`valid`, `problem`), cron humanized (`cronstrue`), with the scheduler's `nextFire` and the guards in force (`dailyCap`, `maxDepth`); agent triggers with their resolved `engine`, `cwd` and `profile`; plus `disabled`, `eventKinds` (kinds recorded in the last 30 days, with counts), `agent` (`available`, `cwdRoots`, `runners`: admins with an agent profile and their engines) and `deliver` (`available`: a runner is registered) |
| `automationTriggerUpsert` (mutation) | `trigger-upsert` | admin | partial merge of one trigger; validated before anything is written. `params` is a JSON object string and `filters` a JSON array string (`""` clears either; `""` also clears the agent and gate text fields); `daily_cap` / `max_depth` are numbers, null for the default. A delivery sets `route`, `message`, `notify` (`realtime`/`""` or `digest`), `cooldown_min`, `debounce_sec`. `owner` defaults to the caller; the system agent must name the admin it acts for; the owner must be an admin. An agent trigger's `run_as` must be an admin with a profile for the engine (an admin may name another admin) |
| `automationTriggerDelete` (mutation) | `trigger-delete` | admin | remove one; unknown id throws |
| `automationTriggerRun` (mutation) | `trigger-run` | admin | run a trigger now regardless of its time or enabled state, attributed to the caller; returns the `runId` at once (follow with `run-get`). An agent trigger submits its job. A delivery has no run: it delivers at once (outside its debounce) and returns `runId: ""` with the outcome in `message`. Optional `event`: a sample event as a JSON object string (`{"kind", "fields", "actor", ...}`), handed to the run like a real one (placeholders, prompt, gate, chain depth); the guards do not apply, and the reply says whether its kind, depth and filters would have fired the trigger |
| `automationStatus` (query) | - | member | `loadedAt`, `disabled`, `armed`, `listening` (event triggers), and the runs in flight: core's `activeRuns()` plus agent runs as `agent:<trigger>` |
| `automationRestart` (mutation) | `service-restart` | admin | drain agent sessions, then exit 86 for a supervisor to respawn. Refuses with `ok:false` while a session is mid-turn unless `force:true` |

The registry, the run history and Run Now are core's `opsActions` / `opsRuns` / `opsRun` (`run-get`)
/ `opsRunNow` (`run-now`, which takes `trigger_id` to link a manual run to a trigger).

`WebhooksController` (same module, `@Controller('automation')`, admin-only because hook URLs carry
the hook key; the relay powerup below):

| tRPC | MCP | what |
|---|---|---|
| `webhooksStatus` (query) | `webhooks-status` | `armed` (`background.relay`), `url`, config `problems`, the client's `relay` state (`off`, `unconfigured`, `connecting`, `connected`, `waiting`, with `detail`, `connectedSince`, the Worker's queue at the last hello), `sources` (provider, `hasSecret`, `hookUrl`, `problem`), registered `providers`, and the newest 100 `deliveries` |
| `webhooksDelivery` (mutation) | `webhook-delivery` | one ledger row with its stored envelope |
| `webhooksTest` (mutation) | `webhook-test` | post a `custom` event (`kind`, default `test`) to a custom source's hook URL through the real Worker, signed when the source has a secret |
| `webhooksReconnect` (mutation) | `relay-reconnect` | reread the config and reconnect |

## Webhooks (relay powerup)

`recipes/automation/powerups/relay/`. A Cloudflare Worker (`features/automation/cloudflare/`, one
per Box) takes webhooks at `/hook/<source>/<hook key>`, stores them raw, and pushes them down a
WebSocket the Box dials out to; the Box acks each one after it has its ledger row, and the Worker
replays anything unacked on connect (7 days, 10,000 envelopes). The wire types are
`core/relay-protocol.ts`, shared by the Worker and the Box.

- **Client** (`server/automation/relay-client.service.ts`): armed by `background.relay` (false in
  maintenance), connects when `features.automation.relay` has a `url` and `clientToken`; text `ping`
  every 30 s (answered by the Worker runtime), reconnect with backoff 1-60 s, and a five-minute wait
  after another client took the Worker over (close 4000). Envelopes are processed one at a time.
- **Processing** (`core/webhooks.ts` `processEnvelope`): source from
  `features.automation.relay.sources` -> provider -> `verify` (the sender's signature) -> `parse` (the
  sender's schema, to `EventInput[]`) -> `recordEvent` each, `source: push:<source>` -> one row in
  `webhook_deliveries` (`recorded`, `duplicate` when every dedup key was known, `rejected` with the
  reason, `failed` when the warehouse refused; `failed` is not acked, so the Worker replays it). A
  replay of a settled envelope is acked without work. Rows and their envelopes are kept 30 days.
- **Providers** (`registerWebhookProvider`, the dependent registers into automation like the deliver
  runner): `custom` is built in. Its body is strict JSON `{kind, fields?, dedup_key?, actor?,
  subject?, url?, event_at?}` (fields are scalars, stringified) recorded as `<source>.<kind>`; without
  `dedup_key` every delivery is new; with a source secret it requires `X-Box-Signature:
  sha256=<hex>` over the raw body.
- Webhook events are ordinary events: an event trigger on `<source>.<kind>` with filters handles
  them. `when_kind: webhook` stays reserved and refused.

Table `webhook_deliveries` (no migration; the baseline creates it): `id` (envelope id, pk),
`source`, `provider`, `received_at`, `processed_at`, `status`, `reason`, `kinds` (json),
`event_count`, `attempts`, `envelope` (json).

## Actions

**None.** The feature schedules what other features (and core's `warehouse-backup`) contribute.
`validateTrigger` enforces: the `action_id` resolves in `listAutomationActions()`, and an action marked
`parameterized` needs non-empty `params` on the trigger. For an agent trigger: the agent surface is
configured, `run_as` and `prompt` are set, `run_as` has a profile for the engine, `cwd` is absolute and
inside `cwdRoots`, and the marker is one line; `checkTriggerPrincipals` adds that `run_as` is an admin.
For an event trigger: `event_kind` matches `^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*(\.\*)?$` (no
bare `*`), at most 20 filters each with a known path and exactly one valid matcher, `daily_cap` at
least 1, `max_depth` 0-5. A gate needs an agent trigger, a prompt and a one-line marker.

## UI

- **Settings**: `Automation`, icon `CalendarClock`, order 800. Sub-pages
  `#settings/automation/triggers` (the default; the old `schedules` id opens it),
  `#settings/automation/runs` (`/runs/<runId>` for detail), `#settings/automation/actions` and
  `#settings/automation/webhooks` (relay state, sources with a copyable hook URL, the delivery ledger
  with each envelope, Send test, Reconnect; admins).
- **Triggers**: one card per trigger (When, Do, next fire, owner, problem). A delivery's Do reads
  "deliver to <route>" (or "count in the daily digest for") with the start of its message, and its
  When shows the cooldown and debounce instead of a daily cap. An event trigger's When
  shows the kind, its filters, the daily cap and the chain depth in force; Run now opens a sample
  event (prefilled from the kind and the `fields.*` equals filters) and runs it on the server.
  The editor's When picks a time or a Box event (kind with suggestions from `eventKinds`, filter
  rows, max depth), and an agent prompt can ask a gate first. An agent trigger's Do
  reads "agent prompt, runs as <person>" with its profile, model, directory, marker and the start of
  the prompt, beside "owned by <admin>". Run now streams an action inline through core's `opsRunNow`
  with the trigger id; for an agent trigger it calls `trigger-run` (admins) and links the run. The
  editor's Do picks an action, an agent prompt (runs as, engine, model, directory, prompt, marker),
  or, on an event, a delivery (route with suggestions, message, each event or the daily digest,
  cooldown, debounce; disabled without a deliver runner).
  Create, edit, delete and the enabled toggle show for admins only; the server enforces it regardless.
- **Runs**: a run fired by a trigger shows the trigger id; a manual run shows who ran it, plus the
  trigger id when it was a trigger's Run now. Agent runs are labelled "Agent prompt"; their log
  starts with the WorkerDeck session id. Run detail shows the event that fired a run.
- **Legacy routes**: `/automation`, `/automation/$section`, `/automation/$section/$runId` redirect to
  the Settings sub-page over Dashboard.
- **Data layer**: `lib/useAutomationData.ts` owns the triggers store (reloaded on `table:triggers`)
  and re-exports core's run stores.

## Settings

`background.automation` in `box.json`, a core boolean defaulting to `false`. Timers arm and event
triggers listen only when it is `true`. Off, the feature still works end to end: triggers are
visible, editable and validated, and Run now (with a sample event) works. Boot logs the state; the Triggers header says the timers are not armed.

The default is off because a dev checkout is routinely seeded from a production snapshot with the
same credentials; armed timers would fire real pulls, backups and publishes beside production.

`box.json` `workerdeck.queue` tunes the job queue that runs agent triggers (all optional):

| key | default | effect |
|---|---|---|
| `maxConcurrency` | 1 | agent jobs at once |
| `sessionTokenLimit` | off (null) | token cap per job run; exceeding it fails the run |
| `dailyTokenLimit` | off (null) | token budget per UTC day; queued jobs wait for the next day |
| `maxJobDurationMs` | 3600000 | wall-clock watchdog per run |
| `retentionMs` | 604800000 | how long finished jobs stay in the queue (run rows are kept regardless) |
| `permissionMode` | `auto` | the unattended mode, `auto` or `dontAsk`. `auto`: the engine's classifier decides each tool call; denials are reported (above). `dontAsk` (Claude only; a Codex agent trigger is refused on write under it): runs what the run_as profile's settings allow and denies the rest. Any other value fails the boot of the agent surface |

`features.automation.relay` (the relay powerup): `url` (the Worker origin) and `sources`
(`{"<source>": {"provider": "custom"}}`) in `box.json`; `clientToken`, `hookKey` and a source's
`secret` in `box.local.json`. `background.relay` arms the client; keep it false everywhere except the
one Box that owns the Worker.

## Admin-only

Rule (`docs/AUTH.md`): an operation is admin-only when its blast radius is another person's
identity or credential, the service itself, or configuration wired to credentials. A trigger decides
what runs unattended, so `trigger-upsert`, `trigger-delete`, `trigger-run` and `service-restart`
are admin-only. An agent trigger runs on a person's own agent account, so that person is an admin
too, named explicitly in `run_as` and shown beside the owner ("runs as Dan, owned by Toby"). Reading triggers, status and history stays a member's, as does core's Run Now.

## What a team customises

- **The triggers.** Rows in the Box's warehouse, team-specific; a fresh Box has none.
- **Time zones.** Per trigger; empty means the server's zone.
- **Which events fire work.** Event kinds are whatever the installed features record (`eventKinds`
  lists the recent ones); filters, caps and depth per trigger.
- **What an agent run may do.** The run_as profile's own settings (allow rules, MCP servers) under
  the unattended permission mode, and the directories in `workerdeck.cwdRoots`.
- **Which actions are armed.** Whatever the installed features contribute; a trigger naming a
  missing action is listed as invalid with its reason, not dropped.
- **Labels and order.** Band 800 in `features/automation/web/index.tsx`.
- **The restart story.** `service-restart` assumes a supervisor that respawns a non-clean exit.
