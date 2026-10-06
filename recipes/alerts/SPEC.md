# `alerts` - rules over the events spine, the alert ledger, delivery

Everything that should page somebody. A small set of declarative rules (`box.json features.alerts.rules`, no
rules table) is matched against the events on core's spine; a match becomes a
deduped row in the `alerts` table, and a debounced flusher sends every pending row out as one
batched message per target - a Lark card by default, or whatever a registered transport claims.
Alerts also brings its own event sources: five funnel actions that poll Reddit, GitHub and
LinkedIn, measure traction over the trailing hour, and recap the quiet stuff once a day. It is the
most-connected feature in the Box: four dependencies, two dependents, and the only subscriber core
ships a port for.

- **dependsOn**: `data`, `planning`, `content`, `engagement` (below).
- **Depended on by**: `notifications` (`chat` + `alerts`). Removing
  `alerts` removes both. Its dependents must be adapted or removed first.

### What it uses from each dependency

| dep | what alerts imports | where |
|---|---|---|
| `data` | `fetchInboxEvents` (the browser-free Reddit unread feed) | `reddit.ts` |
| `data` | `computeXEngagementRows` / `X_ENGAGEMENT_KINDS`, `autoRegisterDefinitions`, `deriveSignalIncrements` / `SIGNAL_INCREMENT_KIND` - the policy re-materializes event-derived signals before it matches rules | `evaluate.ts` |
| `data` | `readSignalOwnersFile` / `resolveSignalOwner` - resolves a signal rule's `owner` route to a person | `signals.ts` |
| `data` | `browserIdentity`, `connectCDP` / `detach` / `firstContext`, `linkedinGet` - the two LinkedIn fetch paths | `linkedin.ts` |
| `data` | its tables, read raw: `legacy_signal_points` (the two latest snapshots per signal), `latest_signals` | `signals.ts` |
| `data` | `registerSignalHooks` - alerts registers `onRename` + `references` so a signal rename re-points every rule's `signal_id` | `AlertsModule.onModuleInit` |
| `planning` | `readMeasuredGoals` - every goal with its reading, for the goal evaluator | `goal-events.ts` |
| `content` | `readContentPieces` + the `ContentPiece` type - published LinkedIn pieces carrying `metadata.post_urn` are the comment-poll targets | `linkedin.ts` |
| `engagement` | `inboxDeepLink` + `dashboardUrl` from `inbox/inbox-map.ts` - the "Open in dashboard" button on a Lark card lands on the exact tactical-Inbox item the event created | `cards.ts` |
| `data` (web) | `SignalPicker`, `signalLabel` / `signalMap`, `useSignalsData` - the rule dialog's signal field | `views/AlertsSections.tsx` |

What breaks without it: `notifications` stops compiling (it imports `alerts` directly);
the events spine keeps recording but nothing reacts to a fresh event; the five `alerts-*` actions
leave the run funnel and any schedule pointing at them; goals keep their reading but nothing
records `goal.*` events; `run.error` stops paging anyone.

## Tables

| table | pk | what it holds |
|---|---|---|
| `alerts` | `(rule_id, dedup_key)` | fired-alert history: the rule, the event kind, the route and resolved `target`, the rendered `message` + `payload` JSON, `status` (`pending` / `delivered` / `suppressed` / `error`), `event_at` / `created_at` / `delivered_at`, `error`, and `batch_id` (shared by every row that went out in one message) |

`migrations: []`, no baseline DDL. The events the feature reacts to live in core's `events` table,
which core owns; the rules live in a JSON file, not a table.

`store.ts` is the only write path. `recordAlerts()` is an `INSERT ... ON CONFLICT DO NOTHING ...
RETURNING`, so re-evaluating the same source event inserts nothing and returns nothing - the
idempotency gate that makes every evaluator safely re-runnable.

## The transports port

`alerts` owns `registerAlertTransport` (`transports.ts`). It is the second half of the rule in
`feature contracts`: **the dependent registers into the dependency, never the reverse.** Alerts
knows one sink natively (Lark). Anything else - a chat room today, a webhook later - arrives as a
transport registered from the dependent feature's server module.

