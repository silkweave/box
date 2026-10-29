# Cycles & Goals

Goals that say why the work matters and, when they have a number, measure it against a signal with a health reading; cycles that group them into a period with a review at its end; and initiatives that name the goals they contribute to.

## Highlights

- Goals: the why and an optional target (a signal, a number and a window), measured with a health reading (on track, at risk, off track, met); a goal without a target is qualitative
- Goals are one flat layer; an initiative names the goals it contributes to
- A goal without a signal gets its own: values typed weekly, or computed by a measure such as tasks done
- Cycles that group goals into a period, with a review step to close goals and carry open goals forward
- A Goals page with health counts, a review panel and the gaps: open work that moves no goal, and goals nothing works on
- A Goals section on every initiative and a goals column on the Initiatives board

## Needs

- Nothing outside the Box: core's signals and measures

## Requires

- The Planning recipe only.

## How it works

**Tables and columns.** `goals` and `cycles` (both `timestamps: true`, `audit: true`) and
`initiatives.goal_ids`:

| table | pk | what it holds |
|---|---|---|
| `cycles` | `id` | slug id, `title`, `status` (enum `CYCLE_STATUSES`), `start_date` / `end_date` (DATE), `doc_path`, `sort` |
| `goals` | `id` | slug id, `title`, derived `summary` (the why), the target - `signal_id` (string, no FK), `kind` (enum `GOAL_KINDS`), `target` float, `comparator` (`hold` only), `start_date` / `end_date` (DATE, inclusive), `baseline` (reach override, NULL = read from the signal), all of signal/kind/target/dates set or all NULL - then `cycle_id`, `owner`, `status` (enum `GOAL_STATUSES`: `active` while open, then `met`, `missed` or `dropped`), `tags`, `doc_path`, `sort` |

`initiatives.goal_ids` is a JSON list, NOT NULL, default `'[]'`: the goals the initiative
contributes to.

**A goal** is the why (its doc) and, optionally, a **target**: one registered signal (checked on
write), a kind, a number and an inclusive window. The target is all or nothing: `signal_id`, `kind`,
`target`, `start_date` and `end_date` are all set after defaults, or all NULL (`comparator` only for
hold, `baseline` an optional override). A goal without a target is **qualitative**. `measure.ts`
(`measureGoal`) is pure and is the one implementation the Goals page, the board, MCP and the goal
events (`goal-events.ts`) all read; `goal-state.ts` is the warehouse side (`readMeasuredGoals` is
the measured view, with each goal's `health`). `measure.ts` is shared with the milestones powerup.

**One flat layer.** Goals have no parent and no owner initiative; a goal is optionally in a cycle.
Initiatives name the goals they contribute to in `initiatives.goal_ids` (any existing goal, checked
on write; "somehow contributes", no weight). A goal rename or delete rewrites those lists. Goals
order by `sort`, then their window start. A team that wants an objective layer above goals adds it
in its own Box.

**The goal's own signal.** A measurable goal created without a `signal_id` gets its own signal
`goal.<id>` on channel `planning`, group `Goals`, labelled with the goal's title: manual by default
(`accumulation` increment for an accumulate goal, otherwise snapshot), or bound to an in-Box measure
when `measure_key` (+ `measure_params`) is given, in which case a measure that takes `since` gets the
goal's start (and follows it). The goal owns it: renaming the goal renames it, deleting the goal
deletes it with its points (unless a carried-forward goal still measures it), and dropping the
target keeps it. `goal-value-set { goal_id, value, date? }` writes a point on it, the inline weekly
entry; it is refused on any other signal and on an own signal a measure computes. Every number is a
signal: a goal never stores its actual.

**Kinds.** The default comes from the signal's accumulation on create (`increment` -> `accumulate`,
otherwise `reach`; `defaultGoalKind`).

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
baseline came from (`goalBaseline`).

**Health** is a reading, never a verdict. A qualitative goal has none (`null`), and neither does a
goal whose signal is gone. A measured goal's health is one of `upcoming` (window not started),
`no_data`, `on_track`, `at_risk`, `off_track`, `met`. A goal is `met` when the target is reached
(reach, accumulate); a hold goal is `met` only once its window has ended without a breach. Otherwise
it compares actual to the pace. Trailing the pace is `at_risk` within the **tolerance** and
`off_track` beyond it. Tolerance is a share of the distance to target (reach), of the target
(accumulate, hold). Accumulate compares against the pace through *yesterday*, because today's
bucket is still filling. Hold is `off_track` when the latest value is outside the bound by more than
the tolerance, `at_risk` when it is outside by less or any earlier bucket breached. A snapshot
signal whose latest observation is old enough that "now" is a carried value reports `stale`. When
the window has ended, a goal carries a `suggested_status` (`met` or `missed`).

**Statuses are soft.** Nothing closes a goal automatically. A person sets `status` to `met`,
`missed` or `dropped` (`active` reopens). Health only suggests; `evaluateGoals` (run after every
successful run outcome) records `goal.met`, `goal.off_track` and `goal.ended` events, and
`goal.ended` only carries a `suggested_status`.

