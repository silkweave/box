# Milestones powerup: install

Adds the `milestone` item kind, its measure, windows and readings, outcome cards and initiative
health. Read [POWERUP.md](POWERUP.md), the recipe [SPEC.md](../../SPEC.md) and
[INSTALL.md](../../INSTALL.md) ("Base and powerup files") first. In the reference code every part of
this powerup is marked `milestones powerup`; grep for it. There are no owner-only steps.

## Detect

The Box has this powerup when `features/planning/core/items.ts` has a `milestone` entry in
`ITEM_KIND_REGISTRY`, `features/planning/web/components/OutcomeCards.tsx` exists, and
`MILESTONE_SIGNAL_HOOKS` is registered in `planning.module.ts`. A `tasks.outcome` column, or rows
with `tasks.kind = 'milestone'`, in the warehouse mean it was added before. `box.json`
`recipes.planning.powerups` lists `milestones` once it was verified. If it is there, this is an
update: compare against the version recorded in the `recipes` ledger instead of copying over local
changes.

## Requires

The Planning recipe, adapted and validated, recorded in the `recipes` ledger of `box.json`. It does
not require goals.

## Owner decisions

- Whether to add milestones now. Planning is complete without them.

## Owner-only steps

None.

## Steps

1. Run `box recipe fetch planning --version <the version in the recipes ledger of box.json>`.
2. **Files wholly owned**, copied from `<fetched recipe>/features/planning/`:
   `web/components/milestone.tsx` (the base already keeps `TaskMark`; merge rather than duplicate
   it) and `web/components/OutcomeCards.tsx`; and the shared target measurement, unless the goals
   powerup already brought it: `core/measure.ts`, `core/measure.test.ts`, the "target
   measurement" section of `core/types.ts` (`GoalHealth`, `GOAL_HEALTHS`,
   `DEFAULT_HEALTH_TOLERANCE`, and `GoalKind`, `GoalComparator` which `measure.ts` imports),
   `web/health.ts`, `web/components/HealthChip.tsx`.
3. **Seams in shared files** (each marked `milestones powerup`):
   - `core/models.ts`: `tasks.outcome`, `signal_id`, `measure_kind`, `target`, `baseline`; the
     `ITEM_KINDS` enum on `tasks.kind` back to `['task', 'milestone']`; the
     `MILESTONE_MEASURE_KINDS` import;
   - `core/types.ts`: `'milestone'` in `ItemKind` / `ITEM_KINDS`, `MilestoneMeasureKind`,
     `MilestoneState`, the milestone fields of `TaskRecord`, `ItemDerived` and `TaskInput`,
     `InitiativeWithTasks.health`, `'milestone'` in `assertTitleLength`;
   - `core/items.ts`: the milestone fields in `KindField` / `KIND_FIELDS`, the `milestone` entry
     of `ITEM_KIND_REGISTRY`, the measure rules in `assertKindFields`, the windows section, the
     derived reading section, the milestone parts of `deriveItems`, `worstHealth` and `health` in
     `initiativeReading`;
   - `core/state.ts`: `derive()` loading `signalReadings` and `healthTolerance()`; `windowsOf`,
     `scopeWindows`, `signalReadings`; the window checks in `upsertInitiative`, `upsertTask` and
     `moveTask`; the kind and measure blocks of `upsertTask`; the window pinning in `deleteTask`;
     `repointItemSignals`, `itemsReferencingSignal`, `MILESTONE_SIGNAL_HOOKS`;
   - `core/items.test.ts`: the milestone describes (windows, derived reading, switching kind,
     windows on write, deletes keep windows whole, signal-measured milestones);
   - `server/planning/planning.controller.ts`: `kind`, `outcome`, the signal measure fields and
     the derived reading on `TaskDto`, the same input fields on `UpsertTaskDto`, `health` on
     `InitiativeDto`, the measure mapping in `taskUpsert`;
   - web: `planning-types.ts` (`isMilestone`, the milestone types and fields, `Task.health`,
     `Initiative.health`), `lib/usePlanningData.ts` (milestone upsert fields, optimistic
     `outcome`), `components/ItemPanel.tsx` (`KindToggle`, `OutcomeStar`, `MeasureEditor`,
     `NumberInput`, the signal imports, the status and window hints, the kind control in
     `QuickAddChild`), `components/ItemTree.tsx` (the milestone branches),
     `views/InitiativesGrid.tsx` (the milestone branches of the status and task cells),
     `views/InitiativeDetailView.tsx` (`OutcomeCards`), `lib/planningView.ts` (the milestone clause
     of `applyView`), `lib/markdown.ts` (`names.signal`, the milestone line, `measure()`, Kind,
     State, inherited dates, Measure), `components/RecordMenu.tsx` (the signals lookup).
   - With the sprints powerup: `KindToggle` clears `sprint_id` / `slot_date` and calls
     `reloadSprint`.
