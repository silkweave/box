# Sprints

Windows of days with real per-person capacity: plan tasks onto person-days, refuse a plan that is provably over capacity, and run the daily stand-up against it.

## Highlights

- Sprints with per-person availability, weekends and per-day overrides
- A planning grid: slot tasks onto person-days from a backlog, or add a task straight on a day
- A capacity check that names the worst days before a sprint can be planned
- A daily stand-up board with done, today and slipping buckets, and a burndown
- Deleting a sprint releases its tasks, it never deletes them

## Needs

- Nothing outside the Box

## Requires

- The Planning recipe only.

## How it works

**Tables and columns.** `sprints` and `sprint_checkins` (both `timestamps: true`, `audit: true`),
and `tasks.sprint_id` (text) and `tasks.slot_date` (DATE), both nullable:

| table | pk | what it holds |
|---|---|---|
| `sprints` | `id` | title, `goal` (free text), `status` (enum `SPRINT_STATUSES`), `start_date` / `end_date` (DATE, not timestamp), `availability` JSON (`users.id` -> `{ hours, hours_by_date }`), `started_at`, `done_at` |
| `sprint_checkins` | `sprint_id` + `date` | one stand-up day: `ticks` JSON, a SET of `<users.id>:<bucket>` strings, plus `completed_at` / `completed_by` |

Two structural calls are load-bearing and stated in `models.ts`: a sprint has **no**
`initiative_id` - the initiatives in a sprint are inferred from its tasks; and `sprint_id` +
`slot_date` are columns on `tasks` rather than a join table, because a task is in at most one
sprint and a slot holds exactly one fact.

**Tasks in sprints.** Only `kind = task` goes into a sprint (`sprint_id` and `slot_date` are
task-only fields in the kind registry). A parent and its sub-items may share a sprint. A work item
counts for the sprint of its nearest scheduled item (itself, else its closest ancestor with a
sprint), so nothing counts twice: a parent in a sprint counts through the work items below it that
have no sprint of their own (their estimates and done dates), on the parent's person and day unless
a sub-item has its own (`sprintWork` in `state.ts`). A task made straight onto a person-day of the
grid (`sprint-task-create`, `createSprintTask`) is an ordinary standalone task with its sprint and
day set; it can leave the sprint, join an initiative through `task-move`, and deleting the sprint
releases it like any other task. Standalone tasks add nothing to a sprint's inferred
`initiative_ids`.

**Capacity** (`core/sprints.ts`): per person per day from `availability` (`DEFAULT_SPRINT_HOURS`
when unset); weekends are capacity 0 unless the sprint's `hours_by_date` names the day, which wins
outright (`capacityOn`, `isWeekend`). Moving a sprint to `planned` is refused while any day is
provably over capacity; under-utilisation below `UNDER_UTILISATION_RATIO` is reported, not refused.
Unestimated tasks travel beside the verdict as `unsized`.

**Check-ins.** One row per sprint-day; ticks are a set of `<user>:<bucket>` keys added or removed
one at a time server-side, so two people ticking at once cannot clobber each other. Buckets are
`CHECKIN_BUCKETS = ['done', 'today', 'slipping']`. `date` is the sprint-day, not the wall clock.

## Procedures and tools

On `PlanningController` (the sprint handlers at the end of the class):

| tRPC | MCP | what |
|---|---|---|
| `planningSprints` (query) | - | every sprint, newest window first; no tasks, no capacity grid |
| `planningSprintGet` (mutation) | `sprint-get` | one sprint with its tasks, the inferred initiatives and the computed capacity grid |
| `planningSprintUpsert` (mutation) | `sprint-upsert` | create or partially update; the gates below are 400s |
| `planningSprintTaskCreate` (mutation) | `sprint-task-create` | make a standalone task on one person-day: `sprint_id`, `title`, `assignee`, `slot_date`, optional `estimate_hours` |
| `planningSprintCheckinTick` (mutation) | - | tick one person's bucket on or off in a day's stand-up |
| `planningSprintCheckinComplete` (mutation) | - | close the day out; idempotent |
| `planningSprintDelete` (mutation) | `sprint-delete` | remove the sprint; its tasks are RELEASED, never deleted |

`sprint-get` is a mutation for the same reason `tasks-get` is. The check-in pair is tRPC-only: they
are dashboard concerns, not agent ones. On the base, `task-upsert` takes `sprint_id` (`''` takes it
out, which also unslots it) and `slot_date` (`''` unslots while keeping it in scope).

Refusals (400s): `end_date` before `start_date`; any status past `pending` without both dates;
`planned` while any day is provably over capacity (the message names the worst three person-days);
a `slot_date` outside the sprint window, or one with no `sprint_id`; an `availability` key that is
not a known user (`assertKnownUser`); a sprint field on a milestone.

