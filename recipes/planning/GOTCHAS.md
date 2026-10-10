# planning gotchas

Statuses, capacity rules, and initiative kinds are team vocabulary. Preserve local values and add a new migration before changing stored enums.

The feature id (`planning`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **`rekeyTask` hand-writes its column list** (`features/planning/core/state.ts`). A
  column you add to the `TASKS` ModelSpec and forget there is silently nulled on every task MOVE and
  every RENAME. `models.ts` says so in capitals above `sprint_id` / `slot_date`; believe it.
- **`summary` is derived, not typed.** `savePlanningDoc` is its only writer. Do not add a summary
  input to `taskUpsert` / `initiativeUpsert` - the two-fields-for-one-prose problem is exactly what
  the derivation replaced on 2026-08-24.
- **Doc paths are built only from validated slugs**, then re-checked to stay inside
  `docs/initiatives/` (`docs.ts` `absPath`). If you add an operation on a doc, route it through that
  module rather than joining a path yourself - it is the feature's only filesystem security surface.
- **The MCP tool names `doc-read` and `doc-save` are generic.** They are planning's docs, not the
  Box's docs, and they share the flat MCP namespace with every other feature - `typegen` will fail
  loudly on a collision, but pick a scoped name if you add another doc tool.
- **A sprint delete releases tasks, it does not delete them.** Anything you add that removes a
  window over work must do the same.
- **A reach baseline is the level entering the window, not the bucket containing the start.** For a
  monthly signal and a window starting 2026-10-01 that is September's value; reading October's
  bucket would hand the goal its end-of-October level as the starting point. Set `baseline` on the
  goal only to override this deliberately.
- **An `increment` goal compares against the pace through yesterday.** Today's bucket is still
  filling, so counting it against a full day of pace would make every goal look behind each morning.
  A hold goal likewise skips the bucket still filling.
- **A window that cuts through weekly or monthly buckets counts by bucket start.** A straddling
  bucket is counted wholly or not at all, never prorated; the reading's `alignment` says so. Align
  the window to the signal's interval when the number matters.
- **Deleting a signal leaves its goals in place.** They report a missing signal (no reading) rather
  than disappearing; data's delete report names them as `goal:<id>`. Re-point with `goal-upsert
  signal_id`, or delete the goals. A signal rename re-points them for you.
- **Health suggests, people record.** Nothing sets `goals.outcome` automatically, and the goal events
  `goal.ended` event only carries a `suggested_outcome`.
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope there, and load the app in a browser after touching it - `box verify` has no runtime
  step (`AGENTS.md`).
- **After a controller change, boot once (or `bun run typegen`)** so `appRouter.d.ts` is rewritten, or
  the web typecheck is stale and the new procedure does not exist as far as the SPA is concerned.
- **Dev ports are Nest 8190 / Vite 5190.** A second Box gets its own `server.port` / `server.vitePort` and
  never a neighbour of the first's: two Boxes a default apart either collide loudly or sit beside
  each other on different address families and get mistaken for one another
  (`apps/server/src/agent/loopback-guard.ts`).
