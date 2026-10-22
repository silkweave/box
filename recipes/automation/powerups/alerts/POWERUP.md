# Alerts

Event triggers that deliver: when an event matches, a deduplicated alert goes out in one batched message to the person or chat room that should know, and the quiet activity is recapped in a daily digest.

## Highlights

- "Deliver a message" as the Do of an event trigger, on any event kind, with filters and routes to a person, a chat room, the alerts room or a signal's owner
- A deduplicated alert ledger: re-evaluating the same event never sends twice
- Debounced, batched delivery: one message per target, with a per-trigger cooldown and debounce
- Delivery through registered transports (the Notifications recipe adds Team Box chat rooms and direct messages)
- A daily digest (`alerts-digest`) for the kinds that should not page anyone one by one
- An alert history in Settings > Automation > Alerts, with each alert's delivery outcome

## Needs

- The Automation recipe
- The [Notifications](../../../notifications/RECIPE.md) recipe for delivery into chat rooms and direct messages: it registers the `chat` and `dm` transports. Without a transport every alert records an error naming its route
- A chat room for the alerts room (`automations` unless the owner picks another)

## How it works

The rules are **deliver triggers**: rows of automation's `triggers` table with `when_kind = event`
and `do_kind = deliver` (recipes/automation/SPEC.md). The powerup registers itself as automation's
deliver runner. When an event passes a deliver trigger's kind, chain depth and filters, the runner
renders the message, records one `pending` row in the `alerts` ledger, and a debounced flusher sends
every pending row as one message per target through the transport that claims the route.

Source: `features/automation/core/alerts/` (ledger model, runner, flusher, routes, transport port,
digest), `features/automation/server/alerts/` (`AlertsModule`, `AlertsController`) and
`features/automation/web/alerts/` (the Alerts tab).

### The deliver fields

`route`, `message`, `notify`, `cooldown_min` and `debounce_sec` on the trigger.

- **Route.** `user:<id>` (a direct message from the agent), `chat:<room-slug>` (a post in that room),
  `channel` (the alerts room) or `owner`. On a `signal.*` event with `fields.signal_id`, `owner`
  becomes `user:<owner>` through core's signal owners (`signals.owners`: signal override, channel
  default, account binding; docs/SIGNALS.md). Anywhere else, or unowned, `owner` goes to the alerts
  room. A route may carry `{{path}}` placeholders, checked when the alert is delivered.
- **Message.** `{{path}}` placeholders (automation's `renderTemplate`), then `{field}` tokens filled
  from the event's flat `fields`. Unknown tokens stay intact, which is how you discover field names.
- **Notify.** Null or `realtime` sends each event; `digest` records nothing per event and the daily
  digest counts it. A digest feed listens for one exact kind.
- **Cooldown and debounce.** Whole numbers (minutes, seconds). Automation refuses a delivery on a
  time, with a daily cap or with a gate.

Example, a run failure into the alerts room:

```json
{ "id": "run-failures", "name": "Run failures", "when_kind": "event", "event_kind": "run.error",
  "do_kind": "deliver", "route": "channel", "cooldown_min": 30,
  "message": "{action_id} failed: {error}" }
```

A trigger on `signal.increase` or `signal.threshold` picks its signal with the filter
`fields.signal_id` and a level with `fields.threshold` when it wants one; without filters it acts on
every signal.

### The ledger

Table `alerts`, primary key `(rule_id, dedup_key)`: the trigger id, the event kind, the route and
resolved `target`, the rendered `message` and `payload` JSON, `status` (`pending`, `delivered`,
`suppressed`, `error`), `event_at` / `created_at` / `delivered_at`, `error`, and `batch_id` (shared by
every row that went out in one message). `store.ts` is the only write path: `recordAlerts()` is an
`INSERT ... ON CONFLICT DO NOTHING ... RETURNING`, so re-evaluating the same event inserts nothing.
The events themselves live in core's `events` table.

### Delivery

`flush.ts` is the only path that sends. A pending row asks for a flush after its trigger's
`debounce_sec` (default 300). A pass checks each trigger's cooldown, resolves the route (`channel`
and an unresolved `owner` become `chat:<features.automation.alerts.channelRoom>`), and hands the
route to the first registered transport that claims it. Alerts are grouped per (transport, target)
and one `deliver()` call carries each group. Success marks the rows `delivered` with `target =
"<transport id>:<target>"` and a shared `batch_id`; a throw marks the group `error` with the
message; a route no transport claims records `error: no alert transport handles route "..."`.

