# Timeline powerup: install

Adds the Timeline layout to the Initiatives board. Read [POWERUP.md](POWERUP.md) and the recipe
[INSTALL.md](../../INSTALL.md) ("Base and powerup files") first. The change is web-only. There are
no owner-only steps.

## Detect

The Box has this powerup when `features/planning/web/components/InitiativesTimeline.tsx` exists
and the Initiatives board's layout switch offers Timeline. `box.json` `recipes.planning.powerups`
lists `timeline` once it was verified. If it is there, this is an update: compare against the
version recorded in the `recipes` ledger instead of copying over local changes.

## Requires

The Planning recipe, adapted and validated, recorded in the `recipes` ledger of `box.json`. The
milestones powerup is optional: with it, milestones show as markers.

## Owner decisions

- Whether to add the timeline now. Planning is complete without it.

## Owner-only steps

None.

## Steps

1. Run `box recipe fetch planning --version <the version in the recipes ledger of box.json>`.
2. **Files wholly owned**, copied from `<fetched recipe>/features/planning/`:
   `web/components/InitiativesTimeline.tsx` and `web/lib/timeline.ts`.
3. **Seams in shared files** (marked `timeline powerup` where annotated):
   - `web/lib/planningView.ts`: `'timeline'` in `PlanningLayout` and `PLANNING_LAYOUTS`, the
     Timeline preset in `PLANNING_DEFAULT_PRESETS`, the Timeline option of the layout switch, the
     `./timeline.ts` import and the timeline section at the end (`TimelineMarker`, `TimelineRow`,
     `timelineRow`, `timelineWindow`, `timelineOffset`). In a Box without milestones, keep the
     marker filter as it is (it finds no milestones) or drop it.
   - `web/views/InitiativesGrid.tsx`: the `InitiativesTimeline` import and the `timeline:` entry of
     the layouts.
   - `web/lib/planningView.test.ts`: the "timeline" describe.
4. Nothing to register outside these files: no routes, nav, procedures or migrations.
5. Record the powerup, with the fetched version and sha256, in `recipes.planning.powerups` of
   `box.json` once Verify passes, and the session in `_docs/INTEGRATION.md`.

## Verify

1. On `/initiatives`, switch the layout to Timeline (or pick the Timeline preset): every initiative
   with a start or due date draws a bar, one with only one date a one-ended bar, and today shows as
   a line.
2. Group the view by kind and filter by status: the timeline follows the view.
3. With the milestones powerup, a milestone with a due date shows as a diamond, filled once it is
   met or done.
4. The complete validation chain passes. Then add `timeline` to `recipes.planning.powerups`.

## Remove

Remove the two files and the seams above, and `timeline` from `recipes.planning.powerups`. Saved
views with the Timeline layout fall back to the default layout; delete the seeded Timeline preset
from the presets if the owner wants it gone. Run `box verify` and load `/initiatives`.