**Windows and buckets.** A bucket belongs to the window containing its start, with no proration. A
window that cuts through weekly or monthly buckets counts a straddling bucket wholly or not at all;
the reading carries an `alignment` so the UI can say so.

**Cycles** group goals into a period: `planned`, `active`, `review`, `closed`, each step moved by a
person. Choosing a cycle on a goal fills its missing dates from the cycle; after that the goal's
dates stand alone and a cycle edit never moves its goals. In `review` the Goals page lists the
cycle's goals with their suggested statuses so the team closes each one, and **carry forward**
(`goal-carry-forward`) continues an open goal in another cycle: a new goal with the same signal,
kind, target, comparator, owner and tags, the new cycle's dates and a fresh baseline, added to the
`goal_ids` of every initiative contributing to the old one, while the old goal is closed with the
status given (default `missed`). The new id defaults to the old id with its cycle suffix swapped
for the new cycle's.

**Gaps.** The Goals page lists open initiatives that contribute to no goal, and open goals with no
initiative, so unconnected work and unowned targets are visible rather than silent.

**Signal changes.** `GOAL_SIGNAL_HOOKS` (`core/goal-state.ts`, id `planning.goals`) is registered
into core's `registerSignalHooks`: a signal rename re-points its goals (`repointGoalSignals`), and a
signal delete is not blocked by goals: core's delete report names them (`goal:<id>`,
`goalsReferencingSignal`), and a goal whose signal is gone stays and reports a missing signal.

