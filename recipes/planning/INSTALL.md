# Adapt the planning recipe

This is the adaptation guide for the planning recipe. Read [RECIPE.md](./RECIPE.md), [SPEC.md](./SPEC.md),
the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's docs/UPSTREAM.md, and its current
_docs/INTEGRATION.md before changing files. These recipe documents ship with core, so a Box has them
at `recipes/planning/`. The reference implementation does not: it is fetched from the recipe registry as `features/planning/`. In a Box, run `box recipe fetch planning` and read `<fetched recipe>/features/planning/` (`<fetched recipe>` is the path it prints),
so the documents and the code come from the same version.

The reference implementation is the FULL feature: the base (initiatives, nested tasks, initiative
kinds, impact/effort/quadrant, priority, tags, start and due dates, the All tasks page, hours
progress, keys, docs and the `planning.tasks_done` measure) plus every powerup. Ask the owner which
powerups to add now (goals, milestones, sprints, timeline, cycle-board, mobile; each can be added
later), then integrate the base and only those. Code that belongs to a powerup is marked in the
source with a greppable comment: `goals powerup`, `milestones powerup`, `sprints powerup`,
`timeline powerup`, `cycle-board powerup`. The map below names the files and seams; the markers are
the line-level truth.

## Prerequisites

- Existing Box backup and a recorded restore path for both data and matching application source.
- Core. This recipe builds on no other recipe.
- Feature-specific package imports include: `@base-ui/react`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `prismjs`, `react-simple-code-editor`, and `@types/prismjs` (web). Install latest into the root workspace package; record any necessary compatibility pin and its reason in the Box gotchas. Also declare shared framework/UI packages imported directly by this feature: dependencies declared only under apps/server or apps/web do not resolve from the shared feature tree.
- The source version to fetch (for an update, the one in the `recipes` ledger of `box.json`), the
  owner's choice of powerups, and an integration entry with scope, target version, intended
  changes, and state in _docs/INTEGRATION.md.
- A disposable instance for build, typecheck, tests, schema checks, and boot verification.

## Base and powerup files

Paths are relative to `features/planning/`. "Skip" means: leave the file out, or strip the marked
part, unless that powerup is wanted.

### Wholly owned by a powerup (skip unless it is wanted)

| Powerup | Files |
|---|---|
| goals | `core/goal-state.ts`, `core/goal-events.ts` and their tests; `server/planning/goals.controller.ts`; `web/goal-types.ts`, `web/lib/useGoalsData.ts`, `web/views/GoalsLayout.tsx`, `web/views/GoalsIndex.tsx`, `web/views/GoalDetailView.tsx`, `web/components/GoalCard.tsx`, `GoalDialog.tsx`, `CycleDialog.tsx`, `GoalSelect.tsx`, `GoalInitiatives.tsx`, `CycleBoardNote.tsx` |
| milestones | `web/components/milestone.tsx` (except `TaskMark`, which the base tree and grid use: keep it, for example in `components/rowParts.tsx`), `web/components/OutcomeCards.tsx` |
| goals or milestones (keep with either) | `core/measure.ts` and `core/measure.test.ts`; the "target measurement" section of `core/types.ts`; `web/health.ts`; `web/components/HealthChip.tsx` |
| sprints | `core/sprints.ts`, `core/sprints.test.ts`, `core/sprint-tasks.test.ts`; `web/sprint-types.ts`, `web/lib/useSprintsData.ts`, `web/views/SprintsLayout.tsx`, `SprintsIndex.tsx`, `SprintDetailView.tsx`, `web/components/sprint/` |
| timeline | `web/components/InitiativesTimeline.tsx`, `web/lib/timeline.ts` |
| cycle-board | `core/cycle-board/`, `server/cycle-board/`, `web/cycle-board/` |
| mobile | `mobile/` |

Everything else is base. The shared files carry powerup seams.

### Seams in shared files

Core:

- `core/models.ts`: `initiatives.goal_ids` and the `GOALS` / `CYCLES` specs (skip unless goals);
  `tasks.outcome`, `signal_id`, `measure_kind`, `target`, `baseline` (skip unless milestones);
  `tasks.sprint_id`, `slot_date` and the `SPRINTS` / `SPRINT_CHECKINS` specs (skip unless sprints).
  Keep `tasks.kind`; its enum becomes `['task']` without milestones. Trim the enum imports and
  `PLANNING_MODELS` to match.
- `core/types.ts`: `ItemKind` / `ITEM_KINDS` stay (as `'task'` alone without milestones);
  `MilestoneMeasureKind`, `MilestoneState` and the milestone fields of `TaskRecord`, `ItemDerived`,
  `InitiativeWithTasks.health` and `TaskInput` (skip unless milestones); `Initiative.goal_ids`,
  `InitiativeInput.goal_ids`, the goals and cycles section (skip unless goals); the sprint fields
  and the sprints section (skip unless sprints). `assertTitleLength` names `'goal' | 'cycle'`
  (goals) and `'milestone'` (milestones): trim its union. The target measurement section stays
  with goals or milestones.
