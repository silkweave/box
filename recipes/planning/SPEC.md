# `planning` - goals, initiatives, tasks and sprints

The body of work and the argument for it. A **goal** is one signal, a target and a window: the
number the team wants to move and by when. A **cycle** groups goals into a period. An **initiative**
is a body of work: it carries a kind, a status, value and priority ratings, a dependency edge list
and - the contract that makes it planning rather than a todo list - the goals it contributes to. A **task** is a
unit under one initiative, keyed by the slug path `<initiative>/<task>`, sized in whole hours. A
**sprint** is a window of days with real per-person capacity that tasks are scoped and slotted into,
with a daily stand-up check-in recorded against it. Structured state lives in seven warehouse tables;
the long-form rationale lives in markdown on disk, and the row's one-line `summary` is derived from
that doc rather than typed.

- **dependsOn**: nothing. Signals and saved views are core (`docs/SIGNALS.md`). Core-side,
  `state.ts` imports `autoRegisterDefinitions` (`@silkweave/box-core/signals/definitions`),
  `replaceSignalRows` (`@silkweave/box-core/signals/write`) and the `SignalHooks` type
  (`@silkweave/box-core/signals/hooks`); the server module registers `PLANNING_SIGNAL_HOOKS` into
  core's `registerSignalHooks` port from `onModuleInit`. Web-side, `InitiativeKindsSection` imports
  core's `apps/web/src/presets/presetIcons.tsx` so a kind picks from the same closed icon
  vocabulary a preset does, the Initiatives board uses core's saved views
  (`apps/web/src/presets/`), and the goal views use `useSignalsData` and `SignalPicker` from
  `apps/web/src/signals/`. Goals *reference* a `signals.id` in `goals.signal_id`, but as a string -
  there is no FK. Core-side, goals read `@silkweave/box-core/signals/series` (day-grain reads over
  a merged history), `readSignalDefinition(s)` and `readSignalPoints`.
  Goal and initiative renames and deletes call the hooks in `core/identity-hooks.ts`
  (`registerPlanningIdentityHooks`), so a powerup can follow them; the `cycle-board` powerup
  (below) is the one that uses them.
- **Depended on by**: any feature that declares `dependsOn: ['planning']`, for example to reuse
  `PLANNING_STATUSES` and `PlanningStatus` in its own models and types and planning's
  `StatusSelect` / `StatusLabel` in its web views.
- **Removal**: remove planning only after adapting or removing every feature that depends on it. Without planning, core's signals keep
  working but lose the `github.silkweave_prs_merged` outcome signal, the re-pointing of goals on a
  signal rename, and the "what references this signal" answer (`goal:<id>`) that guards a rename and
  a delete.

## Tables

Seven, all `timestamps: true` and `audit: true` (so every row carries `created_at` / `updated_at` /
`created_by` / `updated_by`).

| table | pk | what it holds |
|---|---|---|
| `initiatives` | `id` | slug id, title, derived `summary`, `status` (enum `PLANNING_STATUSES`), `kind` (enum from `box.json features.planning.initiativeKinds`), `owner`, `value_customer` / `value_company` (enum `VALUE_LEVELS`), `priority` 1-3, `blocked_by` JSON edge list, `tags` JSON, `doc_path`, `due_date`, `sort` |
| `tasks` | `id` (`<initiative>/<task>`) | `initiative_id` (NULL = a **sprint task**, see below), title, derived `summary`, `status`, `rank`, `score`, `priority` 1-3, `estimate_hours` 1-8, `tags`, `url`, `assignee`, `metadata` JSON, `due_date`, `sprint_id`, `slot_date`, `done_at` |
| `sprints` | `id` | title, `goal`, `status` (enum `SPRINT_STATUSES`), `start_date` / `end_date` (DATE, not timestamp), `availability` JSON (`users.id` -> `{ hours, hours_by_date }`), `started_at`, `done_at` |
| `sprint_checkins` | `sprint_id` + `date` | one stand-up day: `ticks` JSON, a SET of `<users.id>:<bucket>` strings, plus `completed_at` / `completed_by` |
| `cycles` | `id` | slug id, `title`, `status` (enum `CYCLE_STATUSES`), `start_date` / `end_date` (DATE), `doc_path`, `sort` |
| `goals` | `id` | slug id, `title`, derived `summary`, `signal_id` (string, no FK), `kind` (enum `GOAL_KINDS`), `target` float, `comparator` (`hold` only), `start_date` / `end_date` (DATE, inclusive), `baseline` (reach override, NULL = read from the signal), `cycle_id`, `owner`, `outcome` (enum `GOAL_OUTCOMES`, NULL while open), `tags`, `doc_path`, `sort` |
| `goal_initiatives` | `goal_id` + `initiative_id` | which initiatives contribute to which goals; many to many, no weight |

