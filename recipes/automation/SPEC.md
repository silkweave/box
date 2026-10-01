# `automation` - cron schedules over core's run funnel

The timer. Core already knows how to *run* things: every feature contributes `ActionSpec`s to the
action registry (`packages/core/src/ops/registry.ts`), and every execution - manual, agent, cron -
goes through the one funnel `executeRecorded()` (`ops/run.ts`), which records it in the
`automation_runs` table. This feature adds the only thing core deliberately left out: **when**. An
in-process cron scheduler reads `box.json features.automation.schedules` once at boot, arms one chained `setTimeout`
per enabled entry, and fires the named action through core's funnel. Around it sits the schedules
config surface (Settings), the run-history and actions Settings sub-pages, and the self-restart
that applies a config change.

- **dependsOn**: nothing. The manifest declares no dependencies; the feature's code imports core
  only (`ops/registry.js`, `ops/run.js`, `io.js`, and, in the server controller, core's agent host
  `apps/server/src/agent/workerdeck.host.ts` for the restart drain).
- **Depended on by**: nothing. No feature lists `automation` in `dependsOn` (`feature contracts`),
  and no feature imports it.
- **Removal**: clean. Every schedule stops, and nothing in the Box runs on a timer any more. Every
  action is still *runnable*, by hand and by agent, because Run Now, the registry and the run
  history are core's `OpsController` (`opsActions`, `opsRuns`, `opsRun`/`run-get`,
  `opsRunNow`/`run-now`), not this feature's. `box.json features.automation.schedules` is left on disk, unread. No file
  outside the three directories is edited (`packages/core/src/index.ts` re-exports the GENERATED
  barrel, fixed 2026-09-13 - it used to hand-list every feature, which broke that invariant).

## Tables

**None.** `models: []`, `migrations: []` - the manifest is four lines. This is the interesting fact
about the feature, and it is a boundary worth stating precisely:

- **The schedules** are a config file, not a table: `box.json features.automation.schedules`, via
  core's `configPath()` (`packages/core/src/io.ts`). Shape `{ "schedules": [ { id, action_id, cron,
  enabled, description? } ] }`; a missing file reads as an empty list, malformed JSON throws.
  `features/automation/core/config.ts` is the whole persistence layer - read, write
  (2-space pretty-print, trailing newline, diff-friendly), canonicalize, validate.
- **The runs** are core's: `automation_runs`, declared in `packages/core/src/warehouse/core-models.ts`
  and written exclusively by core's funnel and by core's skip/orphan bookkeeping
  (`ops/runs.ts`). The scheduler never writes a row itself - it calls `insertSkippedRun()` and
  `markOrphanedRuns()`, both core's, and otherwise drains `executeRecorded()`. Remove this feature
  and the table, its history and its view stay.

So the feature owns a JSON file and a `setTimeout` map. Everything durable belongs to core.

### The scheduler, and the run semantics it leans on

The scheduler is **hand-rolled on purpose** - no `@nestjs/schedule`: one chained `setTimeout` per
enabled entry, the next fire computed by `cron-parser`, and every piece of state readable through
`status()`. `setTimeout` clamps to a 32-bit signed int, so a delay over `2 ** 31 - 1` ms is capped
and re-armed rather than firing immediately (rare far-future crons).

`restartRequired` is a **canonical** comparison, not a byte one: `canonicalSchedules()` normalizes
and sorts the file before diffing it against the boot-time snapshot, so a reformat or a reordered
list is not drift. A file that is currently unreadable or malformed counts AS drift.

Three of core's run semantics are what make a cron safe to point at any action, and this feature is
built on them (`packages/core/src/ops/run.ts`):

- **The queue is in-process FIFO with concurrency 1**, because the warehouse is single-writer. Two
  schedules firing in the same minute serialize, so exact cron minutes only affect ordering -
  staggering a set of daily pulls is about a readable run history and nothing else.
- **A scheduled fire whose action is already queued or running records a `skipped` row** rather
  than queueing (`isActionBusy()` -> `insertSkippedRun()`). A slow action can therefore never pile
  its own fires up behind itself, and the skip stays visible in history. Manual runs always queue.
- **A run's log is buffered and written ONCE at finalization** (the last `LOG_CAP = 2000` lines), so
  a run costs one warehouse write rather than one per line. The consequence the Automation view
  lives with: a scheduled run's log is only readable after the run finishes. Nothing prunes
  `automation_runs`.

## Procedures and tools

`AutomationController` (`@Controller('automation')`, class-level `@UseGuards(AuthGuard)`):

| tRPC | MCP | what |
|---|---|---|
| `automationSchedules` (query) | `schedules-list` | the schedules as configured ON DISK, each humanized (`cronstrue`) and validated, with the running scheduler's `nextFire` joined in by id; plus `restartRequired`, `loadedAt`, `disabled` |
| `automationScheduleUpsert` (mutation) | `schedule-upsert` | partial merge of one entry into the JSON file; `validateSchedule` throws a human-readable reason (bad slug, unknown action, parameterized action, bad cron) before anything is written |
| `automationScheduleDelete` (mutation) | `schedule-delete` | remove one entry; unknown id throws |
| `automationStatus` (query) | - | the cheap poll target for the topbar: `restartRequired`, `loadedAt`, `disabled`, `scheduleCount`, and core's `activeRuns()` |
| `automationRestart` (mutation) | `service-restart` | drain agent sessions, then exit 86 so a supervisor respawns the process. Refuses with `ok:false` + the session ids while any agent session is mid-turn, unless `force:true` |

Five procedures, four MCP tools. The registry, the run history and Run Now are **not** here: they
are core's `opsActions` / `opsRuns` / `opsRun` (`run-get`) / `opsRunNow` (`run-now`).

The comments on `scheduleUpsert`, `scheduleDelete` and `restart` say "admin-only". They are not:
the Box's authorization layer was removed on 2026-09-10 (see `apps/server/src/auth/auth.guard.ts`),
so `AuthGuard` authenticates and nothing more. Any authenticated principal can edit a schedule or
restart the service.

## Actions

**None.** The feature contributes no `ActionSpec` to core's registry - it only schedules what other
features (and core's own `warehouse-backup`) already contribute. A Box with `automation` and no
other feature installed can schedule exactly one thing.

Two registry rules shape what is schedulable, both enforced in `validateSchedule`: the `action_id`
must resolve in `listAutomationActions()`, and an action marked `parameterized` is refused - it
needs per-run params, and a cron has none to give.

## UI

- **Settings**: `Automation`, icon `CalendarClock`, order **800**. Sub-pages are
  `#settings/automation/schedules`, `#settings/automation/runs`, and `#settings/automation/actions`.
  Run details use `#settings/automation/runs/<runId>`. Schedule create/edit and confirmations occupy
  the Settings pane, with a Back action. Run now and restart controls remain available.
