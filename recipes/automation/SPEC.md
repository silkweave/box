# `automation` - triggers over core's run funnel

The timer. Core already knows how to *run* things: every feature contributes `ActionSpec`s to the
action registry (`packages/core/src/ops/registry.ts`), and every execution - manual, agent,
triggered - goes through the one funnel `executeRecorded()` (`ops/run.ts`), which records it in the
`automation_runs` table. This feature adds **when**: a trigger names *when* it fires and *what* it
does. This Box runs **time** triggers that do an **action**. The table already carries the columns
for event and webhook triggers and for agent and delivery work; a trigger of a kind this Box cannot
run is refused on write with "not supported in this Box yet", never stored half-working.

- **dependsOn**: nothing. The feature imports core only (`ops/registry`, `ops/run`, `warehouse/model`,
  and, in the server controller, core's agent host for the restart drain).
- **Depended on by**: nothing.
- **Removal**: nothing runs on a timer any more. Every action stays runnable by hand and by agent,
  because Run Now, the registry and the run history are core's `OpsController`. The `triggers`
  table stays in the warehouse, unread.

## Tables

**`triggers`** (owned, `features/automation/core/models.ts`, `timestamps`, `audit`):

| column | meaning |
|---|---|
| `id` | slug pk (`^[a-z0-9][a-z0-9-]*$`), stable: run rows link to it |
| `name`, `description` | display |
| `enabled` | 0/1 |
| `when_kind` | `time` (runs here); `event`, `webhook` reserved |
| `cron`, `timezone` | time: 5-field cron; IANA zone, null = the server's zone |
| `do_kind` | `action` (runs here); `agent`, `deliver` reserved |
| `action_id`, `params` | action: registry id; JSON object of string params handed to the action |
| `owner` | the admin the trigger belongs to; null only for triggers imported from config |
| `event_kind`, `webhook_source`, `filters`, `run_as`, `engine`, `model`, `cwd`, `prompt`, `success_marker`, `gate_*`, `route`, `message`, `notify`, `cooldown_min`, `debounce_sec`, `daily_cap`, `max_depth` | reserved for the other kinds; null |

`created_by` / `updated_by` record the principal that made the change. When an agent acts for an
admin, `owner` is the admin and `created_by` is the agent.

**Migration `automation:001-import-schedules`** (a `run` hook): Boxes before triggers configured
schedules in `box.json` / `box.local.json` `features.automation.schedules`. On the first boot with
this feature it inserts each well-formed entry as a time trigger that runs its action, keeping the
id (so `trigger_id` of old runs, backfilled from `schedule_id`, points at it), `enabled` and
`description`, with `name = id` and no owner. Existing ids are left alone. After it runs, the key is
not read; the scheduler logs a warning at boot while it is still present, and the owner removes it.

**Runs** are core's `automation_runs`. Core migrations `core:004-runs-trigger-id` (adds
`trigger_id`, backfilled from the legacy `schedule_id`) and `core:005-runs-event-id` link a run to
the trigger and event that started it. `trigger` is `time | event | webhook | manual`; old rows keep
`schedule`. The scheduler never writes a row itself: it drains `executeRecorded()` and calls core's
`insertSkippedRun()` / `markOrphanedRuns()`.

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

## Procedures and tools

`AutomationController` (`@Controller('automation')`, class-level `@UseGuards(AuthGuard)`):

| tRPC | MCP | who | what |
|---|---|---|---|
| `automationTriggers` (query) | `triggers-list` | member | every trigger, validated (`valid`, `problem`), cron humanized (`cronstrue`), with the scheduler's `nextFire`; plus `disabled` |
| `automationTriggerUpsert` (mutation) | `trigger-upsert` | admin | partial merge of one trigger; validated before anything is written. `params` is a JSON object string (`""` clears). `owner` defaults to the caller; the system agent must name the admin it acts for; the owner must be an admin |
| `automationTriggerDelete` (mutation) | `trigger-delete` | admin | remove one; unknown id throws |
| `automationTriggerRun` (mutation) | `trigger-run` | admin | run a trigger now regardless of its time or enabled state, attributed to the caller; returns the `runId` at once (follow with `run-get`) |
| `automationStatus` (query) | - | member | `loadedAt`, `disabled`, `armed`, and core's `activeRuns()` |
| `automationRestart` (mutation) | `service-restart` | admin | drain agent sessions, then exit 86 for a supervisor to respawn. Refuses with `ok:false` while a session is mid-turn unless `force:true` |

The registry, the run history and Run Now are core's `opsActions` / `opsRuns` / `opsRun` (`run-get`)
/ `opsRunNow` (`run-now`, which takes `trigger_id` to link a manual run to a trigger).

## Actions

**None.** The feature schedules what other features (and core's `warehouse-backup`) contribute.
`validateTrigger` enforces: the `action_id` resolves in `listAutomationActions()`, and an action marked
`parameterized` needs non-empty `params` on the trigger.

## UI

- **Settings**: `Automation`, icon `CalendarClock`, order 800. Sub-pages
  `#settings/automation/triggers` (the default; the old `schedules` id opens it),
  `#settings/automation/runs` (`/runs/<runId>` for detail) and `#settings/automation/actions`.
- **Triggers**: one card per trigger (When, Do, next fire, owner, problem). Run now streams the
  action inline through core's `opsRunNow` with the trigger id. Create, edit, delete and the enabled
  toggle show for admins only; the server enforces it regardless.
- **Runs**: a run fired by a trigger shows the trigger id; a manual run shows who ran it, plus the
  trigger id when it was a trigger's Run now.
- **Legacy routes**: `/automation`, `/automation/$section`, `/automation/$section/$runId` redirect to
  the Settings sub-page over Dashboard.
- **Data layer**: `lib/useAutomationData.ts` owns the triggers store (reloaded on `table:triggers`)
  and re-exports core's run stores.

## Settings

`background.automation` in `box.json`, a core boolean defaulting to `false`. Timers arm only when it
is `true`. Off, the feature still works end to end: triggers are visible, editable and validated,
and Run now works. Boot logs the state; the Triggers header says the timers are not armed.

The default is off because a dev checkout is routinely seeded from a production snapshot with the
same credentials; armed timers would fire real pulls, backups and publishes beside production.

## Admin-only

Rule (`docs/AUTH.md`): an operation is admin-only when its blast radius is another person's
identity or credential, the service itself, or configuration wired to credentials. A trigger decides
what runs unattended, so `trigger-upsert`, `trigger-delete`, `trigger-run` and `service-restart`
are admin-only. Reading triggers, status and history stays a member's, as does core's Run Now.

## What a team customises

- **The triggers.** Rows in the Box's warehouse, team-specific; a fresh Box has none.
- **Time zones.** Per trigger; empty means the server's zone.
- **Which actions are armed.** Whatever the installed features contribute; a trigger naming a
  missing action is listed as invalid with its reason, not dropped.
- **Labels and order.** Band 800 in `features/automation/web/index.tsx`.
- **The restart story.** `service-restart` assumes a supervisor that respawns a non-clean exit.