Three migrations (`001-sprint-tasks`, 2026-09-14: `tasks.initiative_id` stops being NOT NULL;
`002-drop-initiative-target` and `003-drop-initiative-signal-ids`, 2026-10-06: the columns goals
replaced), no `baseline`, no `actions`. The seven `ModelSpec`s are baselined with `CREATE TABLE IF NOT EXISTS` on
every boot, so a fresh Box gets the current shape in one shot and the migration only exists for a
Box that already booted on the old one.

Two structural calls are load-bearing and stated in `models.ts`: a sprint has **no**
`initiative_id` - the initiatives in a sprint are inferred from its tasks; and `sprint_id` +
`slot_date` are columns on `tasks` rather than a join table, because a task is in at most one
sprint and a slot holds exactly one fact.

### Sprint tasks - work that belongs to the sprint alone (2026-09-14)

The grid's "Add task" makes a task straight onto one person-day, under **no initiative**: the fix
somebody raises in stand-up, the chore not worth an initiative. `tasks.initiative_id` is nullable
for it, and NULL is the whole marker - there is no `kind` column.

- **Born only by `createSprintTask`** (`sprint-task-create`). The server derives the id,
  `<sprint>/<slug-of-title>`, suffixing `-2`, `-3` on a clash rather than refusing (nobody sees the
  id from the grid). It lands slotted, assigned and with `due_date` = the day, like any grid drop.
  Its doc goes through the normal path rule, so it lives at `docs/initiatives/<sprint>/<slug>.md`.
- **It never leaves its sprint.** `upsertTask` routes an existing sprint task to `upsertSprintTask`,
  which edits every field an ordinary task can but REFUSES a changed `sprint_id`, a cleared
  `slot_date` or a cleared `assignee`, naming the two ways out: delete it, or `task-move` it into an
  initiative (which re-keys it into an ordinary task). The reason is that a sprint task off its day
  is a row no surface draws - it is under no initiative, so neither the board nor the backlog ever
  lists it. The web app asks before the server has to refuse: dragging one onto the backlog opens a
  "this task only exists in this sprint" dialog whose only choices are Cancel and Delete.
- `renameTask` keeps the STORED parent rather than re-deriving it from the id prefix, which for a
  sprint task is the sprint, not an initiative. `readInitiatives` skips these rows and
  `initiative_ids` on a sprint ignores them.
- **Deleting the sprint deletes them**, while every other task is released: they came from nowhere
  but this sprint, so there is no board to return them to.

## Docs on disk

`data/docs/`, from core's `docsDir()`. Doc kinds are `initiative`, `task`, `goal` and `cycle`:

- initiative `silkweave-pr-targets` -> `docs/initiatives/silkweave-pr-targets.md`
- task `silkweave-pr-targets/invoicerr` -> `docs/initiatives/silkweave-pr-targets/invoicerr.md`
- goal `mrr-12k` -> `docs/goals/mrr-12k.md`
- cycle `2026-q4` -> `docs/cycles/2026-q4.md`

The path is a pure function of the id. Every segment must match `^[a-z0-9][a-z0-9-]*$`, a task id
must be exactly two segments, and the resolved absolute path is re-checked to start with the base
dir + separator before anything is read, written or renamed (`features/planning/core/docs.ts`,
`absPath`) - the same traversal guard `sink` uses. `movePlanningDoc` deliberately tolerates an
unaddressable SOURCE (a legacy bare task id has no doc, so there is nothing to move) but always
validates the destination, and refuses to clobber one that exists.