## UI

- **Routes**: `/sprints` - `SprintsLayout` (shell + a sidebar of every sprint); `/` is
  `SprintsIndex`, `$id` is an `Outlet` whose `/` and whose `$tab` are both `SprintDetailView`.
  `$tab` is `design|planning|board`; when the URL names none, the tab that opens is chosen from the
  sprint's status. An item opens in the same right panel as elsewhere, named with `?task=<key>`
  since the path already carries the tab.
- **Nav**: `Sprints` (icon `CalendarRange`, order 210) in the Operations section. Sprints is its own
  group rather than a tab inside Initiatives because a sprint has its own lifecycle and the board
  is a daily-driver surface.
- **Design** sets dates and per-person availability, and draws the calendar whenever the sprint has
  a window, even with an empty roster: the ghost column is the only place a person can be added.
- **Planning**: the backlog filters by owner, by **tag** and by "due in this window" - the tag
  filter matches the TASK's own tags, never its initiative's, since a per-task pick like `sprint`
  would otherwise pull in every open task under a tagged initiative. It lists the open tasks of
  every initiative and, after them, the standalone tasks under **No initiative**, and nothing above
  or below an item already in the sprint; dragging a standalone task back out of the grid releases
  it there. Every person-day on the grid carries a faint **"Add task"** under its cards
  (`NewSprintTaskDialog`: title + estimate, the cell supplies owner and day). A refused slot
  surfaces in the sprint banner. **Your own column comes first** on the grid and on the Board's
  stand-up lanes alike - `rosterOf(sprint, activeUserId)`.
- **Board**: the stand-up lanes, the buckets to tick, complete the day, and the burndown.
- **Elsewhere**: the item panel reloads the open sprint after a task's kind switch or delete
  (`reloadSprint`); All tasks reloads on `table:sprints`; the markdown export carries a Sprint
  line. All tasks shows no sprint column.
- **Stores**: `useSprintsData` reloads on `table:sprints` (the per-sprint detail is not a
  `createDataStore` because it is parameterised by id).

## Why the shapes are what they are

- **`unsized` travels beside the verdict, never inside it** (`sprints.ts`). An unestimated task
  contributes nothing to a day's `planned`: counting it as 0 would call a full day empty, and
  guessing a number would invent capacity nobody promised. A day can be provably over capacity AND
  hold unestimated work, and both facts want saying.
- **Availability is per-sprint data, not team vocabulary**, which is why it lives on the row rather
  than in `config/`. One person's October leave says nothing about their November, and public
  holidays are per-person once a team is not in one country - hence a per-person calendar of
  absolute dates rather than a shared holiday table.
- **The `slot_date` guard reads what the CALLER passed, not the merged result.** An explicit
  `slot_date` with no sprint is refused loudly; a slot CARRIED FORWARD off a task leaving its
  sprint is just what leaving means, and is dropped silently. The other way round, clearing
  `sprint_id` would fail with "slot_date needs a sprint_id" on a call that never mentioned
  `slot_date`.

## What a team customises

- **`SprintStatus`** - `pending · scheduled · planned · active · done` (`SPRINT_STATUSES` in
  `core/types.ts`, mirrored in `web/sprint-types.ts`). Deliberately not `PlanningStatus`: a sprint
  is a window with capacity, and `blocked` / `dropped` mean nothing for one. Nothing enforces "at
  most one active sprint". Changing the order changes which tab opens for a sprint
  (`SprintDetailView` picks from the status).
- **Sprint capacity** - `DEFAULT_SPRINT_HOURS = 5` in `types.ts` (not 8, and the reason is written
  there) and `UNDER_UTILISATION_RATIO = 0.6` in `core/sprints.ts`. Weekend handling lives in
  `capacityOn` / `isWeekend` in the same file.
- **Check-in buckets** - `CHECKIN_BUCKETS` is declared in TWO places on purpose,
  `core/state.ts` and `web/sprint-types.ts`. Change both or the server will refuse a bucket the
  Board renders.

## Gotchas

- **A sprint delete releases tasks, it does not delete them**, grid-made ones included. Anything
  you add that removes a window over work must do the same.
- **A work item counts once, for its nearest scheduled item's sprint.** A parent and its sub-items
  may share a sprint; a parent counts only the work items below it that have no sprint of their
  own, on the parent's person and day unless a sub-item has its own (`sprintWork` in `state.ts`).
  Only `kind = task` items go into a sprint.
- **Sprint-grid tasks are ordinary standalone items** with a `sprint_id`, not a separate kind.