```ts
export interface AlertTransport {
  id: string                                       // prefixes the recorded target: `chat:<slug>`
  matchRoute: (route: string) => string | null     // the concrete target, or null: not mine
  deliver: (target: string, alerts: readonly AlertRecord[]) => Promise<void>
}
export function registerAlertTransport(t: AlertTransport): () => void   // returns the unregister
```

Registering the same `id` twice throws. `deliverPendingAlerts()` calls `matchAlertTransport(route)`
for every pending alert **after** the rule's cooldown check and **before** Lark routing: the first
transport that claims the route wins, its alerts are grouped per `(transport, target)`, and one
`deliver()` call carries the whole group. A throw marks every row in that group `error` with the
message; success marks them `delivered` with `target = "<transport id>:<target>"` and a shared
`batch_id`. Routes no transport claims fall through to `resolveRoute()` and the Lark card path.

The one registration in the tree today: `NotificationsModule.onModuleInit` (a `chat` + `alerts`
glue feature) calls `registerAlertTransport(CHAT_ALERT_TRANSPORT)`, whose `matchRoute` is
`chat:<room-slug>` and whose `deliver` posts one message into that chat room as the agent. Alerts
never imports `notifications`.

## Its relationship to the events spine

`packages/core/src/events.ts` is core, not this feature. `recordEvent()` is the freshness gate
(dedup insert; `true` means "first time"), and it fans FRESH events out to in-process `onEvent`
subscribers. The design rule:

- **`ingestEvent` (in alerts) is record-only.** It wraps `recordEvent`, never throws, and returns
  `{ fresh }`. A caller on a hot path can await it without risking its own flow.
- **The POLICY lives here.** `applyAlertPolicy(event)` re-materializes event-derived signals,
  matches the enabled realtime rules for the kind, records deduped alert rows and calls
  `requestFlush(debounce)`. `AlertsModule.onModuleInit` registers it on the spine with `onEvent`,
  so policy runs for a fresh event no matter who recorded it: an alerts poll, content publishing,
  or the run funnel. It never throws either; anything missed stays visible in `events`.

Alerts subscribes to **every** kind (one listener, filtering by rule), so the interesting list is
what it emits and acts on: `reddit.inbox`, `github.notification`, `linkedin.comment`,
`traction.spike`, `digest.daily`, `run.error`, `signal.increase` / `signal.threshold`,
`goal.met` / `goal.off_track` / `goal.ended`, plus the `x.*` and `github.*` kinds other
features record.

It also subscribes to core's run funnel with `onRunOutcome` from the same `onModuleInit`: a
**success** (from any action that is not itself `alerts-*`) triggers `evaluateSignalRules()` +
`evaluateGoals()`; a **failure** ingests a `run.error` event keyed on the run id.

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
fields, and the goal id as its subject. A rule in `box.json features.alerts.rules` matches these
kinds for delivery; without a rule they still land durably in `events`.

## Procedures and tools

`AlertsController` (`@Controller('alerts')`, class-level `@UseGuards(AuthGuard)`):

| tRPC | MCP | what |
|---|---|---|
| `alertsList` (query) | `alerts-list` | the recorded feed, newest first, capped at 200. Read-only: feed writes happen inside the `alerts-*` actions |
| `alertsRules` (query) | `alerts-rules` | the rule set as read from `box.json features.alerts.rules` |
| `alertsRulesSave` (mutation) | `alert-rule-save` | create or replace one rule by id, validated, written back to the file |
| `alertsRulesDelete` (mutation) | `alert-rule-delete` | remove one rule by id |

The save/delete mutations edit the JSON file in place. There is no rules table and no restart: the
file is re-read on every evaluation, so an edit applies to the next event.

## Actions (core's run funnel)

| id | group | what |
|---|---|---|
| `alerts-reddit` | Alerts | browser-free unread-feed poll, ingest, then one batched flush |
| `alerts-github` | Alerts | conditional poll of the participating notifications inbox (free `304`s, honors `X-Poll-Interval`, protocol state in `kv_state`) |
| `alerts-linkedin` | Alerts | comments on published pieces: official API for org posts, the author's logged-in Chrome for member posts (at most hourly) |
| `alerts-traction` | Alerts | trailing-hour engagement per subject against the tier ladder (default `[10, 25, 50, 100, 250]`), one `traction.spike` per (subject, tier) |
| `alerts-digest` | Alerts | 24h recap of `notify: "digest"`-class events, one card per route, deduped per (route, date) |

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
  rule and not of where it sends. So a suppressed alert on an unmappable route records `suppressed`
  rather than `error`: the rule was in its quiet window either way.
