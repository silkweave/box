# Sprints powerup: install

Adds sprints, check-ins, the sprint pages and the sprint fields on tasks. Read
[POWERUP.md](POWERUP.md), the recipe [SPEC.md](../../SPEC.md) and [INSTALL.md](../../INSTALL.md)
("Base and powerup files") first. In the reference code every part of this powerup is marked
`sprints powerup`; grep for it. There are no owner-only steps.

## Detect

The Box has this powerup when `features/planning/core/sprints.ts` and
`features/planning/web/views/SprintsLayout.tsx` exist, `/sprints` loads and Settings > Agent tools
lists `sprint-get`. A `sprints` table or a `tasks.sprint_id` column in the warehouse means it was
added before. `box.json` `recipes.planning.powerups` lists `sprints` once it was verified. If it is
there, this is an update: compare against the version recorded in the `recipes` ledger instead of
copying over local changes.

## Requires

The Planning recipe, adapted and validated, recorded in the `recipes` ledger of `box.json`.

## Owner decisions

- Whether to add sprints now. Planning is complete without them.
- The team's working-day hours if not 5 (`DEFAULT_SPRINT_HOURS`; see POWERUP.md, "What a team
  customises").

## Owner-only steps

None.

## Steps

1. Run `box recipe fetch planning --version <the version in the recipes ledger of box.json>`.
2. **Files wholly owned**, copied from `<fetched recipe>/features/planning/`: `core/sprints.ts`,
   `core/sprints.test.ts`, `core/sprint-tasks.test.ts`; `web/sprint-types.ts`,
   `web/lib/useSprintsData.ts`, `web/views/SprintsLayout.tsx`, `web/views/SprintsIndex.tsx`,
   `web/views/SprintDetailView.tsx` and `web/components/sprint/` (`SprintGrid`, `SprintPlanning`,
   `SprintDesign`, `SprintBoard`, `SprintBurndown`, `SprintStatusButton`, `TaskCard`,
   `NewSprintTaskDialog`).
3. **Seams in shared files** (each marked `sprints powerup`):
   - `core/models.ts`: `SPRINTS`, `SPRINT_CHECKINS` (in `PLANNING_MODELS`), `tasks.sprint_id`,
     `tasks.slot_date`, the `SPRINT_STATUSES` import;
   - `core/types.ts`: the sprints section (`SprintStatus`, `SPRINT_STATUSES`,
     `DEFAULT_SPRINT_HOURS`, `Sprint`, `SprintInput`), `sprint_id` / `slot_date` on `TaskRecord`
     and `TaskInput`;
   - `core/items.ts`: `sprint_id`, `slot_date` in `KindField` / `KIND_FIELDS` and in the `task`
     entry of `ITEM_KIND_REGISTRY`;
   - `core/state.ts`: the `sprints.js` import, the sprint scope and slot block and the slot check
     in `upsertTask`, `createSprintTask`, and the sprints section (`readSprints` through
     `deleteSprint`, with `CHECKIN_BUCKETS`);
   - `core/standalone-tasks.test.ts`: "in and out of a sprint";
   - `server/planning/planning.controller.ts`: `sprint_id`, `slot_date` on `TaskDto` and
     `UpsertTaskDto`, the sprint DTOs and the sprint handlers at the end of the class;
   - web: `planning-types.ts` (`sprint_id`, `slot_date` on `Task`), `lib/usePlanningData.ts` (the
     sprint upsert fields and their optimistic patch), `components/ItemPanel.tsx` (`reloadSprint`
     after a kind switch and a delete), `lib/useAllTasks.ts` (`table:sprints`), `lib/markdown.ts`
     (the Sprint line).
4. **Register**: `export * from './sprints.js'` in `core/index.ts`; `sprints` in `routeRoots` of
   `server/index.ts`; the `/sprints` routes and `sprintsRoute` in `planningRoutes` of
   `web/routes.tsx`; the Sprints nav entry (order 210) in `web/index.tsx`, and reword the All tasks
   nav description to mention sprints.
5. **Migrations.** A fresh Box needs none: the tables and columns come from the ModelSpecs. A Box
   that already runs planning gets `sprints` and `sprint_checkins` from the ModelSpecs on boot, but
   the two new columns on `tasks` need migrations appended to its
   `features/planning/core/manifest.ts`, with names the Box chooses (never one already applied in
   its ledger), one table-altering statement each:

   ```ts
   { name: '<nnn>-tasks-sprint-id', statements: ['ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sprint_id VARCHAR'] },
   { name: '<nnn+1>-tasks-slot-date', statements: ['ALTER TABLE tasks ADD COLUMN IF NOT EXISTS slot_date DATE'] },
   ```

   Both are nullable, so no NOT NULL step. Back up first (`box db backup`) and rehearse on a
   restored backup in a scratch checkout (docs/WAREHOUSE.md, "Working rules").
6. Run `bun run typegen`, then restart (`box app restart`).
7. Record the powerup, with the fetched version and sha256, in `recipes.planning.powerups` of
   `box.json` once Verify passes, and the session in `_docs/INTEGRATION.md`.

## Verify

1. `http://localhost:8190/sprints`: create a sprint, set its dates and per-person availability on
   the **design** tab.
2. On **planning**, slot tasks onto days from the backlog, and add a task straight on a person-day
   (a standalone task). Nest a sub-task under a slotted parent: capacity counts each work item once.
3. Try to move the sprint to `planned` while a day is over capacity: it must refuse with a message
   naming the worst day.
4. On **board**, tick a stand-up bucket and complete the day.
5. Delete the sprint: its tasks, the grid-made one included, remain, out of any sprint.
6. The complete validation chain passes. Then add `sprints` to `recipes.planning.powerups`.

## Remove

Reverse the Steps: remove the registrations, the seams and the wholly owned files, and `sprints`
from `recipes.planning.powerups`. Ask the owner what to do with existing sprints and check-ins
(tasks made on a sprint grid are ordinary standalone tasks and stay). Then drop what is unused with
new migrations, one each (back up first): `ALTER TABLE tasks DROP COLUMN sprint_id`, `ALTER TABLE
tasks DROP COLUMN slot_date`, and, if the owner lets the rows go, `DROP TABLE sprint_checkins` and
`DROP TABLE sprints` with both added to the manifest's `retiredTables` so the ownership check counts
them as planning's. Run `box verify` and load `/initiatives` and `/tasks`.
