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
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope there, and load the app in a browser after touching it - `box verify` has no runtime
  step (`AGENTS.md`).
- **After a controller change, boot once (or `bun run typegen`)** so `appRouter.d.ts` is rewritten, or
  the web typecheck is stale and the new procedure does not exist as far as the SPA is concerned.
- **Dev ports are Nest 8190 / Vite 5190.** A second Box gets its own `server.port` / `server.vitePort` and
  never a neighbour of the first's: two Boxes a default apart either collide loudly or sit beside
  each other on different address families and get mistaken for one another
  (`apps/server/src/agent/loopback-guard.ts`).
