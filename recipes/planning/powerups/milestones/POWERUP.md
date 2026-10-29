# Milestones

Delivered outputs in the task tree: a milestone is an item measured by the tasks beneath it or by a signal, reads met, missed, on track or off track from that, and the outcome milestones give an initiative its health.

## Highlights

- Tasks and milestones are one record, nested under each other to any depth; a Task / Milestone switch turns one into the other
- A milestone is measured by its tasks (hours, 1h by default) or by a signal (reach or accumulate, with a target), and reads met, missed and on track or off track from that
- Milestone windows inherit from the milestone above or the initiative, and are checked on every write
- Outcome milestones show as cards at the top of the initiative, and the initiative's health is the worst of theirs
- "New signal" in the milestone editor creates a manual signal for a milestone that has none

## Needs

- Nothing outside the Box: core's signals

## Requires

- The Planning recipe only.

## How it works

**Columns.** The `milestone` value of `tasks.kind` (the column is base, always `task` without this
powerup) and five columns on `tasks`: `outcome` (BOOLEAN, NOT NULL, default false), `signal_id`
(text, no FK), `measure_kind` (`reach` or `accumulate`, enum `MILESTONE_MEASURE_KINDS`), `target`
and `baseline` (DOUBLE). No table of its own: milestones share the `T` key counter with tasks, so
switching an item's kind keeps its key.

**The kind registry** (`ITEM_KIND_REGISTRY` in `core/items.ts`) gains the `milestone` entry:
milestone-only fields are `outcome`, `signal_id`, `measure_kind`, `target`, `baseline`; task-only
fields are `estimate_hours` (and, with the sprints powerup, `sprint_id`, `slot_date`). A milestone
is not work: `workItems` skips it. Nesting is any kind under any kind (a milestone under a task, a
task under a milestone, a milestone under a milestone). A kind change must clear what the new kind
cannot carry; the panel's switch does it after a confirm when such a field is set.

A milestone is measured one of two ways.

