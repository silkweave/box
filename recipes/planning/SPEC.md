# `planning` - initiatives and tasks

The body of work and the argument for it. An **initiative** is a body of work: it carries a kind, a
status, impact and effort (an impact x effort quadrant), a priority, an owner, tags, a start and a
due date, and it is the root container for its items. **Items** are the tasks, nested under each
other by `parent_id` to any depth; a **standalone item** belongs to no initiative (`initiative_id`
NULL). A task is sized in whole hours, and an initiative's progress is done hours over total hours.
Initiatives and items are identified by **keys** the server assigns on create and never changes:
`I1`, `I2`, ... for initiatives and `T1`, `T2`, ... for items. Structured state lives in three
warehouse tables; the long-form rationale lives in markdown on disk, and the row's one-line
`summary` is derived from that doc rather than typed.

This is the base recipe. Optional capabilities are powerups, each documented in its own folder with
the reference code it owns and the seams it touches in the files below:

| Powerup | Adds | Requires |
|---|---|---|
| [goals](powerups/goals/POWERUP.md) | goals with an optional measured target, cycles, the Goals pages, an initiative's contributed goals | - |
| [milestones](powerups/milestones/POWERUP.md) | the `milestone` item kind, measured by its tasks or a signal, outcome cards, initiative health | - |
| [sprints](powerups/sprints/POWERUP.md) | sprints with per-person capacity, the planning grid and the stand-up board | - |
| [timeline](powerups/timeline/POWERUP.md) | the Timeline layout of the Initiatives board | - |
| [cycle-board](powerups/cycle-board/POWERUP.md) | a cycle's goals and initiatives laid out as one board | goals; see its POWERUP.md |
| [mobile](powerups/mobile/POWERUP.md) | the Plan tab of the Box mobile app | Mobile app |

The reference implementation in `features/planning/` carries the base and every powerup. Code that
belongs to a powerup is marked `<name> powerup:` where it sits; [INSTALL.md](INSTALL.md) lists the
files and seams so an adapting agent can leave out what the Box does not want.

- **dependsOn**: nothing. Signals, measures and saved views are core (`docs/SIGNALS.md`).
  Core-side, `state.ts` imports `refreshMeasureSignals` / `repointMeasureParam`
  (`@silkweave/box-core/signals/measure-derive`) so task writes refresh the signals bound to the
  base measure. The server module registers `TASKS_DONE_MEASURE` into core's `registerMeasure` port
  and `unassignDeletedUser` into `registerUserCleanup` from `onModuleInit`. Web-side,
  `InitiativeKindsSection` imports core's `apps/web/src/presets/presetIcons.tsx` so a kind picks
  from the same closed icon vocabulary a preset does, and the Initiatives board and All tasks use
  core's saved views (`apps/web/src/presets/`, preset modules `initiatives` and `tasks`).
  Initiative deletes call the hooks in `core/identity-hooks.ts` (`registerPlanningIdentityHooks`),
  a base seam a powerup can follow; the goals powerup calls them for goal renames and deletes, and
  the `cycle-board` powerup is the one that registers them.
- **Depended on by**: any feature that declares `dependsOn: ['planning']`, for example to reuse
  `PLANNING_STATUSES` and `PlanningStatus` in its own models and types and planning's
  `StatusSelect` / `StatusLabel` in its web views.
- **Removal**: remove planning only after adapting or removing every feature that depends on it,
  and every planning powerup. Without planning, core's signals keep working but lose the
  `planning.tasks_done` measure (signals bound to it keep their binding and points, and
  `warehouse-derive` warns).

## Tables

Three, `initiatives` and `tasks` with `timestamps: true` and `audit: true` (so every row carries
`created_at` / `updated_at` / `created_by` / `updated_by`).