4. **Register**: `registerSignalHooks(MILESTONE_SIGNAL_HOOKS)` in `onModuleInit` of
   `server/planning/planning.module.ts`, and `export * from './measure.js'` in `core/index.ts` if
   not there.
5. **Migrations.** A fresh Box needs none: the columns come from the `tasks` ModelSpec. A Box that
   already runs planning needs migrations appended to its `features/planning/core/manifest.ts`,
   with names the Box chooses (never one already applied in its ledger), one table-altering
   statement each:

   ```ts
   { name: '<nnn>-tasks-outcome', statements: ['ALTER TABLE tasks ADD COLUMN IF NOT EXISTS outcome BOOLEAN DEFAULT false'] },
   { name: '<nnn+1>-tasks-outcome-not-null', statements: ['ALTER TABLE tasks ALTER COLUMN outcome SET NOT NULL'] },
   { name: '<nnn+2>-tasks-signal-id', statements: ['ALTER TABLE tasks ADD COLUMN IF NOT EXISTS signal_id VARCHAR'] },
   { name: '<nnn+3>-tasks-measure-kind', statements: ['ALTER TABLE tasks ADD COLUMN IF NOT EXISTS measure_kind VARCHAR'] },
   { name: '<nnn+4>-tasks-target', statements: ['ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target DOUBLE'] },
   { name: '<nnn+5>-tasks-baseline', statements: ['ALTER TABLE tasks ADD COLUMN IF NOT EXISTS baseline DOUBLE'] },
   ```

   `tasks.kind` is base and needs nothing. Back up first (`box db backup`) and rehearse on a
   restored backup in a scratch checkout (docs/WAREHOUSE.md, "Working rules").
6. Run `bun run typegen`, then restart (`box app restart`).
7. Record the powerup, with the fetched version and sha256, in `recipes.planning.powerups` of
   `box.json` once Verify passes, and the session in `_docs/INTEGRATION.md`.

## Verify

1. On an initiative, add a milestone from a row's "+" (measured by tasks) with two tasks nested
   under it, finish both, and check the milestone reads as met and the initiative's progress moves.
2. Promote the milestone to an outcome (the star) and check it also shows as a card at the top of
   the initiative, and the initiative carries a `health` in `initiatives-get`.
3. Make a second milestone measured by a signal (reach or accumulate, with a target and a window;
   "New signal" creates a manual one) and check its reading. Rename that signal: the milestone
   still reads it. Delete it: the delete report names `task:<key>` and the milestone stays.
4. Give the initiative dates, then try to put a milestone's due date after the initiative's: the
   write is refused with a message naming the milestone.
5. Nest a milestone under a task, close the task's children, and check the panel offers to complete
   the parent. Switch a task to a milestone and back with the panel's switch; the key stays.
6. The complete validation chain passes. Then add `milestones` to `recipes.planning.powerups`.

## Remove

Reverse the Steps: remove the registration, the seams and the wholly owned files (keep `TaskMark`
for the base, and keep `measure.ts`, the target measurement types, `health.ts` and `HealthChip.tsx`
when the goals powerup stays), and `milestones` from `recipes.planning.powerups`. Before the code
goes, ask the owner what to do with existing milestone rows (`tasks.kind = 'milestone'`): turn them
into tasks (`task-upsert { kind: 'task' }` after clearing the measure and outcome) or delete them
(their children move up). A row left with `kind = 'milestone'` fails the base enum check on its next write.
Then drop the unused columns with new migrations, one each (back up first): `ALTER TABLE tasks DROP
COLUMN outcome`, `signal_id`, `measure_kind`, `target`, `baseline`. Run `box verify` and load
`/initiatives`.
