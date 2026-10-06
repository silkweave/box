# `alerts` - deliveries for triggers, the alert ledger, event sources

Everything that should page somebody. The rules are **deliver triggers**: rows of automation's
`triggers` table with `when_kind = event` and `do_kind = deliver` (recipes/automation/SPEC.md).
Alerts is their runner. When an event matches a deliver trigger, its message is rendered from the
event and recorded as a deduped row in the `alerts` table, and a debounced flusher sends every
pending row out as one batched message per target, through whatever transport claims the route
(Team Box chat: a room post or a direct message from the agent). Alerts also brings its own event
sources: five funnel actions that poll Reddit, GitHub and LinkedIn, measure traction over the
trailing hour, and recap the quiet stuff once a day, plus the signal, goal and `run.error`
events recorded after funnel runs.

- **dependsOn**: `automation`, `data`, `planning`, `content`, `engagement` (below).
- **Depended on by**: `notifications` (`chat` + `alerts`). Removing
  `alerts` removes both. Its dependents must be adapted or removed first.

### What it uses from each dependency

| dep | what alerts imports | where |
|---|---|---|
| `automation` | `registerDeliverRunner`, `registerTriggerCheck` (its ports), `readTriggers`, `triggersListeningFor`, `filterValues`, `kindMatches`, `filterMismatch`, `renderTemplate`, `triggersFilteringOn` / `repointTriggerFilters` | `deliver-trigger.ts`, `signals.ts`, `digest.ts`, `traction.ts`, `github.ts`, `deliver.ts`, `AlertsModule` |
| `data` | `fetchInboxEvents` (the browser-free Reddit unread feed) | `reddit.ts` |
| `data` | `computeXEngagementRows` / `X_ENGAGEMENT_KINDS`, `autoRegisterDefinitions`, `deriveSignalIncrements` / `SIGNAL_INCREMENT_KIND` - event-derived signals re-materialize on every fresh event | `evaluate.ts` |
| `data` | `readSignalOwnersFile` / `resolveSignalOwner` - resolves `owner` on a signal event to a person | `deliver-trigger.ts` |
| `data` | `browserIdentity`, `connectCDP` / `detach` / `firstContext`, `linkedinGet` - the two LinkedIn fetch paths | `linkedin.ts` |
| `data` | its tables, read raw: `legacy_signal_points` (the two latest snapshots per signal), `latest_signals` | `signals.ts` |
| `data` | `registerSignalHooks` - alerts registers `onRename` + `references` so a signal rename re-points every trigger filter on `fields.signal_id` | `AlertsModule.onModuleInit` |
| `planning` | `readMeasuredGoals` - every goal with its reading, for the goal evaluator | `goal-events.ts` |
| `content` | `readContentPieces` + the `ContentPiece` type - published LinkedIn pieces carrying `metadata.post_urn` are the comment-poll targets | `linkedin.ts` |
| `engagement` | `inboxDeepLink` from `inbox/inbox-map.ts` - the "Open in dashboard" link in a chat alert lands on the exact tactical-Inbox item the event created | `message.ts` |

What breaks without it: `notifications` stops compiling (it imports `alerts` directly); deliver
triggers are listed invalid ("delivery comes with the alerts feature") and the editor greys out
"Deliver a message"; the five `alerts-*` actions leave the run funnel and any trigger pointing at
them; goals keep their reading but nothing records `goal.*` events; `run.error` and signal events
are no longer recorded.

## Tables

| table | pk | what it holds |
|---|---|---|
| `alerts` | `(rule_id, dedup_key)` | fired-alert history: the rule, the event kind, the route and resolved `target`, the rendered `message` + `payload` JSON, `status` (`pending` / `delivered` / `suppressed` / `error`), `event_at` / `created_at` / `delivered_at`, `error`, and `batch_id` (shared by every row that went out in one message) |

`rule_id` is the id of the deliver trigger that recorded the row (rule ids were kept when they
became triggers, so older rows stay linked). The events live in core's `events` table; the
triggers in automation's `triggers` table.

**Migration `alerts:001-import-rules`** (a `run` hook, 2026-10-06): Boxes before deliver triggers
configured rules in `box.json` / `box.local.json` `features.alerts.rules`. On the first boot with
this version each rule with an `id` and an `event` becomes a trigger: `when_kind = event`,
`event_kind = event`, `do_kind = deliver`, `route`, `message`, `notify` (`digest` or null),
`cooldown_min` (0 becomes null), `debounce_sec` and `enabled` carried over, `name = id`, no owner.
`signal_id` becomes the filter `fields.signal_id = <id>` and `threshold` the filter
`fields.threshold = <n>`. The `digest.daily` rule gets the route `{{fields.route}}` (each digest
goes where its feeds route it). A rule's `tiers` and any unknown key (`series_id`) are named in the
description. An id that already exists as a trigger is skipped with a warning. Afterwards the key
is not read; `AlertsModule` logs a warning at boot while it is still present. `features.alerts.routing`
and `features.alerts.larkCli` are not read either (Lark is gone).

