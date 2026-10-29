# Adapting the `planning` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/planning/`; the reference implementation is fetched from the recipe registry as `features/planning/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box recipe fetch planning`.

**Builds on:** core only (its signals, measures and saved views). Resolve imports from the Box's source tree and root workspace dependencies.

**Powerups.** The base is initiatives and their nested tasks. Ask the owner which powerups to add
now; each can be added later from its own folder:

- [goals](./powerups/goals/POWERUP.md): goals with an optional measured target, cycles, an
  initiative's contributed goals.
- [milestones](./powerups/milestones/POWERUP.md): the milestone item kind, measured by its tasks or
  a signal, outcome cards and initiative health.
- [sprints](./powerups/sprints/POWERUP.md): sprints with per-person capacity, the planning grid and
  the stand-up board.
- [timeline](./powerups/timeline/POWERUP.md): the Timeline layout of the Initiatives board.
- [cycle-board](./powerups/cycle-board/POWERUP.md): a cycle's goals and initiatives laid out as
  one board; requires goals (its POWERUP.md names the rest).
- [mobile](./powerups/mobile/POWERUP.md): the Plan tab of the Box mobile app; requires the Mobile
  app recipe.

The reference code carries all of them. Copy or adapt the base from
`<fetched recipe>/features/planning/` into the Box's `features/planning/{core,server,web}`, leaving
out what [INSTALL.md](./INSTALL.md) ("Base and powerup files") assigns to a powerup the owner did not
choose, then follow each chosen powerup's INSTALL.md. Preserve runtime contracts, registrations,
dependency order, and package manifests. Adapt imports to the consolidated layout. Record the
fetched version and sha256 in the `recipes` ledger of `box.json`, with each verified powerup in
`recipes.planning.powerups`, the path mapping and skipped powerups in the Box's `docs/UPSTREAM.md`,
and the active scope and state in `_docs/INTEGRATION.md`.

The reference `core/manifest.ts` declares no migrations: a fresh Box gets its tables from the
ModelSpecs. A Box that already runs planning preserves its applied migration identities and bodies
exactly; new schema behavior gets a new migration. Back up data before applying any migration,
stage its runner and registration first, and verify migration completion and boot compatibility on
a disposable restored instance before continuing.

## 2. Customise for the team

Every vocabulary edit below is a plain source edit. **An enum edit needs no migration until a Box
has shipped with the old set** - once rows exist carrying the old value, add a migration that
rewrites those rows, or the enum check on the column will refuse them. Planning's migrations are
the `migrations` list in `features/planning/core/manifest.ts`: append-only, one table-altering
statement each. The powerups add their own vocabulary; each POWERUP.md says where it lives.

1. **Statuses** - `features/planning/core/types.ts`: `PLANNING_STATUSES` (one list for
   initiatives AND tasks) and `TERMINAL_PLANNING_STATUSES`. Mirror the change in
   `features/planning/web/planning-types.ts` (`PLANNING_STATUSES`, `PLANNING_STATUS_META`
   labels and tones) and `features/planning/web/components/status.tsx`
   (`PLANNING_STATUS_UI` icons and colors). A feature that depends on planning may import this
   list, so the edit reaches its records too.
2. **Initiative kinds** - do NOT edit these in code. They are tenant config
   (`box.json features.planning.initiativeKinds`): open Settings -> **Initiative kinds** in the
   dashboard, or call `bun run cli initiative-kind-save`. Edit
   `features/planning/core/kinds.ts` only to change the SEED
   (`INITIATIVE_KIND_SEED`) before a Box's first write, or `DEFAULT_INITIATIVE_KIND`. An id is
   immutable once created; `planning.tasks_done` signals filtered by `kind` name it.
3. **Impact, effort and priority** - `IMPACT_LEVELS`, `EFFORT_SIZES` and `PRIORITIES` in
   `types.ts`, and `quadrantOf` for the impact x effort quadrant. Four steps per axis and three
   priority steps are deliberate; widening any is an enum edit, see the note above.
4. **Estimates** - `MIN_TASK_HOURS` / `MAX_TASK_HOURS` / `TASK_HOURS` in `types.ts` (a whole-hour
   scale, clamped not rejected). An initiative's `effort` is set by hand; the sum of its tasks'
   hours shows beside it.
5. **Nav and settings** - `features/planning/web/index.tsx`: labels, icons and order
   (band 200-299). Retitle "Initiatives" to whatever this team calls a body of work.
6. **Measures** - `planning.tasks_done { kind?, initiative?, since? }` in
   `features/planning/core/measures.ts` is planning's in-Box measure (registered by
   `PlanningModule`). A team counts its own kind of finished work by binding a signal to it with a
   `kind` or `initiative` param, not by editing code. A team that wants another calculation
   registers its own measure from its own feature (`registerMeasure`, see docs/SIGNALS.md, "In-Box
   measures").

There is no `env` to set.

## 3. Prove it

```bash
box dev
```

Open `http://localhost:8190/initiatives`: the grid renders (empty is fine). Create an initiative,
give it a kind, an impact and an effort (the quadrant shows), add a task, drag it to reorder, nest
a second task under it, and open the task at
`http://localhost:8190/initiatives/<initiative key>/<task key>`. Type into the doc editor - it
autosaves, and the one-line summary under the title on the board becomes the doc's first paragraph.
Check `data/docs/initiatives/<initiative key>/<task key>.md` on disk: the file is really there.
Close the nested task, check the panel offers to complete its parent, finish both and check the
initiative's progress moves.

Then `http://localhost:8190/tasks`: every task is listed. Create a task with **New task** on **No
initiative**, check the **No initiative** filter shows only it, open it (the right panel, at
`/tasks/<key>`), move it into an initiative with `task-move` and back out (the Initiatives grid also
drags an item between initiatives). On a narrow screen the panel is a push view. Check its doc at
`data/docs/tasks/<key>.md`.

Open Settings -> **Initiative kinds**: add a lane, then try to delete one that has initiatives in
it - it must refuse.

In a base-only Box, check that nothing names a left-out powerup: no Goals or Sprints nav entry, no
Timeline layout, no milestone switch in the panel.

Agent-side, the same operations are MCP tools:

```bash
bun run cli initiatives-get
bun run cli tasks-get
bun run cli initiative-upsert
bun run cli task-upsert
bun run cli task-set-status
bun run cli task-move
bun run cli doc-read
bun run cli doc-save
bun run cli initiative-kinds
```

Core's `measures-list` lists `planning.tasks_done`. See SPEC.md for the full list, and each
powerup's POWERUP.md for the tools it adds.

## 4. Adapt or remove

To update this feature, compare the target Box with the version recorded in the `recipes` ledger of `box.json` (fetch it with `box recipe fetch planning --version <that version>`), preserve local customizations, and apply the relevant source changes manually, for the base and for each powerup in `recipes.planning.powerups`. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove one powerup, follow the Remove section of its INSTALL.md. To remove the recipe, remove
every powerup first (each one's Remove), then delete the feature's `core`, `server`, and `web`
source directories only after checking runtime imports and dependent features. Preserve team data
and configuration unless the team explicitly chooses to remove them. Run the target Box's normal
build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
