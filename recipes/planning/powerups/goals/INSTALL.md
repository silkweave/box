# Cycles & Goals powerup: install

Adds goals, cycles and the goals an initiative contributes to. Read [POWERUP.md](POWERUP.md), the
recipe [SPEC.md](../../SPEC.md) and [INSTALL.md](../../INSTALL.md) ("Base and powerup files")
first. In the reference code every part of this powerup is marked `goals powerup`; grep for it.
There are no owner-only steps.

## Detect

The Box has this powerup when `features/planning/core/goal-state.ts` and
`features/planning/server/planning/goals.controller.ts` exist, `GoalsController` is registered in
`planning.module.ts`, `/goals` loads and Settings > Agent tools lists `goals-get`. A `goals` table
and an `initiatives.goal_ids` column in the warehouse mean it was added before. `box.json`
`recipes.planning.powerups` lists `goals` once it was verified. If it is there, this is an update:
compare against the version recorded in the `recipes` ledger instead of copying over local changes.

## Requires

The Planning recipe, adapted and validated, recorded in the `recipes` ledger of `box.json`. Nothing
else: goals measure core's signals.

## Owner decisions

- Whether to add goals now. Planning is complete without them.
- With an existing Box: which initiatives contribute to which goals, once goals exist (nothing is
  linked automatically).

## Owner-only steps

None.

## Steps

1. Run `box recipe fetch planning --version <the version in the recipes ledger of box.json>`.
2. **Files wholly owned**, copied from `<fetched recipe>/features/planning/`:
   - core: `goal-state.ts`, `goal-events.ts`, `goal-state.test.ts`, `goal-events.test.ts`;
   - server: `server/planning/goals.controller.ts`;
   - web: `goal-types.ts`, `lib/useGoalsData.ts`, `views/GoalsLayout.tsx`, `views/GoalsIndex.tsx`,
     `views/GoalDetailView.tsx`, `components/GoalCard.tsx`, `GoalDialog.tsx`, `CycleDialog.tsx`,
     `GoalSelect.tsx`, `GoalInitiatives.tsx`, `CycleBoardNote.tsx`;
   - the shared target measurement, unless the milestones powerup already brought it:
     `core/measure.ts`, `core/measure.test.ts`, the "target measurement" section of
     `core/types.ts` (`GoalKind`, `GoalComparator`, `GoalHealth`, `GOAL_HEALTHS`,
     `DEFAULT_HEALTH_TOLERANCE`), `web/health.ts`, `web/components/HealthChip.tsx`.
3. **Seams in shared files** (each marked `goals powerup`):
   - `core/models.ts`: `GOALS`, `CYCLES` (in `PLANNING_MODELS`), `initiatives.goal_ids`, and the
     `CYCLE_STATUSES`, `GOAL_COMPARATORS`, `GOAL_KINDS`, `GOAL_STATUSES` imports;
   - `core/types.ts`: the goals and cycles section, `Initiative.goal_ids`,
     `InitiativeInput.goal_ids`, `'goal' | 'cycle'` in `assertTitleLength`;
   - `core/state.ts`: `normalizeContributedGoalIds` in `upsertInitiative`, `goal_ids` in
     `decorate`, the goal and cycle branches of `readPlanningDocOf` / `savePlanningDoc`;
   - `core/docs.ts`: the `goal` / `cycle` doc kinds, `SLUG` / `slug`, their paths,
     `movePlanningDoc` and the doc delete;
   - `server/planning/planning.controller.ts`: `'goal'`, `'cycle'` in `DOC_KINDS`, `goal_ids` on
     `InitiativeDto` and `UpsertInitiativeDto`;
   - web: `planning-types.ts` (`Initiative.goal_ids`), `lib/usePlanningData.ts` (`goal_ids` in the
     upsert and its optimistic patch), `views/InitiativeDetailView.tsx` (`GoalsCard`, `GoalPicker`,
     `useGoalsData`, `goals` in `Folds`), `components/cells.tsx` (`GoalsCell`),
     `views/InitiativesGrid.tsx` (the goals cell), `lib/planningView.ts` (the `goals` column, its
     place in `DEFAULT_VIEW`, the Growth preset), `components/InitiativeDialog.tsx` (the goals
     field), `components/RecordMenu.tsx` (`useGoalsData` for goal names), `lib/markdown.ts`
     (`names.goal`, the Goals line), `components/status.tsx` (`GOAL_STATUS_UI`, `GoalStatusLabel`,
     `GoalStatusSelect`), `components/dimensions.tsx` (`InitiativePicker`).
