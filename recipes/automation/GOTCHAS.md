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