**Cascades.** Renaming an initiative rewrites nothing on goals (its `goal_ids` move with it, so the
goals' derived `initiative_ids` follow); deleting it leaves the goals in place. Deleting a user
clears the owner on their goals (`unassignDeletedGoalOwner`, registered as `planning.goals` in
core's user cleanup). Goal renames and deletes call `core/identity-hooks.ts`, which the cycle-board
powerup follows.

**Docs.** Doc kinds `goal` and `cycle`: goal `mrr-12k` -> `docs/goals/mrr-12k.md`, cycle `2026-q4`
-> `docs/cycles/2026-q4.md`. Goal and cycle segments match `^[a-z0-9][a-z0-9-]*$` and go through the
same `absPath` guard. A goal rename moves its doc (`movePlanningDoc`); deleting a goal or a cycle
deletes its doc. A cycle's doc is its review notes and has no summary column.

## Procedures and tools

`GoalsController` (`@Controller('goals')`) and `CyclesController` (`@Controller('cycles')`), both
behind `AuthGuard`, in `server/planning/goals.controller.ts`:

| tRPC | MCP | what |
|---|---|---|
| `goalsList` (query) | - | every goal with its reading and health, no daily series |
| `goalsGet` (mutation) | `goals-get` | all goals or one by `id`, each with health; the daily series is included for one goal, opt-in for all |
| `goalsUpsert` (mutation) | `goal-upsert` | create or partially update; an optional target (`target` with a window: dates or a `cycle_id`; `signal_id`, or none for an own signal, or `measure_key` + `measure_params` for an own measure-bound signal; `unit`); `clear_target` makes it qualitative; `status` closes it (`met`, `missed`, `dropped`) or reopens it (`active`); `clear_baseline` drops the override |
| `goalsDelete` (mutation) | `goal-delete` | remove a goal and its doc; initiatives stop contributing, its own signal is deleted |
| `goalsRename` (mutation) | `goal-rename` | change the slug; contributing initiatives, its own signal and the doc follow |
| `goalsValueSet` (mutation) | `goal-value-set` | `{ goal_id, value, date? }`: a point on the goal's own manual signal (default today); refused on any other signal |
| `goalsCarryForward` (mutation) | `goal-carry-forward` | continue an open goal in another cycle (see Cycles) |
| `cyclesList` (query) | `cycles-get` | every cycle, newest window first |
| `cyclesUpsert` (mutation) | `cycle-upsert` | create or partially update; `start_date` / `end_date` are required on create |
| `cyclesDelete` (mutation) | `cycle-delete` | remove a cycle; its goals stay, outside any cycle, dates intact |

On the base: `initiative-upsert` takes `goal_ids` (replaces the goals it contributes to, each must
exist), initiatives carry `goal_ids` on every read, and `doc-read` / `doc-save` take the `goal` and
`cycle` kinds. With goals, `planning.tasks_done` binds to a goal too (`goal-upsert` with
`measure_key`). Refusals (400s): a goal whose signal is not registered, whose `end_date` is before
`start_date`, whose target is half set or whose cycle does not exist; a `goal_ids` entry naming no
goal; a `goal-value-set` on a signal the goal does not own or that a measure computes.

## UI

- **Routes**: `/goals` - the overview: health counts (and how many goals have no target), a review
  panel while a cycle is in `review`, the open goals as one flat layer grouped by cycle (active,
  then in review, planned and closed cycles, then "No cycle"; measured goals with their reading,
  qualitative goals marked "No target" and without health; each card names the initiatives
  contributing to it), closed goals and the two gap lists. `/goals/cycles/$cycleId` is one cycle's
  goals. `/goals/$id` is `GoalDetailView`: the reading and pace chart (a qualitative goal says it
  has no target), the inline value entry, its cycle, the contributing initiatives as a table
  (initiative, status, owner, progress, due; linked and unlinked through each initiative's
  `goal_ids`) and the doc. The goal's status select sits in the top bar, as on an initiative.
  `GoalsLayout` is the shell with a sidebar of cycles.
- **Nav**: `Goals` (icon `Goal`, order 200), first in the Operations section.
- **The goal dialog** (`GoalDialog`) sets the title, the target (none; a number typed in, which
  creates the goal's manual own signal with an optional unit; an existing signal; or an in-Box
  measure from `signalsMeasures` with a field per parameter, `since` left to the goal's start),
  kind, target or bound, baseline, window, cycle, and owner. The status is set in the goal page's
  top bar, not in the dialog.
- **Inline value entry** (`GoalValueEntry`): a goal measuring its own manual signal takes one
  number, written as today's point through `goalsValueSet`. It shows on goal cards, the goal rows
  of an initiative page and the goal page; any other goal reads its signal.
- **On the initiative page**: a foldable **Goals** section below Tasks with each linked goal's card;
  the heading's icon button opens a checklist of goals (`GoalPicker`). The fold sticks per browser.
- **On the Initiatives board**: an optional goals column (`GoalsCell`, the goals it contributes to
  with their health), on by default, and the seeded "Growth" preset. `InitiativeDialog` has a goals
  field.
- **The cycle actions slot**: `planning.cycle.actions` (`CYCLE_ACTIONS_SLOT` in
  `components/CycleBoardNote.tsx`) holds a cycle page's extra actions. Without the cycle-board
  powerup the page shows `CycleBoardNote`: the cycle board is not set up, with a Builder brief for
  administrators.
- **Health display**: `web/health.ts` (`GoalHealth`, `GOAL_HEALTH_META`) and
  `components/HealthChip.tsx`, shared with the milestones powerup.
- **Stores**: `useGoalsData` reloads on `table:goals`, `table:initiatives` (the contributes-to lists
  live on initiatives), the signal tables and `docs:goals`, and its cycles store on `table:cycles`.
  The measures list is not a table; it loads once per page.

## Settings

- `box.json features.planning.healthTolerance`, a share from 0 to 1 (default `0.1`, that is 10%,
  `DEFAULT_HEALTH_TOLERANCE`). It is how far a goal may trail its pace and still read `at_risk`
  rather than `off_track`; a value that is not a number in range falls back to the default. The
  milestones powerup reads the same setting.

```json
{ "features": { "planning": { "healthTolerance": 0.1 } } }
```

## What a team customises

- **Goal vocabulary** - `GoalKind` (`reach`, `accumulate`, `hold`), `GoalComparator`, `GoalStatus`
  (`active`, `met`, `missed`, `dropped`), `GoalHealth` and `CycleStatus` in
  `features/planning/core/types.ts`. Stored enums need a migration to change. Goal labels and
  health tones are in `features/planning/web/goal-types.ts` and `web/health.ts`; goal status icons
  in `components/status.tsx` (`GOAL_STATUS_UI`).
- How goals are judged lives in `features/planning/core/measure.ts` (`measureGoal`); the one tunable
  that needs no code is `healthTolerance` (above).

## Gotchas

- **A reach baseline is the level entering the window, not the bucket containing the start.** For a
  monthly signal and a window starting 2026-10-01 that is September's value; reading October's
  bucket would hand the goal its end-of-October level as the starting point. Set `baseline` on the
  goal only to override this deliberately.
- **An `increment` goal compares against the pace through yesterday.** Today's bucket is still
  filling, so counting it against a full day of pace would make every goal look behind each
  morning. A hold goal likewise skips the bucket still filling.
- **A window that cuts through weekly or monthly buckets counts by bucket start.** A straddling
  bucket is counted wholly or not at all, never prorated; the reading's `alignment` says so. Align
  the window to the signal's interval when the number matters.
- **Deleting a signal leaves its goals in place.** They report a missing signal (no reading) rather
  than disappearing; data's delete report names them as `goal:<id>`. Re-point with `goal-upsert
  signal_id`, or delete the goals. A signal rename re-points them for you.
- **A goal's own signal `goal.<id>` belongs to the goal.** Renaming the goal renames it and deleting
  the goal deletes it with every point, so values typed against it go too. A carried-forward goal
  measures the same signal, which then survives the first goal's delete. Edit its label or unit
  through the goal, not `signal-upsert`, or the next goal write overwrites the label.
- **A goal target is all or nothing.** `goal-upsert` with a `target` but no window (no dates and
  no cycle) is refused rather than half written. `clear_target` drops the whole target and keeps
  the own signal and its history.
- **Archived signals still resolve.** Pass `include_archived` when resolving a goal's signal from
  `signalsData`; archived signals are only hidden from pickers and the Signals page.
- **Deleting an initiative leaves its goals.** Goals are not owned by initiatives; only the
  initiative's own `goal_ids` list goes with it.
- **Health suggests, people record.** Nothing moves `goals.status` off `active` automatically.
