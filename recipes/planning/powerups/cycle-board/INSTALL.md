# Cycle board powerup: install

Adds boards to Planning: goals and initiatives as board node kinds, the cascades that keep their
placements in step with renames and deletes, the `cycle-board` tool and the cycle page's *Circuit
board* action.
Read [POWERUP.md](POWERUP.md) and the recipe [SPEC.md](../../SPEC.md) first. There are no owner-only
steps.

## Detect

The Box has this powerup when `features/planning/core/cycle-board/`,
`features/planning/server/cycle-board/` and `features/planning/web/cycle-board/` exist and are
registered (below), and Settings > Agent tools lists
`cycle-board`. `box.json` `recipes.planning.powerups`
lists `cycle-board` once it was verified. If it is there, this is an update: compare against the
version recorded in the `recipes` ledger instead of copying over local changes.

## Requires

The Planning recipe, adapted and validated, and the board recipe its POWERUP.md links to
(`recipes/boards/`), adapted and validated, both recorded in the `recipes` ledger of `box.json`.
Without the board recipe the tool refuses with core's `BOARDS_NOT_SET_UP` and the action says boards
are not set up, so adapt it first.

## Owner decisions

- Whether to add the cycle board now. Planning is complete without it.

## Owner-only steps

None.

## Steps

1. Run `box recipe fetch planning --version <the version in the recipes ledger of box.json>`, then
   copy/adapt `core/cycle-board/`, `server/cycle-board/` and `web/cycle-board/` from
   `<fetched recipe>/features/planning/` into the Box's `features/planning/`.
2. Register them:
   - `export * from './cycle-board/index.js'` in `features/planning/core/index.ts`;
   - `CycleBoardModule` in the `imports` of `features/planning/server/planning/planning.module.ts`
     (it registers the `goal` and `initiative` node kinds and the identity hooks, and serves the tool);
   - `CycleBoardAction` in the `planning.cycle.actions` slot (`slots`) of `features/planning/web/index.tsx`.
3. Run `bun run typegen` so the web client knows `cycleBoardSeed`, then restart (`box app restart`).
4. Record the powerup, with the fetched version and sha256, in `recipes.planning.powerups` of
   `box.json` once Verify passes, and the session in `_docs/INTEGRATION.md`.

## Verify

1. The board picker offers Goals and Initiatives; a goal placed on a board shows its reading and
   health, and renaming that goal keeps it on the board.
2. On a cycle with goals, *Circuit board* opens a new board with the goals on the top row, their
   signals beneath and the drivers at the bottom; choosing it again asks before re-seeding.
3. `box cycle-board --cycle-id <id>` returns the board id, label and node count; again without
   `--replace` it refuses because the board exists.
4. The complete validation chain passes. Then add `cycle-board` to `recipes.planning.powerups`.

## Remove

Remove the three registration lines and the three `cycle-board/` folders, and `cycle-board` from
`recipes.planning.powerups`. Boards made from cycles stay; goal and initiative placements on any
board then show under `missing` until removed from the board. The cycle page
then shows the note that the cycle board is not set up.