| table | pk | what it holds |
|---|---|---|
| `initiatives` | `id` (key, `I1`) | title, derived `summary`, `status` (enum `PLANNING_STATUSES`), `kind` (enum from `box.json features.planning.initiativeKinds`), `owner`, `impact` (enum `IMPACT_LEVELS`), `effort` (enum `EFFORT_SIZES`), `start_date`, `due_date`, `priority` 1-3, `tags` JSON, `doc_path`, `sort` |
| `tasks` | `id` (key, `T1`) | the items. `kind` (always `task` in the base), `parent_id` (same initiative), `initiative_id` (NULL = standalone), title, derived `summary`, `status`, `rank`, `score`, `priority` 1-3, `estimate_hours` 1-8, `tags`, `assignee`, `metadata` JSON, `start_date`, `due_date`, `done_at` |
| `planning_keys` | `prefix` | the key counters: `last` is the highest number handed out for `I` (initiatives) and `T` (items); a number is never reused |

Powerups add tables and columns, declared in the same `core/models.ts` and marked there: goals
adds `goals`, `cycles` and `initiatives.goal_ids`; milestones adds `tasks.outcome`, `signal_id`,
`measure_kind`, `target` and `baseline` (and gives `tasks.kind` its second value); sprints adds
`sprints`, `sprint_checkins`, `tasks.sprint_id` and `slot_date`. A base-only Box leaves them out of
its `models.ts`.

The `ModelSpec`s are baselined with `CREATE TABLE IF NOT EXISTS` on every boot, so a fresh Box gets
the declared shape in one shot. The reference `core/manifest.ts` declares `migrations: []`. A Box's
own schema changes append to that list (one table-altering statement each, docs/WAREHOUSE.md,
"Working rules"); a powerup added to a Box that already runs planning brings the column migrations
its INSTALL.md names.

### Items

`kind` is `task` in the base. A kind registry in code (`ITEM_KIND_REGISTRY` in
`features/planning/core/items.ts`) says per kind which fields it may carry, its status rule (manual)
and whether it counts as work; writes are checked against it. The milestones powerup adds the
`milestone` kind; without it the column stays and every row is a task.

- **Ids** are keys: `I<n>` for an initiative, `T<n>` for an item. The `planning_keys` table
  (prefix, last) hands the numbers out; a number is never reused, even after a delete. A create
  passes no `id` (a title is required) and the created object comes back with its key; an explicit
  well-formed unused key is accepted (an import) and moves the counter past it, while an id that is
  not a key is refused. Keys never change: re-parenting and `task-move` keep them. `~`
  (`NO_INITIATIVE`) is only the All tasks "In" filter value and the `to_initiative_id` meaning "no
  initiative".
- **Nesting** by `parent_id`, unlimited depth. A parent is in the same initiative, a move cannot
  close a loop, and `task-move` carries the whole sub-tree to another initiative (or out to
  standalone with `to_initiative_id: ''` or `'~'`), landing the moved item at the top level of the
  destination. Within one initiative `task-move` only sets the rank. `initiative_id` never changes
  through `task-upsert`.
- **Work items** (`workItems`, one helper): live `kind = task` leaves. A task with children counts as
  the sum of its children and its own estimate is ignored. Dropping an item drops its whole sub-tree
  from every count. Initiative progress, `planning.tasks_done`, done counts, All tasks, the
  dashboards, and the powerups (sprint capacity, milestone progress, mobile) all read it.
- **Parent tasks** have a manual status. Closing one with open children asks first; when every child
  is done the UI highlights the parent and recommends completing it (`children_done`).
- **Delete** re-parents the item's children to its parent (top level if none).
- **Standalone items** are created by an ordinary `task-upsert` with no `initiative_id` (or `''`);
  joining an initiative later is a `task-move`. A new one ranks after the other standalone items. A
  standalone item may nest under another. They are on no initiative page and count towards no
  initiative's progress; the flat `planningTasks` / `tasks-get` return them (`initiative_id: ''` or
  `'~'` for only those). `planning.tasks_done` counts them only without an `initiative` or `kind`
  parameter.

## Docs on disk

`data/docs/`, from core's `docsDir()`. The base doc kinds are `initiative` and `task` (the goals
powerup adds `goal` and `cycle`):

- initiative `I1` -> `docs/initiatives/I1.md`
- item `T3` under `I1` -> `docs/initiatives/I1/T3.md`
- standalone item `T7` -> `docs/tasks/T7.md`

