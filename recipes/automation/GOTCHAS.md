# automation gotchas

Triggers live in the `triggers` table and `background.automation` must be `true` in `box.json` to arm them. Edits apply at once; do not arm timers against production data during integration.

The feature id (`automation`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **`features.automation.schedules` is imported once, then ignored.** Migration
  `automation:001-import-schedules` copies it into `triggers` on the first boot with triggers. Edits
  to the key afterwards do nothing; the boot log warns while it is present. Remove it.
- **Imported triggers have no owner.** The first admin to edit one becomes its owner.
- **Cron is evaluated in the trigger's zone.** Empty means the server's zone, which on a launchd
  host is the machine's; set the zone explicitly when the team and the host differ.
- **`service-restart` restarts nothing by itself, and this template ships no supervisor.** The
  implementation is `process.exit(86)`; something outside the process has to respawn it (a launchd
  KeepAlive agent, a systemd `Restart=on-failure`, a container policy). The docstring named a
  launchd plist that does not exist here; corrected 2026-09-13. `RestartServerButton` still talks
  about `logs/server.log`, which is whatever the supervisor redirects to.
- **`restart` refuses while an agent session is mid-turn**, returning `ok:false` with the session
  ids. That refusal must be surfaced, not polled through - the UI would otherwise find the
  un-restarted server answering instantly and reload as if it had worked. `force: true` overrides
  it, and those turns are lost.
- **A busy action is skipped, not queued.** On fire, the scheduler checks `isActionBusy()` and, if
  the action is already queued or running, writes a `skipped` run row instead of stacking a second
  execution. Core's funnel is FIFO with concurrency 1 (the warehouse is single-writer).
- **An event listener never awaits the work.** `recordEvent` awaits its listeners and is often
  called from inside a funnel run; awaiting a second funnel run there would wait on the single slot
  forever. The dispatcher queues the event and starts the run detached.
- **An action trigger does not fire on its own action's events.** While the action runs, it is
  busy, so an event it records skips the trigger (a `skipped` row). A loop through two actions is
  stopped by the chain depth instead.
- **Agent MCP calls carry no chain depth.** Events an agent run records through Box MCP tools have
  no `fields.depth`, so a loop through an agent prompt is only stopped by the daily cap (default 50
  a day). Keep agent event triggers narrow (filters, a gate) and their caps low.
- **The daily cap counts UTC days**, whatever the trigger's zone, and only stops event fires.
  At the cap one `skipped` row is recorded per trigger and day; later events leave no row. Gate
  declines count toward it (they spent a job), guard skips do not.
- **Timers are armed outside the event chain** (`outsideEventChain`). Any long-lived timer a
  feature arms from inside a run should do the same, or it inherits that run's chain depth.
- **Deliveries run inside the listener.** A deliver trigger is handed to the registered runner
  while `recordEvent` awaits its listeners (it only records an alert row, never a funnel run), so a
  poll that records a batch finds every alert recorded before it flushes. Everything else is
  queued.
- **Ports are registered at module init.** `registerDeliverRunner` and `registerTriggerCheck` are
  called from a dependent's `onModuleInit`; a CLI or test that never boots that module sees no
  runner, so deliveries are listed invalid there. That is expected.
- **A sample event bypasses the guards.** `trigger-run` with `event` runs regardless of kind,
  filters, cap or busy state, and only reports whether the filters would have matched.
- **Agent runs do not queue behind actions.** They are WorkerDeck jobs with their own queue
  (`workerdeck.queue.maxConcurrency`, default 1), not funnel runs, so a long agent job never holds
  the single action slot. A time fire while the trigger's previous run is in flight is skipped.
- **An approval request on an agent run is denied, not waited on.** Nobody can answer it, so the
  dispatcher denies that call, reports it, and the run carries on. Under `auto` the classifier
  escalates risky calls this way (seen for `rm -rf` outside the project). Only a request that cannot
  be answered cancels the run. Allow needed tools in the run_as profile's settings.
- **A denied tool call does not fail the run.** Under `auto` the classifier can refuse a call and the
  model carries on; the run's status still comes from the success marker. Read the run's
  "Permission denials" panel (or the `agent.permission_denied` diagnostics) after moving a job in,
  and give important jobs a marker the prompt only prints when the work is really done.
- **A restart loses agent jobs.** The job queue is in-memory; the boot sweep marks their runs
  `orphaned by server restart`. `service-restart` refuses while a job session is mid-turn.
- **`run_as` is checked at fire time too.** A user demoted from admin since the trigger was saved
  makes the run fail to start (manual Run now answers 400; a timed fire logs it).
- **Timed runs are attributed to the system principal** (`systemUserId()`) and to their trigger
  (`trigger_id`), not to the owner: nobody pressed Run.
- **Invalid triggers are surfaced, not fatal.** On each load, `triggerProblem()` checks every row
  softly: an action that disappeared with its feature logs a warning and leaves that one unarmed,
  listed as invalid. The upsert is the loud half - it throws with the reason.
- **`background.automation` must be the boolean `true`.** It defaults to `false`; any other type fails configuration loading.
- **Trigger writes, `trigger-run` and `service-restart` are admin-only** (`@Admin()`, read by
  `AuthGuard`). The agent reaches them when its configured role is admin (the fresh-Box default) and
  must name the admin it acts for in `owner`. Choose member in host config to restore that boundary;
  see [the role contract](../../docs/AUTH.md#agent-identity-and-role).
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope there, and load the app in a browser after touching it (`AGENTS.md`) - `box verify`
  has no runtime step.
- **Far-future fires.** `setTimeout` clamps at 2^31-1 ms, so `arm()` caps the delay and re-arms.
  A rare cron does not silently fire immediately.
- **`docs/AUTOMATION.md` is gone (2026-09-13).** It described `packages/core/src/automation/` and
  `apps/server/src/automation/`, paths the feature split replaced, and the durable half of it now
  lives in this recipe's `SPEC.md` (`recipes/automation/SPEC.md`). The two comments in this feature that cited it point there.
- **One Box per relay Worker.** The Worker keeps one connection; a second client closes the first
  with code 4000, and the displaced Box waits five minutes before trying again. A dev checkout or a
  restored copy of a production Box keeps `background.relay` false.
- **Rotating `HOOK_KEY` changes every hook URL.** Every sender has to be updated; rotate the client
  token instead when only the Box's credential leaked.
- **The relay never validates payloads.** It stores raw bytes and headers (minus `authorization`,
  cookies and transport headers). A sender's signature is checked on the Box by its provider, so a
  provider that signs must see the exact bytes: never re-encode a body before `verify`.
- **Delivery is at least once.** A crash between recording and the ack replays the envelope; the
  ledger row (keyed by envelope id) acks the replay without work, and the events table dedups by
  `dedup_key`. A provider takes the dedup key from the sender's own event or delivery id, never the
  envelope id, so a sender's retry is not a second event.