A rename moves the files: `renameInitiative` moves the initiative doc, every task doc under it, and
then removes the now-empty folder; `moveTask` / `renameTask` move the one doc.

`savePlanningDoc` is the only writer of `summary`: it writes the file, then refreshes the row's
cached one-line preview via `docSummary()` (first real paragraph, with frontmatter, headings, rules,
`**Status:**`-style metadata lines, bullets, tables and fences skipped, flattened, capped at 240
chars). It never CREATES a row - a doc may be written for an id whose row does not exist yet.

## Procedures and tools

`PlanningController` (`@Controller('planning')`, class-level `@UseGuards(AuthGuard)`): 24 tRPC
procedures, 20 of them also MCP tools. `GoalsController` and `CyclesController` follow below. Every tRPC name is `planning`-prefixed on the wire (the
controller's own doc comments drop the prefix; `apps/web/src/generated/appRouter.d.ts` is the truth).

| tRPC | MCP | what |
|---|---|---|
| `planningInitiatives` (query) | - | every initiative with its tasks nested |
| `planningInitiativesGet` (mutation) | `initiatives-get` | the same, all or one by `id` - the read entry point for a remote session |
| `planningInitiativeUpsert` (mutation) | `initiative-upsert` | create or partially update one; `goal_ids` replaces the goals it contributes to, `''` clears a value dimension |
| `planningInitiativeDelete` (mutation) | `initiative-delete` | remove it and its tasks, prune dangling `blocked_by` edges |
| `planningTaskUpsert` (mutation) | `task-upsert` | create or partially update a task; `0` clears `priority` / `estimate_hours` |
| `planningTaskSetStatus` (mutation) | `task-set-status` | the quick action |
| `planningTaskDelete` (mutation) | `task-delete` | remove a task |
| `planningTaskMove` (mutation) | `task-move` | move to another initiative, re-keying the id and moving the doc |
| `planningTasksReorder` (mutation) | `tasks-reorder` | sequential `rank` within one initiative |
| `planningInitiativesReorder` (mutation) | `initiatives-reorder` | sequential `sort` |
| `planningInitiativeRename` (mutation) | `initiative-rename` | rename the slug; cascades to tasks, edges and docs |
| `planningTaskRename` (mutation) | `task-rename` | rename a task's slug inside its initiative |
| `planningKinds` (query) | `initiative-kinds` | the team's kind list, by label, each with its initiative count |
| `planningKindSave` (mutation) | `initiative-kind-save` | create a lane or edit its label/icon; the id is never rewritten |
| `planningKindDelete` (mutation) | `initiative-kind-delete` | remove a lane; refused while any initiative sits in it |
| `planningDoc` (mutation) | `doc-read` | read an initiative, task, goal or cycle markdown doc (empty when none yet) |
| `planningDocSave` (mutation) | `doc-save` | write it, and refresh the row's derived `summary` |
| `planningSprints` (query) | - | every sprint, newest window first; no tasks, no capacity grid |
| `planningSprintGet` (mutation) | `sprint-get` | one sprint with its tasks, the inferred initiatives and the computed capacity grid |
| `planningSprintUpsert` (mutation) | `sprint-upsert` | create or partially update; the gates below are 400s |
| `planningSprintTaskCreate` (mutation) | `sprint-task-create` | make a **sprint task** (no initiative) on one person-day: `sprint_id`, `title`, `assignee`, `slot_date`, optional `estimate_hours` |
| `planningSprintCheckinTick` (mutation) | - | tick one person's bucket on or off in a day's stand-up |
| `planningSprintCheckinComplete` (mutation) | - | close the day out; idempotent |
| `planningSprintDelete` (mutation) | `sprint-delete` | remove the sprint; its tasks are RELEASED, never deleted - its sprint tasks are deleted |

`GoalsController` (`@Controller('goals')`) and `CyclesController` (`@Controller('cycles')`), both
behind `AuthGuard`:

| tRPC | MCP | what |
|---|---|---|
| `goalsList` (query) | - | every goal with its reading, no daily series |
| `goalsGet` (mutation) | `goals-get` | all goals or one by `id`, each with health; the daily series is included for one goal, opt-in for all |
| `goalsUpsert` (mutation) | `goal-upsert` | create or partially update; `signal_id`, `target` and a window (or a `cycle_id`) are required on create; `initiative_ids` replaces the links; `outcome` `''` reopens; `clear_baseline` drops the override |
| `goalsDelete` (mutation) | `goal-delete` | remove a goal, its links and its doc |
| `goalsRename` (mutation) | `goal-rename` | change the slug; links and the doc follow |
| `goalsInitiativesSet` (mutation) | `goal-initiatives-set` | set the complete list of contributing initiatives |
| `goalsCarryForward` (mutation) | `goal-carry-forward` | continue an open goal in another cycle (see Goals) |
| `cyclesList` (query) | `cycles-get` | every cycle, newest window first |
| `cyclesUpsert` (mutation) | `cycle-upsert` | create or partially update; `start_date` / `end_date` are required on create |
| `cyclesDelete` (mutation) | `cycle-delete` | remove a cycle; its goals stay, outside any cycle, dates intact |

The two `doc-*` tools and `initiatives-get` / `sprint-get` are mutations because they carry an input
body and an input-less query is the only shape that reflects cleanly - the same call `sink` makes.
The check-in pair is tRPC-only: it is a dashboard interaction, not an agent one.

Refusals that come from the domain and surface as `400`s with the message intact: a goal whose signal is not registered, whose
`end_date` is before `start_date`, or that has no window and no cycle; a dependency
cycle or an unknown `blocked_by` id; an out-of-enum value; a title over the max (`assertTitleLength`
- "put the detail in the doc body, not the title"); `end_date` before `start_date`; any status past
`pending` without both dates; `planned` while any day is provably over capacity (the message names
the worst three person-days); a `slot_date` outside the sprint window; an `availability` key that is
not a known user (`assertKnownUser`).

The `cycle-board` powerup ([powerups/cycle-board/](powerups/cycle-board/POWERUP.md)) adds goals and
initiatives as board nodes, `cycleBoardSeed` / `cycle-board` and the cycle page's *Circuit board*
action. Without it the action is a note that says the cycle board is not set up and, for
administrators, drafts a Builder brief to add it.

## Actions

None. `manifest.ts` declares no `actions`, so planning contributes nothing to core's run funnel -
there is nothing here on a timer. What it *does* contribute is registered into core's signal
hooks port:

```ts
PLANNING_SIGNAL_HOOKS = {
  id: 'planning',
  channelRows: { github: computeSilkweavePrRows },   // task-ledger rows on the github channel
  derive:      deriveOssPrSignals,                    // re-derives github.silkweave_prs_merged
  onRename:    repointGoalSignals,                    // signal rename -> goals.signal_id
  references:  goalsReferencingSignal,                // "goal:<id>" list, guards a rename and a delete
}
```

`github.silkweave_prs_merged` is the cumulative count of `done` tasks across `oss-pr` initiatives,
dated by `done_at`, extended flat to today. Every task mutation, delete, move and rename calls
`deriveOssPrSignals()`, so the signal is never fabricated. `channelRows.github` keeps it alive when
the Data Sync recipe's `github` powerup re-derives the `github` channel, and `derive` runs inside
Data Sync's `warehouse-derive` action; a Box without Data Sync still gets the signal from the task
writes.

## Goals

A goal measures **one registered signal** (checked on write) over an inclusive window, against a
target. Initiatives link to goals through `goal_initiatives`; an initiative "somehow contributes",
with no weight. `goals.ts` (`measureGoal`) is pure and is the one implementation the Goals page, the
board, MCP and the goal events (`goal-events.ts`) all read; `goal-state.ts` is the warehouse side
(`readMeasuredGoals` is the measured view).

**Kinds.** The default comes from the signal's accumulation on create (`increment` -> `accumulate`,
otherwise `reach`).