`store.ts` is the only write path. `recordAlerts()` is an `INSERT ... ON CONFLICT DO NOTHING ...
RETURNING`, so re-evaluating the same source event inserts nothing and returns nothing - the
idempotency gate that makes every evaluator safely re-runnable.

## Deliver triggers (the runner)

`AlertsModule.onModuleInit` registers `ALERTS_DELIVER_RUNNER` with automation's
`registerDeliverRunner` and `signalTriggerProblem` with `registerTriggerCheck`. Automation's event
dispatcher hands every fresh event that passes a deliver trigger's kind, chain depth and filters to
`deliverTriggerEvent` (`deliver-trigger.ts`), **inside the spine's fan-out**: `recordEvent` returns
only after the alert row is recorded, so a poll that records a batch and then calls
`flushAlertsNow()` sends the whole batch. Deliveries follow `background.automation` like every
trigger: with it off, no event delivers anything (Run now still does).

- **Fields.** `route`, `message`, `notify`, `cooldown_min`, `debounce_sec` on the trigger.
  `validateDeliverTrigger` requires a route matching `owner | channel | user:<id> |
  chat:<room-slug>` (or one with `{{path}}` placeholders, checked at delivery) and a message;
  `notify` is null/`realtime` or `digest` (a digest feed listens for one exact kind); cooldown and
  debounce are whole numbers. Automation itself refuses a delivery on a time, with a daily cap or
  with a gate.