- **The debounce window never extends.** The first pending row fixes the flush time and later
  arrivals join it, so `debounce_sec` is both the debounce and the longest hold. A request during a
  pass is honoured by exactly one follow-up pass (single-flight), so no row is sent twice.
- **The cooldown is checked before the route resolves.** A cooldown belongs to the trigger, so an
  alert in its quiet window records `suppressed` even on a route nothing claims.
- **A failed send stays `error` and is never retried automatically.** Only `pending` rows are picked
  up, so re-running a flush or an event source never double-sends.

The powerup registers its flusher as core's delivery flusher (`packages/core/src/event-ports.ts`).
An event source that just recorded a batch calls `flushDeliveries()` so the batch goes out now
instead of after the debounce; without the powerup the call does nothing.

The chat body (`message.ts`) is the message for one alert and one line per alert for several. When
a feature links the event kind to a page of its own (core's `eventLink`, used when
`server.dashboardUrl` is set), the body carries an
"Open in dashboard" link.

### The transport port

The powerup has no sink of its own. `registerAlertTransport({ id, matchRoute, deliver })`
(`transports.ts`) is where a dependent feature adds one, from its server module; registering the
same id twice throws. The Notifications recipe registers `chat` (`chat:<room-slug>`: one post as the
agent; an unknown room throws) and `dm` (`user:<id>`: one message in the agent's direct message with
that person, then pushed to their devices; an unknown user or the agent itself throws). The powerup
never imports its transports.

### Run now

`trigger-run` (admin) on a deliver trigger delivers a sample event at once, outside the debounce,
and answers with what happened: `delivered to chat:automations`, `suppressed: ...`, `delivery to
... failed: ...`, or `already recorded for ...` when the sample's dedup key repeats.

### The daily digest

`alerts-digest` (group Alerts) reads the trailing 24 hours of the kinds that deliver triggers with
`notify: digest` listen for, counts an event only when that feed's filters match it, groups by kind
and subject per route (the feed's route, placeholders rendered), and records one `digest.daily`
event per route with `date`, `route`, `summary` and `count`, deduped per (route, date). A deliver
trigger on `digest.daily` with route `{{fields.route}}` sends each recap where its feeds point. It
needs that trigger and at least one feed, and an empty day records nothing, so silence from it is a
working digest.

### Procedures

| tRPC | MCP | what |
|---|---|---|
| `alertsList` (query) | `alerts-list` | the ledger, newest first, capped at 200. Read-only |

The rules are edited with automation's `triggers-list`, `trigger-upsert` (with `do_kind: "deliver"`),
`trigger-delete` and `trigger-run`.

### Settings

- `features.automation.alerts.channelRoom` - the chat room slug `channel` and an unresolved `owner`
  deliver to; default `automations`. A value that is not a room slug fails delivery with that message.
- `server.dashboardUrl` - unset means chat alerts carry no dashboard link.
- `background.automation` - deliver triggers listen only while it is `true`; Run now works regardless.
- `signals.owners` (core) - resolves the `owner` route on a signal event.

### Without the powerup

Automation refuses a deliver trigger on write and lists a stored one invalid ("delivery needs the
alerts powerup of Automation"). Settings > Automation > Triggers shows a note naming the Alerts
powerup, with an "Add the Alerts powerup" Builder brief for administrators; members are told to ask
an administrator. The editor's "Deliver a message" option is disabled. Events are still recorded and
other triggers still act on them.

## Gotchas

- **A fresh Box has no deliver triggers**, so the powerup is dormant until the team creates one. The
  next thing to check when alerts do nothing: `background.automation` must be `true`.
- **The runner never throws.** A dropped alert leaves no exception: look at the `events` table and
  the history's `error` column.
- **The flush timer is `unref`'d.** A script or test that records alerts and exits sends nothing
  unless it calls `flushAlertsNow()` (or core's `flushDeliveries()`) first.
- **Every route needs a transport.** A `chat:` route (and `channel` / `owner`) needs the room to
  exist; a `user:` route needs an active user. The transport throws otherwise, which records the
  alert as `error` on purpose rather than losing it.
- **Never import a transport's feature from the powerup.** The dependent registers into
  `registerAlertTransport`; no check enforces it, so review imports when changing the powerup.