- `reach`: move a level. Actual is the level as of today; expected is a line from the **baseline**
  to the target across the window. Direction comes from target versus baseline, not from the signal.
- `accumulate`: sum in the window. Actual is the running total of buckets that started inside it;
  expected is a line from 0 to the target across the window's days.
- `hold`: stay inside a bound. Every bucket that started inside the window is checked against the
  target with a `comparator` (`lte` stay at or under, the default; `gte` stay at or over). There is
  no pace line.

**Baseline.** Reach reads the level *entering* the window: the latest bucket that ended on or before
the window's first day (a monthly signal starting 2026-10-01 baselines on September). Failing that,
the first value inside the window. `baseline` on the goal overrides both. The reading says where the
baseline came from.

**Health** is a reading, never a verdict: `upcoming` (window not started), `no_data`, `on_track`,
`at_risk`, `off_track`, `met`. A goal is `met` when the target is reached (reach, accumulate); a hold
goal is `met` only once its window has ended without a breach. Otherwise it compares actual to the
pace. Trailing the pace is `at_risk` within the **tolerance** and `off_track` beyond it. Tolerance is
a share of the distance to target (reach), of the target (accumulate, hold). Accumulate compares
against the pace through *yesterday*, because today's bucket is still filling. Hold is `off_track`
when the latest value is outside the bound by more than the tolerance, `at_risk` when it is outside
by less or any earlier bucket breached. A snapshot signal whose latest observation is old enough that
"now" is a carried value reports `stale`. When the window has ended, a goal carries a
`suggested_outcome` (`met` or `missed`).