- **Rendering.** The message renders `{{path}}` placeholders (automation's `renderTemplate`), then
  the `{field}` tokens rules always used (`renderMessage`; unknown tokens stay intact, which is how
  you discover field names). The route renders `{{path}}` too.
- **`owner`.** On a `signal.*` event with `fields.signal_id`, `owner` becomes `user:<owner>` via
  `box.json features.data.signalOwners` (signal override, channel default, account binding).
  Anywhere else, or unowned, it stays `owner` and delivery sends it to the alerts room.
- **Record.** One `pending` row per (trigger, event `dedup_key`), then `requestFlush(debounce_sec ??
  300)`. `notify = digest` records nothing; the daily digest counts the event.
- **Run now** (`trigger-run`, admin) delivers a sample event at once (`{ now: true }`), outside the
  debounce, and answers with what happened: `delivered to dm:toby`, `suppressed: ...`,
  `delivery to ... failed: ...`, or `already recorded for ...` when the sample's `dedup_key` repeats.

**Signal triggers.** `signalTriggerProblem` refuses a trigger on exactly `signal.increase` or
`signal.threshold` (any do kind) that does not name its signal with an `equals` / `in` filter on
`fields.signal_id`, and, for a threshold, a numeric filter on `fields.threshold`. The signal
evaluator watches only what the triggers name.

## The transports port

`alerts` owns `registerAlertTransport` (`transports.ts`). It is the second half of the rule in
`feature contracts`: **the dependent registers into the dependency, never the reverse.** Alerts
has no sink of its own. Every place an alert can go arrives as a transport registered from the
dependent feature's server module.

```ts
export interface AlertTransport {
  id: string                                       // prefixes the recorded target: `chat:<slug>`, `dm:<user>`
  matchRoute: (route: string) => string | null     // the concrete target, or null: not mine
  deliver: (target: string, alerts: readonly AlertRecord[]) => Promise<void>
}
export function registerAlertTransport(t: AlertTransport): () => void   // returns the unregister
```

Registering the same `id` twice throws. `deliverPendingAlerts()` checks the trigger's cooldown,
resolves the route (`routing.ts`: `channel` and a literal `owner` become `chat:<channelRoom>`,
`features.alerts.channelRoom`, default `automations`), then calls `matchAlertTransport(route)`: the
first transport that claims it wins, its alerts are grouped per `(transport, target)`, and one
`deliver()` call carries the whole group. A throw marks every row in that group `error` with the
message; success marks them `delivered` with `target = "<transport id>:<target>"` and a shared
`batch_id`. A route no transport claims records `error: no alert transport handles route "..."`.
`message.ts` renders the chat body: one alert is its message, several are one line each, with an
"Open in dashboard" link to the tactical-Inbox item when one maps and `server.dashboardUrl` is set.

The registrations in the tree: `NotificationsModule.onModuleInit` (a `chat` + `alerts` glue feature)
registers `CHAT_ALERT_TRANSPORT` (`chat:<room-slug>`: one post into that room as the agent; an
unknown room throws) and `directAlertTransport(notifyDirectMessage)` (`user:<id>`: one message in
the agent's direct message with that person, opened when missing, then pushed to their devices;
an unknown user or the agent itself throws). Alerts never imports `notifications`.

## Its relationship to the events spine

`packages/core/src/events.ts` is core, not this feature. `recordEvent()` is the freshness gate
(dedup insert; `true` means "first time"), and it fans FRESH events out to in-process `onEvent`
subscribers, awaiting them. Automation's event dispatcher is the subscriber that matches triggers.

- **`ingestEvent` (in alerts) is record-only.** It wraps `recordEvent`, never throws, and returns
  `{ fresh }`. A caller on a hot path can await it without risking its own flow.
- **`refreshEventSignals`** is alerts' own `onEvent` listener: it keeps the event-derived
  `x.engagement` signal and increment signals current. It matches no rules.

What alerts records: `reddit.inbox`, `github.notification`, `linkedin.comment`, `traction.spike`,
`digest.daily`, `run.error`, `signal.increase` / `signal.threshold`, `goal.met` /
`goal.off_track` / `goal.ended`. Deliver triggers can listen for any kind, including the `x.*`,
`github.*` and `content.*` kinds other features record.

It also subscribes to core's run funnel with `onRunOutcome` from the same `onModuleInit`: a
**success** (from any action that is not itself `alerts-*`) runs `evaluateSignalEvents()` +
`evaluateGoals()`; a **failure** ingests a `run.error` event keyed on the run id.

### Signal events

`evaluateSignalEvents()` (`signals.ts`) collects what the enabled, valid triggers watch: every
event trigger whose kind covers `signal.increase` (exactly or through `signal.*`) adds the signals
its `fields.signal_id` filter names; one covering `signal.threshold` adds (signal, threshold)
pairs from its `fields.threshold` filter. For each watched signal it compares the two latest rows of
`legacy_signal_points` and records:

| kind | when | deduped per |
|---|---|---|
| `signal.increase` | the latest value is above the one before | signal and date |
| `signal.threshold` | the latest value reached the threshold and the one before was below it (or there is none) | signal, threshold and date |

Fields: `signal_id`, `label`, `unit`, `channel`, `date`, `value`, `prev`, `delta`, and `threshold` on
a threshold event; the subject is the signal id. Each trigger's own filters then pick out its
signal and threshold.

### Goal events

`evaluateGoals()` (`features/alerts/core/goal-events.ts`) reads every **open** goal (no recorded
outcome) through planning's `readMeasuredGoals`, the one measurement everything else uses, and puts
what changed on the spine. It never records an outcome and never throws into the run funnel.

| kind | when | deduped per |
|---|---|---|
| `goal.met` | the reading says `met` | goal and target |
| `goal.off_track` | the reading is `off_track` (a hold goal outside its bound included) | goal and day |
| `goal.ended` | the window has closed with no outcome recorded; carries `suggested_outcome` (`met` or `missed`) so the team is prompted to record one | goal and end date |

Each event carries the goal id, title, signal, kind, target, actual, expected, health and window as
fields, and the goal id as its subject. A deliver trigger matches these kinds; without one they
still land durably in `events`.

## Procedures and tools

`AlertsController` (`@Controller('alerts')`, class-level `@UseGuards(AuthGuard)`):

| tRPC | MCP | what |
|---|---|---|
| `alertsList` (query) | `alerts-list` | the recorded feed, newest first, capped at 200. Read-only: rows are written by the runner and the flusher |

The rules are triggers: `triggers-list`, `trigger-upsert` (with `do_kind: "deliver"`, `route`,
`message`, `notify`, `cooldown_min`, `debounce_sec`), `trigger-delete` and `trigger-run` are
automation's (recipes/automation/SPEC.md).

## Actions (core's run funnel)

| id | group | what |
|---|---|---|
| `alerts-reddit` | Alerts | browser-free unread-feed poll, ingest, then one batched flush |
| `alerts-github` | Alerts | conditional poll of the participating notifications inbox (free `304`s, honors `X-Poll-Interval`, protocol state in `kv_state`) |
| `alerts-linkedin` | Alerts | comments on published pieces: official API for org posts, the author's logged-in Chrome for member posts (at most hourly) |
| `alerts-traction` | Alerts | trailing-hour engagement per subject against the tier ladder (`features.alerts.tractionTiers`, default `[10, 25, 50, 100, 250]`), one `traction.spike` per (subject, tier) |
| `alerts-digest` | Alerts | 24h recap of the digest feeds (deliver triggers with `notify: digest`), one `digest.daily` event per route, deduped per (route, date) |

Each evaluator does nothing while no enabled trigger listens for its kind (`triggersListeningFor`):
`alerts-github` skips the poll, `alerts-traction` skips the scan, `alerts-digest` needs a trigger
on `digest.daily` and at least one feed. The digest counts a feed's event only when the feed's
filters match it, once per route (the feed's route, placeholders rendered), and records
`digest.daily` with the fields `date`, `route`, `summary` and `count`.

Every action wrapper ends with `flushAlertsNow()` - a poll's batch is already whole, so it does not
wait out the debounce.

## Recording and delivering are decoupled

`flush.ts` is the only path that sends, and three of its rules are decisions rather than details:

- **The debounce window never extends.** The first pending row schedules the flush and later
  arrivals join it without pushing it out, so `debounce_sec` is the debounce AND the max hold, by
  design. A request landing mid-pass is honoured by exactly one queued follow-up pass
  (single-flight) - which is also what stops two evaluators picking up the same pending row and
  double-sending it.
- **The cooldown check runs BEFORE the route resolves**, because a cooldown is a property of the
  trigger and not of where it sends. So a suppressed alert on an unclaimed route records
  `suppressed` rather than `error`: the trigger was in its quiet window either way.
- **A failed send stays `error` and is never auto-retried.** Only `pending` rows are picked up, so
  re-running a flush - or a whole evaluator - can never double-send. Same idempotency argument as
  `recordAlerts()`'s conflict-free insert, one layer out.

Two evaluator windows worth knowing before you put them on a cron: `alerts-traction` counts the
trailing `WINDOW_MIN = 60` minutes, so an hourly schedule makes the windows abut exactly and any
drift leaves either a gap or an overlap - a tighter cron is the safe direction. `alerts-digest`
reads the trailing 24h and **sends nothing at all on an empty day**, so silence from it is a
working digest rather than a broken one.

## UI

- **Settings**: `Alerts`, icon `Bell`, order **810**: the alert history (status, message, trigger,
  route, when). The rules are edited in Settings > Automation > Triggers ("Deliver a message").
- **Legacy routes**: `/alerts` redirects to the history; `#settings/alerts/rules` and
  `#settings/rules` open Automation > Triggers. There is no Alerts entry in the application sidebar.
- **Shell topbar / slots / onSession**: none.
- The feed store polls itself every 10s while any row is still `pending`, and reloads on the change
  feed for `table:alerts` + `table:events`.

## Settings

The feature reads no environment variables. Settings that change runtime behaviour:

- `features.alerts.channelRoom` (`routing.ts`) - the chat room slug `channel` and an unresolved
  `owner` deliver to; default `automations`. A value that is not a room slug fails delivery with
  that message.
- `features.alerts.tractionTiers` (`traction.ts`) - the traction tier ladder, a non-empty list of
  positive numbers; default `[10, 25, 50, 100, 250]`.
- `server.dashboardUrl` (via `engagement`'s `inboxDeepLink`) - unset means chat alerts carry no
  "Open in dashboard" link.
- `background.automation` - deliver triggers listen only while it is `true`.

GitHub polling takes its token from core's credential store (`requireCredentials('github', <default
account>, 'GH_TOKEN')`), not from an environment variable.

## What a team customises

1. **The deliver triggers** - Settings > Automation > Triggers, or `trigger-upsert`. A delivery is
   an event trigger with `do_kind: deliver`, a `route`, a `message`, and the optionals `filters`,
   `notify`, `cooldown_min`, `debounce_sec`, `max_depth`. A fresh Box has none: the feature is
   dormant, not broken.
2. **The alerts room** - `features.alerts.channelRoom`; the room must exist in chat.
3. **Which evaluators run** - the five actions are triggered through `automation` (time triggers).
   A team with no LinkedIn presence simply never schedules `alerts-linkedin`.
4. **The vocabularies** - `types.ts` (the status set), `deliver-trigger.ts` (the route grammar),
   `traction.ts` (`ENGAGEMENT_KINDS`, `WINDOW_MIN = 60`, `DEFAULT_TIERS`), `digest.ts` (`KIND_LINE`,
   the 24h window), `flush.ts` (`DEFAULT_DEBOUNCE_SEC = 300`). These are the team's language; the
   nouns in them are still the predecessor's.
5. **Labels and order** - settings section label and order in `features/alerts/web/index.tsx`.

## A naming collision to know about

`docs/core/SEAM.md` section 8 flags it: alerts' `evaluate.ts` / `evaluateSignalEvents` /
`evaluateGoals` / `evaluateTraction` share the words `verify` and `evaluate` with
`content`'s publishing gate (`content/verify`) and `engagement`'s browser verification of
engagements (`pods/verify`). Nothing is broken - the modules live in different features - but "the
verify step" and "the evaluator" are ambiguous in conversation and in search. The open point
proposes renaming the engagement one (`engagement/verify-actions.ts`); it has not been done.