4. **Register**:
   - `core/index.ts`: `export * from './goal-state.js'`, `'./goal-events.js'` and, if not there,
     `'./measure.js'`;
   - `server/planning/planning.module.ts`: `GoalsController` and `CyclesController` in
     `controllers`; in `onModuleInit` `registerSignalHooks(GOAL_SIGNAL_HOOKS)`,
     `registerUserCleanup('planning.goals', unassignDeletedGoalOwner)` and
     `onRunOutcome(async (outcome) => { if (outcome.status === 'success') await evaluateGoals() })`;
   - `server/index.ts`: `goals` in `routeRoots`;
   - `web/routes.tsx`: the `/goals` routes and `goalsRoute` in `planningRoutes`;
   - `web/index.tsx`: the Goals nav entry (order 200), the `goal` and `cycle` docs, and reword the
     Initiatives nav description to name goals.
5. **Migrations.** A fresh Box needs none: `goals`, `cycles` and `initiatives.goal_ids` come from
   the ModelSpecs. A Box that already runs planning gets the two tables from the ModelSpecs on
   boot, but the new column on a base table needs migrations appended to the Box's
   `features/planning/core/manifest.ts`, with names the Box chooses (never one already applied in
   its ledger), one table-altering statement each:

   ```ts
   { name: '<nnn>-initiatives-goal-ids', statements: [`ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS goal_ids JSON DEFAULT '[]'`] },
   { name: '<nnn+1>-initiatives-goal-ids-not-null', statements: ['ALTER TABLE initiatives ALTER COLUMN goal_ids SET NOT NULL'] },
   ```

   Back up first (`box db backup`) and rehearse on a restored backup in a scratch checkout
   (docs/WAREHOUSE.md, "Working rules").
6. Run `bun run typegen` so the web client knows the goal procedures, then restart
   (`box app restart`).
7. Record the powerup, with the fetched version and sha256, in `recipes.planning.powerups` of
   `box.json` once Verify passes, and the session in `_docs/INTEGRATION.md`.

## Verify

1. `http://localhost:8190/goals` loads with the Goals nav entry. Create a goal with a target and a
   window but no signal, enter a value for it (`goal-value-set`), make an initiative contribute to
   it (the initiative page's Goals checklist), and check the goal card shows a health reading and
   names the initiative.
2. Create a qualitative goal (no target): it shows "No target" and no health. Bind a third goal to
   `planning.tasks_done` (`goal-upsert` with `measure_key`), finish a task and check its value
   moves.
3. Create a cycle, put a goal in it, move the cycle to `review`, and carry the goal forward into a
   second cycle: the new goal exists, the initiative contributes to it, the old one is closed.
4. Rename a goal (`goal-rename`): the initiative still contributes to it and its doc moved.
   Delete a goal: the initiative's `goal_ids` no longer name it.
5. The gap lists name an open initiative without a goal and a goal without an initiative.
6. The complete validation chain passes. Then add `goals` to `recipes.planning.powerups`.

## Remove

Remove the cycle-board powerup first, since it requires goals. Then reverse the Steps: remove the
registrations, the seams and the wholly owned files (keep `measure.ts`, the target measurement
types, `health.ts` and `HealthChip.tsx` when the milestones powerup stays), and `goals` from
`recipes.planning.powerups`. Ask the owner what to do with existing goals and cycles, their docs
under `data/docs/goals/` and `data/docs/cycles/`, and the goals' own signals (`goal.<id>`, kept by
core's signals until deleted there). Then drop what is unused with new migrations (back up first):
`ALTER TABLE initiatives DROP COLUMN goal_ids`, and, if the owner lets the rows go, `DROP TABLE
goals` and `DROP TABLE cycles` with `goals` and `cycles` added to the manifest's `retiredTables` so
the ownership check counts them as planning's. Run `box verify` and load `/initiatives`.
