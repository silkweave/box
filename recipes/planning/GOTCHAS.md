# planning gotchas

Statuses and initiative kinds are team vocabulary. Preserve local values and add a new migration before changing stored enums.

The feature id (`planning`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

Each powerup's gotchas live in its POWERUP.md (`powerups/<id>/`).

## Recipe-specific operational details

- **The reference code is the full feature.** A base-only Box leaves out the files and seams that
  INSTALL.md assigns to powerups. A left-out seam usually fails the typecheck, but a module-scope
  import of a removed file can also surface only at runtime: load `/initiatives` and `/tasks` in a
  browser after trimming.
- **Keys come only from `allocateKey`** (`features/planning/core/state.ts`): `I<n>` for initiatives,
  `T<n>` for items, from the `planning_keys` counter. A key is never reused and never changes, and
  there is no rename. Do not build an id by hand or add a path that writes a row without it.
- **`task-move` writes only `initiative_id`, `parent_id` and `rank`** (for the item and its subtree),
  so a new column cannot be nulled by a move. Keep it that way.
- **`summary` is derived, not typed.** `savePlanningDoc` is its only writer. Do not add a summary
  input to `taskUpsert` / `initiativeUpsert`: two fields for one prose drift apart.
- **Doc paths are built only from validated keys**, then re-checked to stay inside `docs/`
  (`docs.ts` `absPath`). If you add an operation on a doc, route it through that module rather than
  joining a path yourself - it is the feature's only filesystem security surface.
- **The MCP tool names `doc-read` and `doc-save` are generic.** They are planning's docs, not the
  Box's docs, and they share the flat MCP namespace with every other feature - `typegen` will fail
  loudly on a collision, but pick a scoped name if you add another doc tool.
- **`initiative_id IS NULL` means a standalone item.** Its doc is `docs/tasks/<key>.md`. Use
  `isStandaloneTask`. `~` is only the All tasks "In" filter value and the `to_initiative_id` meaning
  "no initiative", never an id.
- **An item's doc needs the item to exist first.** `doc-save` refuses an item doc for a missing
  item, so write the row, then the doc. A `task-move` refuses before it changes anything when a doc
  already exists at the destination; docs move all-or-nothing, then the rows are written in one
  transaction, and a failed transaction moves the docs back.
- **Work items come from one helper** (`workItems` in `core/items.ts`): live `kind = task` leaves,
  through the kind registry (`itemKindSpec(...).countsAsWork`). A parent task counts as the sum of
  its children and its own estimate is ignored. Dropping an item drops its whole sub-tree from
  every count, so progress, `planning.tasks_done`, done counts, the dashboards and the powerups
  must not re-derive the rule.
- **`tasks.kind` stays in a base-only Box.** Every row is `task`; `workItems`, `measures.ts` and the
  cycle-board's initiative card read it. Do not drop the column to slim the base.
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope there, and load the app in a browser after touching it - `box verify` has no runtime
  step (`AGENTS.md`).
- **After a controller change, boot once (or `bun run typegen`)** so `appRouter.d.ts` is rewritten, or
  the web typecheck is stale and the new procedure does not exist as far as the SPA is concerned.
- **Dev ports are Nest 8190 / Vite 5190.** A second Box gets its own `server.port` / `server.vitePort` and
  never a neighbour of the first's: two Boxes a default apart either collide loudly or sit beside
  each other on different address families and get mistaken for one another
  (`apps/server/src/agent/loopback-guard.ts`).
