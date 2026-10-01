# automation gotchas

Schedules are read at boot and `background.automation` must be `true` in `box.json` to arm them. A config edit needs a supervised restart; do not arm timers against production data during integration.

The feature id (`automation`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **Config edits never hot-reload.** `SchedulerService` reads `box.json features.automation.schedules` once in
  `onApplicationBootstrap` and keeps the snapshot. An edit only flips `restartRequired` (a canonical
  comparison that ignores key order and entry order, so a reformat is not a change). Restart to
  apply - and a restart on a dev checkout run under `box dev` does not come back: the
  implementation is `process.exit(86)` and it expects a supervisor with
  `KeepAlive.SuccessfulExit=false` to respawn it.
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
- **Scheduled runs are attributed to the `nova` system principal** (`systemUserId()`), not to null -
  otherwise the "who ran this" column in the run list is blank.
- **Invalid entries are surfaced, not fatal.** At boot, `scheduleProblem()` checks each entry softly:
  a bad cron or an unknown action logs a warning and leaves that one unarmed. The upsert mutation is
  the loud half - it throws with the reason.
- **`background.automation` must be the boolean `true`.** It defaults to `false`; any other type fails configuration loading.
- **Schedule writes and `service-restart` are admin-only, and now really are** - `@Admin()`, read
  by `AuthGuard`, on 2026-09-13. Between 2026-09-10 and then the docstrings claimed it and nothing
  enforced it, so any signed-in principal could restart the service. The agent can reach these when
  its configured role is admin (the fresh-Box default). Choose member in host config to restore
  that boundary; see [the role contract](../../docs/AUTH.md#agent-identity-and-role).
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope there, and load the app in a browser after touching it (`AGENTS.md`) - `box verify`
  has no runtime step.
- **Far-future fires.** `setTimeout` clamps at 2^31-1 ms, so `arm()` caps the delay and re-arms.
  A rare cron does not silently fire immediately.
- **`docs/AUTOMATION.md` is gone (2026-09-13).** It described `packages/core/src/automation/` and
  `apps/server/src/automation/`, paths the feature split replaced, and the durable half of it now
  lives in this recipe's `SPEC.md` (`recipes/automation/SPEC.md`). The two comments in this feature that cited it point there.
