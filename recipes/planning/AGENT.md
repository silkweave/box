# Adapting the `planning` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/planning/`; the reference implementation lives in the Stack at `features/planning/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** data. Adapt those recipes first; their features must already be registered in the target Box. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/planning/` into the Box's `features/planning/{core,server,web}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

Preserve the existing 001-sprint-tasks identity and body exactly. New schema behavior gets a new migration. Back up data before applying any migration, stage its runner and registration first, and verify migration completion and boot compatibility on a disposable restored instance before continuing.

## 2. Customise for the team

Every vocabulary edit below is a plain source edit. **An enum edit needs no migration until a Box
has shipped with the old set** - once rows exist carrying the old value, add a migration that
rewrites those rows, or the enum check on the column will refuse them. `planning` has no
`migrations.ts` yet: create one exporting `MIGRATIONS` (append-only, starting at `001`) and point
the manifest's `migrations` at it.

1. **Statuses** - `features/planning/core/types.ts`: `PLANNING_STATUSES` (one list for
   initiatives AND tasks) and `TERMINAL_PLANNING_STATUSES`. Mirror the change in
   `features/planning/web/planning-types.ts` (`PLANNING_STATUSES`, `PLANNING_STATUS_META`
   labels and tones) and `features/planning/web/components/status.tsx`
   (`PLANNING_STATUS_UI` icons and colors). If `content` is installed, it imports this list - the
   edit reaches content's pieces too.
2. **Sprint statuses** - `SPRINT_STATUSES` in the same `types.ts`, mirrored in
   `features/planning/web/sprint-types.ts`. Changing the order changes which tab opens for
   a sprint (`SprintDetailView` picks from the status).
3. **Initiative kinds** - do NOT edit these in code. They are tenant config
   (`<BOX_DATA_DIR>/box.json features.planning.initiativeKinds`): open Settings -> **Initiative kinds** in the
   dashboard, or call `bun run cli initiative-kind-save`. Edit
   `features/planning/core/kinds.ts` only to change the SEED
   (`INITIATIVE_KIND_SEED`) before a Box's first write, or `DEFAULT_INITIATIVE_KIND`. An id is
   immutable once created; `oss-pr` is read by name by the derived signal in `state.ts`.
4. **Value levels and priority** - `VALUE_LEVELS` and `PRIORITIES` in `types.ts`. Three priority
   steps and four value buckets are deliberate; widening either is an enum edit, see the note above.
5. **Estimates** - `MIN_TASK_HOURS` / `MAX_TASK_HOURS` / `TASK_HOURS` in `types.ts` (a whole-hour
   scale, clamped not rejected) and the display buckets `EFFORT_HOURS` / `EFFORT_META` /
   `EFFORT_HINT` in `features/planning/web/planning-types.ts`. An initiative has no size
   column - `features/planning/web/lib/effort.ts` sums its tasks.
6. **Sprint capacity** - `DEFAULT_SPRINT_HOURS` in `types.ts` (5, not 8, and the reason is written
   there) and `UNDER_UTILISATION_RATIO` in `features/planning/core/sprints.ts`.
   Weekend handling lives in `capacityOn` / `isWeekend` in the same file.
7. **Check-in buckets** - `CHECKIN_BUCKETS` is declared in TWO places,
   `features/planning/core/state.ts` and
   `features/planning/web/sprint-types.ts`. Change both or the server will refuse a bucket
   the Board renders.
8. **Nav and settings** - `features/planning/web/index.tsx`: labels, icons and order
   (band 200-299). Retitle "Initiatives" to whatever this team calls a body of work.
9. **The derived signal** - `SILKWEAVE_PRS_SIGNAL_ID` and `computeSilkweavePrRows` in
   `features/planning/core/state.ts` hard-code `github.silkweave_prs_merged` over the
   `oss-pr` kind. A team that does not do OSS PRs should either repoint this at their own
   kind + signal or delete the hook from `PLANNING_SIGNAL_HOOKS` (and with it the
   `deriveOssPrSignals()` calls in the task mutations).

There is no `env` to set.

## 3. Prove it

```bash
box dev
```

Open `http://localhost:8190/initiatives`: the grid renders (empty is fine). Create an initiative,
give it a kind and at least one bound signal, add a task, drag it to reorder, and open the task at
`http://localhost:8190/initiatives/<initiative>/<task>`. Type into the doc editor - it autosaves,
and the one-line summary under the title on the board becomes the doc's first paragraph. Check
`<BOX_DATA_DIR>/docs/initiatives/<initiative>/<task>.md` on disk: the file is really there.

Then `http://localhost:8190/sprints`: create a sprint, set its dates and per-person availability
on the **design** tab, slot tasks onto days on **planning**, and try to move it to `planned` while a
day is over capacity - it must refuse with a message naming the worst day. On **board**, tick a
stand-up bucket and complete the day.

Open Settings -> **Initiative kinds**: add a lane, then try to delete one that has initiatives in
it - it must refuse.

Agent-side, the same operations are MCP tools:

```bash
bun run cli initiatives-get
bun run cli initiative-upsert
bun run cli task-upsert
bun run cli task-set-status
bun run cli doc-read
bun run cli doc-save
bun run cli sprint-get
bun run cli sprint-upsert
bun run cli initiative-kinds
```

(19 tools in all - see SPEC.md for the full list.)

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