- **A failed send stays `error` and is never auto-retried.** Only `pending` rows are picked up, so
  re-running a flush - or a whole evaluator - can never double-send. Same idempotency argument as
  `recordAlerts()`'s conflict-free insert, one layer out.

Two evaluator windows worth knowing before you put them on a cron: `alerts-traction` counts the
trailing `WINDOW_MIN = 60` minutes, so an hourly schedule makes the windows abut exactly and any
drift leaves either a gap or an overlap - a tighter cron is the safe direction. `alerts-digest`
reads the trailing 24h and **sends nothing at all on an empty day**, so silence from it is a
working digest rather than a broken one.

## UI

- **Settings**: `Alerts`, icon `Bell`, order **810**, with Rules (`#settings/alerts/rules`) and
  History (`#settings/alerts/feed`) sub-pages. Rule create/edit and confirmations occupy the pane.
- **Legacy routes**: `/alerts` redirects to alert history in Settings over Dashboard;
  `/settings/rules` remains a supported alias. There is no Alerts entry in the application sidebar.
- **Shell topbar / slots / onSession**: none.
- The feed store polls itself every 10s while any row is still `pending`, and reloads on the change
  feed for `table:alerts` + `table:events`; the rules store reloads on `config:alerts.json`.

## Settings

The feature reads no environment variables. Two settings change runtime behaviour:

- `features.alerts.larkCli` (`lark.ts`) - the `lark-cli` binary, defaulting to `lark-cli` on `PATH`. Delivery
  shells out to it; a non-zero exit is recorded as the alert row's `error`.
- `server.dashboardUrl` (via `engagement`'s `dashboardUrl()`) - unset means Lark cards carry no
  "Open in dashboard" button.

GitHub polling takes its token from core's credential store (`requireCredentials('github', <default
account>, 'GH_TOKEN')`), not from an environment variable.

## What a team customises

1. **The rules** - `box.json features.alerts.rules`, through Settings -> Rules or
   `alert-rule-save`. A rule is `{ id, event, route, message, enabled }` plus the optionals
   `cooldown_min`, `debounce_sec`, `notify`, `signal_id`, `threshold`, `tiers`. `validateAlertRule`
   is strict: kebab-case ids, and a route must be `owner`, `channel`, `user:<id>` or
   `chat:<room-slug>`. A missing file means "no rules configured" - the feature is dormant, not
   broken.
2. **Routing** - `box.json features.alerts.routing` maps each route string to a Lark target
   (`receive_id` + type) with a `fallback`. An unmapped route that no transport claims records a
   delivery error rather than vanishing.
3. **Which evaluators run** - the five actions are schedulable through `automation`. A team with no
   LinkedIn presence simply never schedules `alerts-linkedin`.
4. **The vocabularies** - `types.ts` (`notify`, the route grammar, the status set), `cards.ts`
   (`titleFor` per event kind, the header colour classes, `BATCH_LIST_MAX = 10`), `traction.ts`
   (`ENGAGEMENT_KINDS`, `WINDOW_MIN = 60`, `DEFAULT_TIERS`), `digest.ts` (`KIND_LINE`, the 24h
   window), `flush.ts` (`DEFAULT_DEBOUNCE_SEC = 300`). These are the team's language; the titles
   and nouns in them are still the predecessor's.
5. **Labels and order** - nav label and band 810, settings section label and order.

## A naming collision to know about

`docs/core/SEAM.md` section 8 flags it: alerts' `evaluate.ts` / `evaluateSignalRules` /
`evaluateGoals` / `evaluateTraction` share the words `verify` and `evaluate` with
`content`'s publishing gate (`content/verify`) and `engagement`'s browser verification of
engagements (`pods/verify`). Nothing is broken - the modules live in different features - but "the
verify step" and "the evaluator" are ambiguous in conversation and in search. The open point
proposes renaming the engagement one (`engagement/verify-actions.ts`); it has not been done.