- `core/items.ts`: `KindField` / `KIND_FIELDS` mix base `estimate_hours` with the sprints and
  milestones fields in one union: hand edit it to the fields the Box has. `ITEM_KIND_REGISTRY`
  keeps only its `task` entry without milestones; `itemKindSpec(...).countsAsWork` is base and is
  what `workItems` and `droppedIds` read. The measure rules in `assertKindFields`, the windows
  section, the derived reading section and `worstHealth` are milestones; without them
  `deriveItems` keeps the base child counts and hours, and `initiativeReading` returns `progress`
  only.
- `core/state.ts`: `derive()` (used by `readInitiatives`, `readAllTasks`, `readTask`) loads signal
  readings and `healthTolerance()` from `measure.ts`; both are milestones only, so a base-only Box
  edits `derive` to skip them, and then `measure.ts` is not needed. Also milestones:
  `windowsOf`, `scopeWindows`, `signalReadings`, the window checks in `upsertInitiative`,
  `upsertTask` and `moveTask`, the window pinning in `deleteTask`, the measure block of
  `upsertTask`, `repointItemSignals`, `itemsReferencingSignal`, `MILESTONE_SIGNAL_HOOKS`. Goals:
  the `goal_ids` handling in `decorate` and `upsertInitiative`, and the goal and cycle branches of
  the doc functions. Sprints: the `sprints.js` import, the sprint scope and slot block of
  `upsertTask`, `createSprintTask`, and the sprints section (`readSprints` through
  `deleteSprint`). `unassignDeletedUser` is base.
- `core/docs.ts`: the `goal` / `cycle` members of `DocKind`, `SLUG` / `slug`, their paths,
  `movePlanningDoc` and the delete helper (skip unless goals).
- `core/index.ts`: the export lines of `sprints.js` (sprints), `goal-state.js` and
  `goal-events.js` (goals), `measure.js` (goals or milestones), `cycle-board/index.js`
  (cycle-board).
- `core/initiatives.test.ts`, `core/standalone-tasks.test.ts` ("in and out of a sprint" is
  sprints), `core/items.test.ts` ("windows", "the derived milestone reading", "switching kind",
  "windows on write", "deletes keep windows whole", "signal-measured milestones" are milestones).

Server:

- `server/planning/planning.module.ts`: base registers `PlanningController`,
  `registerMeasure(TASKS_DONE_MEASURE)` and `registerUserCleanup('planning', unassignDeletedUser)`.
  Skip unless milestones: `registerSignalHooks(MILESTONE_SIGNAL_HOOKS)`. Skip unless goals:
  `GoalsController`, `CyclesController`, `registerSignalHooks(GOAL_SIGNAL_HOOKS)`,
  `registerUserCleanup('planning.goals', unassignDeletedGoalOwner)` and the `onRunOutcome` ->
  `evaluateGoals` callback. Skip unless cycle-board: `CycleBoardModule` in `imports`.
- `server/planning/planning.controller.ts`: `DOC_KINDS` `'goal'`, `'cycle'` and `goal_ids` on the
  initiative DTOs (goals); `kind`, `outcome`, the signal measure fields and the derived reading on
  the task DTOs, `health` on the initiative DTO, the measure mapping in `taskUpsert` (milestones);
  `sprint_id`, `slot_date`, the sprint DTOs and every sprint handler at the end of the class
  (sprints).
- `server/index.ts`: `routeRoots` (diagnostic route categories). Base is `initiatives` and
  `tasks`; goals adds `goals`, sprints adds `sprints`.

Web:

- `web/index.tsx`: the Goals nav entry and the `goal` / `cycle` docs (goals); the Sprints nav entry
  (sprints); `CYCLE_ACTIONS_SLOT`, `CycleBoardAction` and `slots` (cycle-board, and the slot id
  lives in the goals-owned `CycleBoardNote.tsx`). The Initiatives and All tasks nav descriptions
  and the header comment mention goals and sprints: reword them to what the Box has.
- `web/routes.tsx`: the `/goals` routes (goals), the `/sprints` routes (sprints), and their entries
  in `planningRoutes`.
- `web/planning-types.ts`: the `GoalHealth` import, `isMilestone`, `MilestoneMeasureKind`,
  `MilestoneState`, the milestone fields and derived reading on `Task`, `Initiative.health`
  (milestones); `sprint_id`, `slot_date` on `Task` (sprints); `Initiative.goal_ids` (goals).
  `ItemKind` stays.
- `web/lib/usePlanningData.ts`: milestone upsert fields and the optimistic `outcome` (milestones),
  sprint fields and their optimistic patch (sprints), `goal_ids` (goals).