- **By tasks** (no `signal_id`): progress = done hours / total hours over the work items in its
  sub-tree (nested milestones' tasks included), a missing estimate counting as 1h. Met when all are
  done (at least one).
- **By a signal**: `measure_kind` `reach` (the value hits `target` inside the window) or
  `accumulate` (the window sum hits `target`). `signal_id`, `measure_kind` and `target` are set
  together or not at all; `baseline` applies to reach only and, when null, is read from the signal
  at the start date (`goalBaseline`). `measure_kind` defaults from the signal's accumulation
  (`defaultGoalKind`). Attainment counts only observations inside the window: a level carried in
  from before it reads as on track, never met. Hold is goal-only.

Everything below is derived on read, nothing is stored: `state` (`active`, `met`, `missed`; missed =
effective due date passed and not met), `progress` (0..1), `health` (`upcoming`, `no_data`,
`on_track`, `at_risk`, `off_track`, `met`: actual against the straight line over the window, with
the tolerance), the effective window and, for signals, `actual`. A task milestone without a window
is never missed or behind. `status` stays manual: a milestone closed by hand while its measurement
says missed shows its status as-is. The measurement is the shared target measurement
(`core/measure.ts`: `measureGoal`, `goalBaseline`, `defaultGoalKind`, `healthTolerance`), the same
code the goals powerup judges goals with; a milestones-only Box keeps it without any goal.

**Window**: the milestone's own `start_date` / `due_date`, else the nearest milestone ancestor's
effective window, else the initiative's, inherited field by field (`effectiveWindows`). It must lie
inside the nearest milestone ancestor's window and the initiative's, and a signal milestone needs an
effective start and due date. A write is refused only for problems it adds, and the message names
each milestone. The same check runs on `initiative-upsert` date changes and on `task-move`.
Deleting an item writes each affected milestone's inherited start and due onto it before its
children move up, so no effective window changes.

**Outcome milestones** (`outcome = true`) are the milestones that matter to the initiative's
result. They stay in the tree and also show as cards at the top of the initiative (any depth), and
may have subtasks. An initiative's `health` is the worst health of its live outcome milestones
(`initiativeReading`, `worstHealth`: off track, at risk, no data, upcoming, on track, met; null
without any). Its `progress` stays the base hours progress.

**Ad-hoc signals**: "New signal" in the milestone editor creates a manual signal on channel
`planning` labelled with the milestone title and no ownership link. Signals are archived by hand
(core `signals.archived_at`, `signal-archive` / `signal-unarchive`, admin-only): archived signals
are hidden from pickers and the Signals page, and stay readable. `MILESTONE_SIGNAL_HOOKS`
(`core/state.ts`, id `planning.milestones`) is registered into core's `registerSignalHooks`: a
signal rename re-points `tasks.signal_id` (`repointItemSignals`), and deleting a signal leaves the
milestones bound to it in place with no reading (the delete report names them `task:<id>`,
`itemsReferencingSignal`).

## Procedures and tools

No procedures of its own. Milestones are items written with `task-upsert`: `kind` (`task` or
`milestone`), `outcome`, and the measure (`signal_id` (`''` clears the whole measure),
`measure_kind`, `target`, `baseline`, `clear_baseline`). There are no `milestone-*` tools. Every
item read (`initiatives-get`, `tasks-get`) carries, for milestones, `progress`, `state`, `health`,
`window_start`, `window_end` and `actual`, and each initiative its `health`. Refusals (400s): a kind
change that leaves fields the new kind cannot carry; a half-set measure; a milestone window outside
its ancestor's or the initiative's (the message names each milestone).

## UI

- **The item panel** (`ItemPanel`): the Task / Milestone switch (`KindToggle`) as the header's
  leading control, the outcome star (`OutcomeStar`), the milestone measure editor (`MeasureEditor`:
  Tasks or Signal toggle; signal, counts as reach or accumulate, target and baseline save together;
  "New signal"), the inherited-window hints on the date fields, and a kind control in the children
  quick add (`QuickAddChild`).
- **The initiative page**: the outcome milestones as cards (`OutcomeCards`: reading, progress and
  state) between the fields and the Tasks tree. In the tree (`ItemTree`) a milestone row shows a
  filled accent diamond (`MilestoneMark`, its state in the tooltip), a progress bar
  (`MilestoneProgressCell`) and a state chip (`MilestoneStateChip`); the footer counts "N of M
  milestones met"; effort excludes milestones. A row's "+" adds a task or a milestone under it. A
  refused re-parent (a window) puts the row back and is shown in a dialog.
- **The Initiatives board**: milestone rows in each initiative's tree, with the same marks, and the
  board's filters keep a milestone that holds a kept task (`applyView`).
- **All tasks** lists tasks only: milestones open from their initiative.
- **Markdown export** (`lib/markdown.ts`): the milestone line, Kind, State, inherited dates and
  Measure.
- **Health display**: `web/health.ts` (`GoalHealth`, `GOAL_HEALTH_META`) and
  `components/HealthChip.tsx`, shared with the goals powerup; `components/milestone.tsx` holds the
  milestone marks, colours and chips.
- With the timeline powerup, milestones show as markers on the timeline bars.

## Settings

`box.json features.planning.healthTolerance`, a share from 0 to 1 (default `0.1`), shared with the
goals powerup: how far a milestone may trail its pace and still read `at_risk` rather than
`off_track`.

## What a team customises

- `ITEM_KINDS`, `MILESTONE_MEASURE_KINDS` and `MILESTONE_STATES` in `core/types.ts`, mirrored in
  `web/planning-types.ts`. Stored enums need a migration to change.
- The kind registry in `core/items.ts`: which fields a kind carries and whether it counts as work.

## Gotchas

- **Milestone state is derived on read, never stored.** Progress, met, missed and health come from
  the measurement (tasks by hours, or a signal); `status` is the only stored lifecycle field and is
  manual. A milestone closed by hand while its measurement says missed shows its status as-is.
- **Windows are inherited and checked on write.** A milestone's window is its own `start_date` /
  `due_date`, else the nearest milestone ancestor's, else the initiative's, and must lie inside
  both. A write is refused only for problems it adds, and the message names each milestone. A
  signal milestone needs an effective start and due date. An initiative date change that would
  break a milestone is refused the same way.
- **Deleting an item moves its children up to its parent**, and writes each affected milestone's
  inherited start and due onto it first, so no effective window changes.
- **A signal bound to a milestone is reported, not blocked, on delete.** The milestone stays and
  reads no signal (`task:<id>` in the delete report). A rename re-points `tasks.signal_id`.
  Archived signals still resolve everywhere else, so pass `include_archived` when resolving a
  milestone's signal from `signalsData`.
- **A reach milestone is met only by an observation inside its window.** A level carried in from
  before the window reads as on track, never met.
- **Milestones are written with `task-upsert { kind: 'milestone' }`.** There are no `milestone-*`
  actions and no `milestones` table. `initiative_id` never changes on an existing item (use
  `task-move`, which carries the sub-tree and lands it at the top level of the destination).
- **Only `kind = task` items go into a sprint** (sprints powerup); switching a task with a sprint to
  a milestone clears its sprint.