**Outcomes are soft.** Nothing closes a goal automatically. A person records `outcome` (`met`,
`missed` or `dropped`; `''` reopens). Health only suggests.

**Windows and buckets.** A bucket belongs to the window containing its start, with no proration. A
window that cuts through weekly or monthly buckets counts a straddling bucket wholly or not at all;
the reading carries an `alignment` so the UI can say so.

**Cycles** group goals into a period: `planned`, `active`, `review`, `closed`, each step moved by a
person. Choosing a cycle on a goal fills its missing dates from the cycle; after that the goal's
dates stand alone and a cycle edit never moves its goals. In `review` the Goals page lists the
cycle's goals with their suggested outcomes so the team records each one, and **carry forward**
(`goal-carry-forward`) continues an open goal in another cycle: a new goal with the same signal,
kind, target, comparator, owner, tags and links, the new cycle's dates and a fresh baseline, while
the old goal is closed with the outcome given (default `missed`). The new id defaults to the old id
with its cycle suffix swapped for the new cycle's.

**Gaps.** The Goals page lists open initiatives that contribute to no goal, and open goals with no
initiative, so unconnected work and unowned targets are visible rather than silent.

**Signal changes.** A signal rename re-points its goals through the hooks above. A signal delete is
not blocked by goals: core's delete report names them (`goal:<id>`), and a goal whose signal is gone
stays and reports a missing signal (no reading).

**Cascades.** Renaming or deleting an initiative updates or removes its `goal_initiatives` rows;
deleting a user clears the owner on their goals.

## Why the shapes are what they are

- **Two value axes, not one priority.** Something can be worth a lot to the people you serve and
  little to you, and collapsing that into one number loses the argument you need to have. Cost is a
  third, separate question - which is why size is its own field and never baked into a score - and
  `priority` is a fourth that answers none of them: it is "do this one first", said once value and
  cost are already on the table.
- **Hours, not a t-shirt scale.** `estimate_hours` replaced a four-step scale whose steps were hour
  RANGES, because four `m` tasks came out as 4-16h, which straddles every realistic working day, so
  a day's capacity check almost never had anything to assert. An estimate wrong by an hour beats a
  range that is right and says nothing. The four buckets survive as a display GROUPING only.
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
  sprint is just what leaving means, and is dropped silently. Getting that backwards shipped once,
  and made clearing `sprint_id` fail with "slot_date needs a sprint_id" on a call that never
  mentioned `slot_date`.
- **The slug path is enforced on CREATE only.** Two things reconstruct a task id rather than
  reading it - the dashboard route `/initiatives/<id>/<taskSlug>` and the doc path - so a row that
  breaks the shape has no page and no doc at all. It is create-only because a pre-existing row must
  stay updatable (a status flip should not fail over an id you cannot change from that surface),
  and because `rekeyTask` writes rows directly and never passes the guard.