- `web/components/ItemPanel.tsx`: `KindToggle`, `OutcomeStar`, `MeasureEditor`, `NumberInput`, the
  signal imports, the milestone status hint and inherited-window hints, and the kind control of
  `QuickAddChild` (milestones; the base `QuickAddChild` adds tasks); `reloadSprint` after a kind
  switch and a delete (sprints).
- `web/components/ItemTree.tsx`: the milestone branches (marks, progress cell, state chip, the "N
  of M milestones met" count, effort excluding milestones) (milestones). The bottom "add task" row
  is base.
- `web/views/InitiativesGrid.tsx`: the milestone branches of the status and task cells
  (milestones); `GoalsCell` (goals); the `InitiativesTimeline` import and the `timeline:` layout
  (timeline).
- `web/views/InitiativeDetailView.tsx`: `OutcomeCards` (milestones); `GoalCard`, `GoalPicker`,
  `useGoalsData`, `GoalsCard` and the `goals` member of `Folds` (goals).
- `web/lib/planningView.ts`: the `goals` column, its place in `DEFAULT_VIEW` and the Growth preset
  (goals); the `timeline` layout, the Timeline preset, the layout option, the `lib/timeline.ts`
  import and the timeline section at the end (`timelineRow`, `timelineWindow`, `timelineOffset`)
  (timeline; the import of `lib/timeline.ts` is the only reason the base file reaches that file);
  the milestone clause of `applyView` (milestones). `normalizeViewState` already falls back for a
  saved view whose layout or column the Box does not have.
- `web/lib/planningView.test.ts` ("timeline" is timeline) and `web/lib/markdown.test.ts`.
- `web/lib/markdown.ts`: `names.goal` and the Goals line (goals); `names.signal`, the milestone
  item line, `measure()`, the Kind, State, inherited dates and Measure lines (milestones); the
  Sprint line (sprints).
- `web/components/cells.tsx`: `GoalsCell` and its imports (goals).
- `web/components/InitiativeDialog.tsx`: the goals field (goals).
- `web/components/RecordMenu.tsx`: `useGoalsData` (goals), the signals lookup for the measure line
  (milestones).
- `web/components/status.tsx`: `GOAL_STATUS_UI`, `GoalStatusLabel`, `GoalStatusSelect` (goals).
- `web/components/dimensions.tsx`: `InitiativePicker` is used only by `GoalInitiatives` (goals).
- `web/lib/useAllTasks.ts`: `table:sprints` in its reloads (sprints).

A base-only Box still has `tasks.kind` (every row `task`), `start_date` / `due_date` on initiatives
and tasks, `planning.tasks_done` and hours progress. It has no initiative health.

## Integration

Before copying unrelated feature code, inspect migrations and complete their staged backup,
application and boot-compatibility check below. Stage only the runner, registration, imports and
dependencies needed to run them. On resume, compare the running record with actual files and
ledgers before replaying an operation.

1. Copy/adapt the base from `<fetched recipe>/features/planning/` into the Box's
   features/planning/{core,server,web}, leaving out the files and seams of every powerup the owner
   did not choose (above), then follow each chosen powerup's INSTALL.md. Keep existing runtime
   contracts, registrations, dependency order, and package manifests. Register the result as the
   `planning` feature. Do not create a feature package, a symlink, or a release catalogue entry.
2. Declare imported third-party packages in root workspace manifests when the consolidated layout
   requires it. Resolve imports and production output from source; fix integration errors in the
   target Box as part of the adaptation.
3. Preserve local customizations and write durable findings to the Box's docs/GOTCHAS.md. Record
   path mappings and skipped powerups; update _docs/INTEGRATION.md as each step completes. Record
   the fetched version and sha256 in the `recipes` ledger of `box.json`, with the powerups added
   in `recipes.planning.powerups`, only after the full validation and boot pass.
4. The reference `core/manifest.ts` declares `migrations: []`: a fresh Box gets every table and
   column from `models.ts`. A Box that already runs planning keeps its own applied migrations
   exactly (identities and bodies); new schema behavior gets a new migration.
5. For migrations, stage the runner, registration, and minimum code first. Test against a restored
   backup in isolation, confirm completion and boot compatibility, then continue with unrelated
   changes. Never edit or rename an applied migration.

## Validation

Run the target Box's normal build, typecheck, tests, lint, and schema:check commands, then boot a
disposable instance and exercise this feature's documented surface (AGENT.md, "Prove it", and each
added powerup's Verify). Load `/initiatives` and `/tasks` in a browser: a left-out powerup must
leave no import behind, and typechecking cannot detect every module-scope registration cycle.
Record actual commands and results. Do not describe a migration, latest-dependency check, or
consumer rehearsal as complete until it has actually run.