The path is a pure function of the key and the item's initiative (`doc-read` and `doc-save` take the
kind and the key; the server finds an item's folder from its initiative). Initiative and item
segments must be well-formed keys, and the resolved absolute path is re-checked to start with the
base dir + separator before anything is read, written or renamed
(`features/planning/core/docs.ts`, `absPath`) - the same traversal guard `sink` uses. A `task-move`
moves the docs of the item and its sub-tree between folders (to or from standalone, between
`docs/initiatives/<initiative>/` and `docs/tasks/`) all-or-nothing, and writes the rows in one
transaction; a failed transaction moves the docs back.

`savePlanningDoc` is the only writer of `summary`: it writes the file, then refreshes the row's
cached one-line preview via `docSummary()` (first real paragraph, with frontmatter, headings, rules,
`**Status:**`-style metadata lines, bullets, tables and fences skipped, flattened, capped at 240
chars). It never CREATES a row, and an item's doc needs the item to exist first (`doc-save` refuses
an item doc for a missing item): create the row, then save the doc.

## Procedures and tools

`PlanningController` (`@Controller('planning')`, class-level `@UseGuards(AuthGuard)`): tRPC
procedures, most of them also MCP tools. Every tRPC name is `planning`-prefixed on the wire (the
controller's own doc comments drop the prefix; `apps/web/src/generated/appRouter.d.ts` is the
truth). The powerups add their own procedures and fields; each POWERUP.md lists them.

| tRPC | MCP | what |
|---|---|---|
| `planningInitiatives` (query) | - | every initiative with its items nested and the derived `quadrant` and `progress` (hours); each item carries its derived `child_count`, `children_done`, `hours_total` and `hours_done` |
| `planningInitiativesGet` (mutation) | `initiatives-get` | the same, all or one by `id` - the read entry point for a remote session |
| `planningTasks` (query) | - | every item flat, standalone ones included (the All tasks page) |
| `planningTasksGet` (mutation) | `tasks-get` | the same, all or one initiative's (`initiative_id`), or only the standalone ones (`initiative_id: ''` or `'~'`) |
| `planningInitiativeUpsert` (mutation) | `initiative-upsert` | create (no `id`; a title is required, the key comes back) or partially update one; `impact`, `effort` (`''` clears), `start_date`, `due_date` |
| `planningInitiativeDelete` (mutation) | `initiative-delete` | remove it with its items |
| `planningTaskUpsert` (mutation) | `task-upsert` | create or partially update an item: create with no `id` (a title is required; `initiative_id` names the initiative, omitted or `''` makes a standalone item, and the key comes back); `parent_id` (`''` = top level), `start_date`, `due_date`; `0` clears `priority` / `estimate_hours` |
| `planningTaskSetStatus` (mutation) | `task-set-status` | the quick action |
| `planningTaskDelete` (mutation) | `task-delete` | remove an item; its children move up to its parent |
| `planningTaskMove` (mutation) | `task-move` | move an item and its whole sub-tree to another initiative, keeping every key and moving the docs; the moved item lands at the top level of the destination. `to_initiative_id: ''` or `'~'` makes it standalone; within the same initiative it only sets rank |
| `planningTasksReorder` (mutation) | `tasks-reorder` | sequential `rank` within one initiative |
| `planningInitiativesReorder` (mutation) | `initiatives-reorder` | sequential `sort` |
| `planningKinds` (query) | `initiative-kinds` | the team's kind list, by label, each with its initiative count |
| `planningKindSave` (mutation) | `initiative-kind-save` | create a lane or edit its label/icon; the id is never rewritten |
| `planningKindDelete` (mutation) | `initiative-kind-delete` | remove a lane; refused while any initiative sits in it |
| `planningDoc` (mutation) | `doc-read` | read an initiative or item markdown doc by kind and key (empty when none yet) |
| `planningDocSave` (mutation) | `doc-save` | write it, and refresh the row's derived `summary` |

The two `doc-*` tools and `initiatives-get` / `tasks-get` are mutations because they carry an input
body and an input-less query is the only shape that reflects cleanly - the same call `sink` makes.

Refusals that come from the domain and surface as `400`s with the message intact: a parent in
another initiative or one that closes a loop; an item id that is not a key, or a create without a
title; a field the item's kind cannot carry; a move onto an existing doc; a `task-move` to an
initiative that does not exist; an out-of-enum value; a title over the max (`assertTitleLength` -
"put the detail in the doc body, not the title"); a date that is not `YYYY-MM-DD`.

