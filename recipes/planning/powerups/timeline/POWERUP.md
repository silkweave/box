# Timeline

A Timeline layout for the Initiatives board: every initiative as a bar from its start date to its due date, on a month scale with a line for today, under the same view bar as the list and the status board.

## Highlights

- Initiatives as bars from start to due date, one-ended when only one date is set
- Month ticks and a line for today, padded so the window always reads
- Rows, filters and groups come from the board's saved view
- With the milestones powerup: every non-dropped milestone as a diamond on its initiative's bar
- A seeded "Timeline" preset

## Needs

- Nothing outside the Box

## Requires

- The Planning recipe only.

## How it works

The base Initiatives board (`InitiativesGrid`) has two layouts, the list and the status board. This
powerup adds a third, `timeline`, to `PlanningLayout` / `PLANNING_LAYOUTS` in
`web/lib/planningView.ts`, drawn by `components/InitiativesTimeline.tsx`. It reads only base
fields: an initiative's `start_date` and `due_date` (both base). There are no tables, columns,
migrations, procedures or tools.

- **Rows** (`timelineRow` in `planningView.ts`): one per initiative in the view's order and groups,
  with a bar from the start date to the due date (one-ended when only one is set) and its markers.
- **Markers**: with the milestones powerup, every non-dropped milestone at any depth, as a diamond
  at its due date or its inherited window end, filled once met or done. Without milestones there
  are no markers.
- **Window** (`timelineWindow`, `timelineOffset`): every bar and marker plus today, padded by a
  week either side and to at least six weeks.
- **Helpers**: `web/lib/timeline.ts` (`addDaysIso`, `dayDiff`, `monthStarts`). `planningView.ts`
  imports `addDaysIso` and `dayDiff` from it for the timeline section only; nothing else in the
  base reads that file.
- **Presets**: the seeded "Timeline" preset (`PLANNING_DEFAULT_PRESETS`, layout `timeline`). A saved
  view whose layout is `timeline` falls back to the default layout in a Box without the powerup
  (`normalizeViewState`).
- The `start` column's hint mentions the timeline bar.