- **`rekeyTask` derives its column list from the ModelSpec** (`modelColumns(TASKS)`, with only
  `id` / `initiative_id` / `rank` / `updated_at` overridden). It used to hand-write the list, so a
  new column missing from it was silently nulled on the next move or rename. Do not re-introduce a
  literal column list there.
- **Lead every doc with a plain-prose sentence.** `docSummary`'s `SKIPPABLE` set includes
  `**Label:**` lines, so a doc written entirely as bold-label blocks derives an EMPTY summary and
  the board shows a blank line under the title.

## UI

- **Routes** (all direct children of `rootRoute`):
  - `/goals` - the overview: health counts, a review panel while a cycle is in `review`, goal cards
    by cycle and the two gap lists. `/goals/cycles/$cycleId` is one cycle, `/goals/$id` is
    `GoalDetailView` (the reading, the pace chart, the contributing initiatives and the doc).
  - `/initiatives` - `InitiativesLayout` (shell + initiative sidebar); `/` is `InitiativesGrid`,
    `$id` is a pass-through `Outlet` whose `/` is `InitiativeDetailView` and whose `$taskSlug` is
    `TaskDetailView`. So a task is `/initiatives/<initiative>/<task>`.
  - `/sprints` - `SprintsLayout` (shell + a sidebar of every sprint); `/` is `SprintsIndex`, `$id`
    is an `Outlet` whose `/` and whose `$tab` are both `SprintDetailView`. `$tab` is
    `design|planning|board`; when the URL names none, the tab that opens is chosen from the
    sprint's status.
- **Nav**: three entries in band **200-299** - `Goals` (icon `Goal`, order 200), `Initiatives`
  (icon `Target`, order 205) and `Sprints` (icon `CalendarRange`, order 210). All three declare
  the sidebar's Operations section (`{ id: 'operations', label: 'Operations', order: 300 }`). The initiatives grid has a `goals` column (the legacy `signal` key is
  mapped to it), and the initiative detail shows "Contributes to" goal cards with a picker and
  "New goal". Sprints is its own group rather than a tab inside Initiatives
  because a sprint has its own lifecycle and the board is a daily-driver surface.
- **Settings**: one section, `initiative-kinds` - "Initiative kinds", icon `Tags`, order 200,
  rendering `InitiativeKindsSection`.
- **Shell / onSession / slots**: none. Planning contributes no topbar cluster, no session hook and
  no slot, and it defines no slot of its own - a dependent feature reuses planning's status
  components by direct import (declared via `dependsOn`), not through a slot.
- **The sprint surfaces** (2026-09-14): the Planning backlog filters by owner, by **tag** and by
  "due in this window" - the tag filter matches the TASK's own tags, never its initiative's, since a
  per-task pick like `sprint` would otherwise pull in every open task under a tagged initiative.
  Every person-day on the grid carries a faint **"Add task"** under its cards
  (`NewSprintTaskDialog`: title + estimate, the cell supplies owner and day). **Your own column comes
  first** on the grid and on the Board's stand-up lanes alike - `rosterOf(sprint, activeUserId)`.
  Design draws the calendar whenever the sprint has a window, even with an empty roster: the ghost
  column is the only place a person can be added, so hiding it left a new sprint with no way onto it.
- **`TaskDialog`** carries the task's fields and its doc, and since 2026-09-14 **deletes** it
  (confirmed, footer). A SPRINT task opens here and only here - `SprintDetailView` hands it
  `sprintTasks`, since the board store it otherwise reads holds only initiative tasks - labelled
  "Sprint task · no initiative" and without "Open full page", because it has no task page to open.
- **Stores**: `usePlanningData` reloads on `table:initiatives`, `table:tasks` and `docs:initiatives`;
  `useGoalsData` on the goal, cycle and link tables;
  `useSprintsData` on `table:sprints` (the per-sprint detail is not a `createDataStore` because it
  is parameterised by id). The kind list is config, not a table, so it has no change-feed topic - it
  reloads after a local write and otherwise on the next page load.