## Actions

None. `manifest.ts` declares no `actions`, so planning contributes nothing to core's run funnel -
there is nothing here on a timer. What the base registers into core's ports:

```ts
registerMeasure(TASKS_DONE_MEASURE)                    // planning.tasks_done
registerUserCleanup('planning', unassignDeletedUser)   // initiative owner, task assignee
```

**`planning.tasks_done { kind?, initiative?, since? }`** (`core/measures.ts`) is the running total
of `done` tasks, dated by `done_at` (team day), one point per day with a change and carried to
today. `kind` keeps tasks under initiatives of that kind, `initiative` one initiative's tasks,
`since` counts from that day (with the goals powerup, a goal's own signal sets it to the goal's
start). Any signal can bind it (`signal-upsert` with `measure_key` and `measure_params`). Every task
write, delete and move refreshes the signals bound to it, and Data Sync's `warehouse-derive`
recomputes it with every other measure; a Box without Data Sync still gets it from the task writes.

A deleted user is set back to NULL as an initiative's `owner` and a task's `assignee`; the rows
survive, unclaimed.

## Initiatives

**Derived on read**: `quadrant` from `impact` x `effort` (quick win = `high`/`med_high` impact with
`s`/`m` effort, big bet = the same impact with `l`/`xl`, fill-in = `med_low`/`low` with `s`/`m`,
money pit = `med_low`/`low` with `l`/`xl`, `unrated` while either is missing); `progress` = done
hours / total hours over its work items, a missing estimate counting as 1h (null without work).
`effort` is set by hand; the sum of the work items' hours shows beside it. A base-only Box shows
hours progress only; initiative `health` is the milestones powerup.

## Why the shapes are what they are

- **Impact and effort, not a score.** Two hand-set four-step axes place an initiative in a
  quadrant a team can argue about; a computed score would hide the argument. `priority` answers
  neither: it is "do this one first", said once impact and effort are on the table.
- **Hours, not a t-shirt scale.** A four-step scale whose steps are hour RANGES turns four `m`
  tasks into 4-16h, which straddles every realistic working day, so a day's capacity check almost
  never has anything to assert. An estimate wrong by an hour beats a range that is right and says
  nothing. Four buckets remain as a display GROUPING only.
- **Keys come only from `allocateKey`.** The dashboard route `/initiatives/<key>/<key>` and the doc
  path are built from the key, so an id that is not a well-formed key has no page and no doc at all.
  `allocateKey` serialises allocation in-process, reads the `planning_keys` counter (or the highest
  key in use if that is higher) and advances it, so a number is never reused.
- **`task-move` writes only `initiative_id`, `parent_id` and `rank`.** It never rewrites a row, so a
  new column cannot be lost on a move.
- **Lead every doc with a plain-prose sentence.** `docSummary`'s `SKIPPABLE` set includes
  `**Label:**` lines, so a doc written entirely as bold-label blocks derives an EMPTY summary and
  the board shows a blank line under the title.

## UI

