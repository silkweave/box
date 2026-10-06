# alerts gotchas

The rules are deliver triggers in the warehouse and delivery errors are recorded rather than thrown. Verify routes and notifications wiring before diagnosing the event evaluator.

The feature id (`alerts`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **A fresh Box has no deliver triggers**, so the feature is silently dormant. That is correct
  behaviour, not a bug - but it is also the first thing to check when "alerts do nothing". The
  second: `background.automation` must be `true`, or no trigger fires, deliveries included.
- **`features.alerts.rules` is imported once, then ignored.** Migration `alerts:001-import-rules`
  copies the rules into `triggers` on the first boot with this version; later edits to the key do
  nothing (boot warns while it is present). `features.alerts.routing` and `larkCli` are not read:
  there is no Lark delivery.
- **A signal trigger without its filters is refused**, whatever it does: the evaluator learns which
  signal (and threshold) to watch only from `fields.signal_id` / `fields.threshold`.
- **`ingestEvent` never throws, and neither does the runner.** Both swallow their errors by design
  so alerting cannot break its own trigger. A dropped alert leaves no exception anywhere: look at
  the `events` table and the history's `error` column instead.
- **Delivery only picks up `pending`.** A row that failed stays `error` and is never retried
  automatically. Re-running an evaluator does not resend it either, because the
  `(rule_id, dedup_key)` insert is a no-op (`rule_id` is the trigger id).
- **Debounce is also max-hold.** The first arrival fixes the flush time; later arrivals never
  extend it. Poll actions call `flushAlertsNow()` themselves, so their batch does not wait.
- **The flush timer is `unref`'d.** A script or test that records alerts and exits sends nothing
  unless it calls `flushAlertsNow()` before exiting.
- **Every route needs `notifications` installed.** A `chat:` route (and `channel` / `owner`,
  which land in `features.alerts.channelRoom`) needs the room to exist; a `user:` route needs an
  active user. The transport throws otherwise, which records the alert as `error` on purpose
  rather than losing it.
- **Never import `notifications` from here.** The dependent registers into `registerAlertTransport`
  from its own `onModuleInit`; alerts must stay unaware of it. No check enforces this, so review imports when changing alerts.
- **After a controller change, boot once** so typegen rewrites `appRouter.d.ts`, or the web
  typecheck is stale (`AGENTS.md`). `box verify` runs `typegen` for you.
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope there, and load the app in a browser after touching it.
- Ports are Nest **8190** / Vite **5190**. A second Box needs its own `server.port` / `server.vitePort`, not
  a neighbour of those - see `apps/server/src/agent/loopback-guard.ts` for why a near-miss is worse
  than a collision.