## Settings

One, in `box.json`: `features.planning.goalTolerance`, a share from 0 to 1 (default `0.1`, that is
10%). It is how far a goal may trail its pace and still read `at_risk` rather than `off_track`; a
value that is not a number in range falls back to the default. The feature reads no environment
variables. Initiative kinds are config too (see below).

## Admin-only

Since 2026-09-13 the Box has two tiers (`docs/AUTH.md`, "The two tiers"), and the rule every feature applies is
one sentence: **an operation is admin-only when its blast radius is another person's identity or
credential, the service itself, or configuration wired to credentials.**

This feature's admin set is `initiative-kind-save`, `initiative-kind-delete`.

The kinds are the team's vocabulary, which every initiative's enum validates against. Initiatives,
tasks, sprints and docs are a member's.

## What a team customises

- **`PlanningStatus`** (`features/planning/core/types.ts`) -
  `planned · active · blocked · done · dropped`, ONE vocabulary for initiatives and tasks, with
  `TERMINAL_PLANNING_STATUSES = ['done', 'dropped']`. Its labels and tones live in
  `features/planning/web/planning-types.ts` (`PLANNING_STATUS_META`) and its icons and
  colors in `components/status.tsx` (`PLANNING_STATUS_UI`). A dependent feature may reuse this list, so
  an edit here reaches its records too.
- **`SprintStatus`** - `pending · scheduled · planned · active · done`. Deliberately not
  `PlanningStatus`: a sprint is a window with capacity, and `blocked` / `dropped` mean nothing for
  one. Nothing enforces "at most one active sprint".
- **Initiative kinds** - NOT an enum. A flat, label-sorted set in
  `box.json features.planning.initiativeKinds`, edited from Settings or via
  `initiative-kind-save` / `-delete`. The ten the predecessor shipped with (`bug`, `business`,
  `channel-growth`, `decision`, `general`, `infra`, `capability`, `oss-pr`, `product`, `strategy`)
  are a SEED written on first use, not a floor; `seeded` is what stops them coming back after a
  delete. `DEFAULT_INITIATIVE_KIND = 'general'` is the fallback and cannot be deleted, and an id is
  immutable once created (it is the value on every row, and `oss-pr` is read by name by the derived
  signal).
- **`ValueLevel`** - `high · med · low · none`, on two axes (`value_customer`, `value_company`).
  `none` means "we looked, it is zero"; NULL means "not judged yet".
- **`Priority`** - 1-3 stars, NULL unrated, one axis for initiatives and tasks.
  `normalizePriority` clears anything outside the range.
- **Estimates** - `MIN_TASK_HOURS = 1`, `MAX_TASK_HOURS = 8`, whole hours. `normalizeEstimateHours`
  rounds and CLAMPS rather than rejecting. An initiative has no size of its own: it is the sum of
  its tasks (`lib/effort.ts`), bucketed for display by `EFFORT_HOURS`
  (`s` <8h, `m` <40h, `l` <160h, `xl` beyond) with labels in `EFFORT_META` and hints in
  `EFFORT_HINT`.
- **Sprint capacity** - `DEFAULT_SPRINT_HOURS = 5` (not 8, on purpose) and
  `UNDER_UTILISATION_RATIO = 0.6` in `sprints.ts`. Weekends are capacity 0 unless the sprint's
  `hours_by_date` names the day, which wins outright.
- **Check-in buckets** - `CHECKIN_BUCKETS = ['done', 'today', 'slipping']`, declared twice on
  purpose (`features/planning/core/state.ts` and
  `features/planning/web/sprint-types.ts`); change both.
- **Goal vocabulary** - `GoalKind` (`reach`, `accumulate`, `hold`), `GoalComparator`, `GoalOutcome`
  (`met`, `missed`, `dropped`), `GoalHealth` and `CycleStatus` in `features/planning/core/types.ts`,
  and `goalTolerance` (see Settings). Stored enums need a migration to change.
- **Nav labels and order** (band 200-299) and the settings section's label, in
  `features/planning/web/index.tsx`.