- **Routes** (all direct children of `rootRoute`):
  - `/initiatives` - `InitiativesLayout` (shell + initiative sidebar); `/` is `InitiativesGrid`,
    `$id` renders `InitiativeDetailView` for both `/initiatives/$id` and `/initiatives/$id/$task`
    without remounting. The right panel shows the open item (`ItemPanel`) at `/initiatives/I1/T3`
    (the initiative's key, then the item's), else the initiative's description (`InitiativePanel`).
  - `/tasks` - `TasksLayout` (shell + a sidebar of the team's presets) whose `/` is `TasksView`, the
    All tasks page (below). An item opens in the right panel beside it at `/tasks/T3`, so every
    item has a shareable address.
- **Nav**: two entries in band **200-299** - `Initiatives` (icon `Target`, order 205) and `All
  tasks` (icon `ListChecks`, order 207), both in the sidebar's Operations section (`{ id:
  'operations', label: 'Operations', order: 300 }`). The goals (order 200) and sprints (order 210)
  powerups add theirs in the same band.
- **The initiatives board** (`InitiativesGrid`) has two layouts under one view bar: the list and
  the status board (the timeline powerup adds a third). The list is a `full` DataGrid with
  `arrangeTop`: the view arranges the initiatives (which cannot be dragged), each folds its tasks as
  a tree (open initiatives, folded items and folded groups are kept per browser), and an item drags
  in every view: within its initiative, nested under another item, or into another initiative's
  tree, across groups too (written as `TaskMove`, the parent, then the destination's rank order; a
  refusal puts it back and shows the reason). An initiative row's "+" adds a task. Optional list
  columns: kind, impact, effort (the hand-set step with the sum of the tasks' hours beside it),
  quadrant, priority, progress, start, due and tags (the goals powerup adds goals). Kind is a
  leading column: on by default and first, it draws the kind's icon (the kind name as tooltip,
  click to change it) in a 48px square at the row's left edge; moved later in the column order it
  sits after the name. Rows are 48px; an initiative shows its summary as a second line, a task does
  not; its count badge counts the items directly under it (dropped ones left out). Filters are
  typed (kind, status, impact, effort, quadrant and tags any of; owner a person; due and start
  dates) and group-by covers impact, effort and quadrant; presets pin filters to the bar (the seeds
  pin Owner with Status, Kind or Quadrant). The board's cards carry impact,
  effort, quadrant and progress. The seeded presets include "Quick wins" (the quick-win quadrant).
- **The right panel** replaces any task dialog everywhere, dashboards included. On wide screens it
  is a split pane beside the list (`SplitPane`, Esc closes, the list stays clickable); on narrow
  screens it is a push view that slides in from the right and closes back to the page. `ItemPanel`
  is the one item panel: a top bar with the initiative's name on the left (a link to the initiative
  page, or "No initiative") and copy link on the right (there is no close button; Esc closes), then
  the title, the "all children done, complete it?" banner, the item's fields, the children list
  with quick add (left out beside the initiative page's tree, which already shows them), the notes
  doc and delete. The fields sit in a grid of 2, 4, 6 or 8 columns by panel width, Tags and URL
  taking two columns each. There is no Parent field: nesting is changed by dragging in the
  initiative page's tree, and an item moves to another initiative by dragging in the Initiatives
  grid or with `task-move`.
- **The initiative page** (`InitiativeDetailView`): the title row, with the kind as an icon button
  left of the title; directly under it the fields Owner, Priority, Start date, Due date, "Impact and
  effort" (one addon group: the impact select, the effort select and the derived quadrant label) and
  Tags, in a grid of 2, 4, 6 or 8 columns by width. The description is the right-hand doc panel, not
  a preview under the title. Then the foldable **Tasks** section (the fold sticks per browser). The
  tree (`ItemTree`) is a `section` DataGrid (`@silkweave/box-ui/datagrid`, its rules running to the
  pane's edges) with the heading left and its bar right (search, sort by plan order, due, priority
  or name, columns, typed filters by progress (open or finished), status, owner, due date, priority
  and estimate, no pins; columns and sort are
  kept per browser), no height cap, and a footer with the counts and column totals. Rows indent by
  depth, the fold chevron at the name's right end; a task shows a muted dot (`TaskMark`), a parent
  task the sum of its children's hours, and a task whose children are all done a check button. In
  plan order, unfiltered, dragging a row by its mark (or arrow keys on it) up or down reorders it,
  right nests it under the row above, left lifts it out, and the sub-tree travels with it; the move
  shows at once and is written as the parent change plus the initiative's whole rank order. A row's
  "+" adds a task under it; the bottom row adds a task. Closing an item with open children asks
  first. Counts and effort roll up over work items. The milestones powerup adds outcome cards above
  the tree and the goals powerup a Goals section below it.
- **Creating items**: `NewTaskDialog`, the tree's quick-add and a row's "+" create tasks.
- **All tasks** (`TasksView`): every task flat, whichever initiative holds it, standalone tasks
  included (parent tasks stay), the In column a breadcrumb of the initiative and parent titles,
  from its own store (`useAllTasks`, reloading on `table:tasks` and `table:initiatives`; the task
  writes in `usePlanningData` patch it too). Open tasks by default; the sidebar eye adds done and
  dropped ones, and the profile menu's "Only my items" narrows it to your own. The core view bar
  over it (`lib/taskView.ts`, preset module `tasks`) has a list and a status board, search,
  group-by (status, owner, initiative), sort (due, priority, estimate, title), columns (In, due,
  status, owner, priority, estimate) and filters: **Initiative**, which always offers **No
  initiative** (`~`, only standalone items) first beside the initiatives in use, Status, Owner (a
  person field with **Me** and **Nobody**), Due (a date field: relative windows or a range),
  Priority and Estimate (a number field, hours). Presets pin filters to the bar (the seeds pin Owner
  and Due). The seeded presets are Open tasks (the landing view), Mine, No
  initiative, Overdue, This week, By initiative and Board. Rows edit in place with the initiative
  page's cells; there is no drag to reorder, since rank is an order within one initiative. **New
  task** asks for the initiative, starting on **No initiative**, with title, status, owner (you),
  due date and URL.
- **Settings**: one section, `initiative-kinds` - "Initiative kinds", icon `Tags`, order 200,
  rendering `InitiativeKindsSection`.
- **Shell / onSession / slots**: none in the base. Planning contributes no topbar cluster and no
  session hook; a dependent feature reuses planning's status components by direct import (declared
  via `dependsOn`), not through a slot. The goals powerup defines the `planning.cycle.actions` slot
  the cycle-board powerup fills.
- **Stores**: `usePlanningData` reloads on `table:initiatives`, `table:tasks` and
  `docs:initiatives`. The kind list is not a table, so it has no change-feed topic - it loads once
  per page and reloads after a local write.

## Settings

The base has no tunable besides the initiative kinds (below). The goals and milestones powerups
read `box.json features.planning.healthTolerance`. The feature reads no environment variables.

## Admin-only

The Box has two tiers (`docs/AUTH.md`, "The two tiers"), and the rule every feature applies is one
sentence: **an operation is admin-only when its blast radius is another person's identity or
credential, the service itself, or configuration wired to credentials.**

This feature's admin set is `initiative-kind-save`, `initiative-kind-delete`.

The kinds are the team's vocabulary, which every initiative's enum validates against. Initiatives,
tasks and docs are a member's.

## What a team customises

- **`PlanningStatus`** (`features/planning/core/types.ts`) -
  `planned · active · blocked · done · dropped`, ONE vocabulary for initiatives and tasks, with
  `TERMINAL_PLANNING_STATUSES = ['done', 'dropped']`. Its labels and tones live in
  `features/planning/web/planning-types.ts` (`PLANNING_STATUS_META`) and its icons and colors in
  `components/status.tsx` (`PLANNING_STATUS_UI`). A dependent feature may reuse this list, so an
  edit here reaches its records too.
- **Initiative kinds** - NOT an enum. A flat, label-sorted set in
  `box.json features.planning.initiativeKinds`, edited from Settings or via
  `initiative-kind-save` / `-delete`. The ten the reference ships with (`bug`, `business`,
  `channel-growth`, `decision`, `general`, `infra`, `capability`, `oss-pr`, `product`, `strategy`)
  are a SEED written on first use, not a floor; `seeded` is what stops them coming back after a
  delete. `DEFAULT_INITIATIVE_KIND = 'general'` is the fallback and cannot be deleted, and an id is
  immutable once created (it is the value on every row, and `planning.tasks_done` signals filter by
  it).
- **`ImpactLevel`** - `high · med_high · med_low · low`, and **`EffortSize`** - `s · m · l · xl`,
  NULL meaning "not judged yet". `quadrantOf` maps the pair (see Initiatives).
- **`Priority`** - 1-3 stars, NULL unrated, one axis for initiatives and tasks.
  `normalizePriority` clears anything outside the range.
- **Estimates** - `MIN_TASK_HOURS = 1`, `MAX_TASK_HOURS = 8`, whole hours. `normalizeEstimateHours`
  rounds and CLAMPS rather than rejecting. An initiative's `effort` is set by hand; the sum of its
  tasks' hours is shown beside it.
- **Nav labels and order** (band 200-299) and the settings section's label, in
  `features/planning/web/index.tsx`.