- **Legacy routes**: `/automation`, `/automation/$section`, and `/automation/$section/$runId`
  redirect to the corresponding Settings sub-page over Dashboard. `/settings/schedules` remains
  a supported alias. There is no Automation entry in the application sidebar.
- **Shell**: one topbar component, `RestartRequiredButton`, order 100. It renders **only** when
  `automationStatus.restartRequired` is true, i.e. when `box.json features.automation.schedules` on disk differs from
  the snapshot the running scheduler loaded. Its popover explains the drift and embeds
  `RestartServerButton`.
- **Slots / onSession**: none.
- **Data layer**: `lib/useAutomationData.ts` owns two stores (schedules, status) and re-exports
  core's run stores (`useRuns`, `useActions`, `runNow`, `fetchRun`) under automation-flavoured
  names. The status store polls every 60s and on window focus, so the topbar and the settings
  section agree. The schedules store is registered against the change-feed scope
  `config:schedules.json`, which core's fs watcher (`apps/server/src/changes/changes.watcher.ts`)
  emits for out-of-process edits - hand-editing the file refreshes the UI without a reload.

## Settings

`background.automation` in `box.json`, a core setting. The feature reads no environment variables.

The value is a boolean that defaults to `false`; any other type fails configuration loading. The
scheduler does `this.disabled = !boxJson().background.automation`, so the timers arm only when it is
`true`. Nothing else in the feature reads it.

The default is off on purpose. A dev checkout is routinely seeded from a production snapshot and
points at the same credentials; if `box dev` armed the crons, a laptop would start firing the real
pulls, backups and publishes beside the production Box. With the flag off the feature still works
end to end: schedules stay visible and editable, validation still runs, and any action is still
runnable on demand (Settings → Schedules → Run now, Automation → Actions, `run-now` over MCP). Boot
logs the state explicitly:
`background.automation is false - schedules loaded but no timers armed (dev-safe default; set it true in box.json to run them)`.

The UI surfaces the same as `disabled: true`: the Schedules header appends
"(timers NOT armed - set background.automation=true in box.json to run them)".

## Admin-only

Since 2026-09-13 the Box has two tiers (`docs/AUTH.md`, "The two tiers"), and the rule every feature applies is
one sentence: **an operation is admin-only when its blast radius is another person's identity or
credential, the service itself, or configuration wired to credentials.**

This feature's admin set is `schedule-upsert`, `schedule-delete`, `service-restart`.

A schedule decides what runs unattended and `service-restart` is the service itself. Reading the
schedules, the status and the run history stays a member's, as does Run Now (core's ops surface):
running an action by hand is work, not configuration.

## What a team customises

- **The schedules themselves.** `box.json features.automation.schedules` is the feature, and it is team-specific:
  which action, what cron, enabled or not. It lives under the instance dir, so it is the tenant's
  file, not the template's - a fresh Box has none and the view says so.
- **Cron expressions.** Full 5-field expressions, parsed by `cron-parser` and evaluated in the
  **server's local timezone** (there is no per-schedule timezone field). "Daily at 07:00" is
  `0 7 * * *`.
- **Which actions are armed.** The catalog is whatever the installed features contribute; a Box with
  fewer features has fewer schedulable ids, and an entry naming a missing action is surfaced as
  `invalid` with its reason rather than silently dropped.
- **Nav and settings labels and order.** Band 800 in `features/automation/web/index.tsx`.
- **The restart story.** `automationRestart` assumes a supervisor that respawns a non-clean exit;
  the docstring names a launchd plist inherited from the predecessor that does not exist in this
  template (see AGENT.md
  § 5). A team on a different supervisor changes nothing in the code but should know what exit 86
  lands on.
