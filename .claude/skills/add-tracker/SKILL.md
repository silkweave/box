---
name: add-tracker
description: Add a tracker to a Box - a named, parameterised number the Box computes from its own data (a Box tracker, registered in a feature) or receives from a third-party system (a provider for a data source). Use when someone wants a signal or goal to "count automatically", asks to track deals, tickets, posts or any table's rows over time, or wants to connect a service's numbers.
---

# Add a tracker

A tracker is a named definition the Box turns into numbers over time: counts, sums, ratios, money.
A signal bound to a tracker with its parameter values is one reading of it ("Deals won, owner
Winda"). Two kinds, one catalogue (`trackers-list`, which the signal dialog, the goal dialog and
agents pick from):

- **Box tracker**: computed from Box data by code in a feature. Choose this when the numbers are
  already rows in this Box (deals, tickets, tasks, pieces, activities).
- **Source tracker**: fed by a data source's sync from a third-party system. Choose this when the
  numbers live in another service; that is a provider (step B below), not a Box tracker.

A person pushing one occurrence at a time ("a webinar happened") is neither: that is a signal
event (`signal-event`), not a tracker.

Before writing anything, call `trackers-list` and read what exists: extend or parameterise an
existing tracker rather than adding a near copy (`crm.deals_reached_stage` already takes a stage
and an owner). Ask the owner what the number means in their words, which table it comes from, and
which filters they want to choose when they bind it; those filters are the parameters.

## A. A Box tracker

Read `packages/core/src/signals/trackers.ts` (the registry and its header), and one finished
example in the feature you are extending: `features/crm/core/trackers.ts`,
`features/support/core/trackers.ts` or `features/planning/core/trackers.ts`.

1. **Put it in the owning feature**: `features/<id>/core/trackers.ts`, exported from the feature's
   `core/index.ts`. The key is `<feature>.<name>` and the prefix must name an installed feature:
   a signal bound to it is owned by that feature's area, and only people who can read the area see
   the tracker.
2. **Declare it completely**: `label`, `unit`, `interval` (`day` unless the data is sparser),
   `accumulation` (`increment`: occurrences per day, the points add up; `snapshot`: a level or running
   total, the last value in a bucket wins), `direction` (which way is good), `group` (the dashboard
   section), a `description` a person can read, and `params`. Param values are strings; kinds are
   `enum` (with `options`, a thunk when the list is the Box's own data such as topics or stages),
   `text`, `date` and `user`. A level tracker may take a `since` date param.
3. **Declare `watches`**: the change scopes it reads, `table:<name>` of the tables `compute`
   queries (`table:crm_deals`). Core subscribes on the change bus and recomputes the bound signals
   after a burst of writes, so the feature never calls a refresh. A tracker without `watches`
   fails registration; so does one watching `table:signals` or `table:signal_points` (what the
   derive writes). Make sure the feature's write path actually calls `emitChange('table:<name>')`
   for every write that changes the number (deletes included); if it does not, add it.
4. **Write `compute({ params, from, to })`**: return `[{ at, value }]` with `at` a team day
   (`teamDay(...)` from `@silkweave/box-core/box-config`; never `toISOString().slice(0, 10)`, the
   Box has a time zone) and finite numbers. Return only days that have data for an increment
   tracker; the derive floors to the signal's interval and sums. Query with the feature's own
   helpers or `withRead` and `table(MODEL)`. Keep the date logic in a pure function the test can
   call.
5. **Register it** from the feature's server module `onModuleInit`
   (`registerTracker(TRACKER)` from `@silkweave/box-core`), keep the unregister if the module has
   an `onModuleDestroy`.
6. **Write the test** beside it (`features/<id>/core/trackers.test.ts`), on a throwaway instance:
   - the contract check, which verifies the declaration and runs `compute` once:
     `expect(await trackerContractProblems(TRACKER)).toEqual([])`
     (`@silkweave/box-core/signals/tracker-contract`; pass `params` when a required enum has no
     options in an empty database);
   - the pure function with a few rows, including the edge the number depends on;
   - one bound signal following a write: `registerTracker`, `watchTrackerSources()`, bind with
     `upsertSignalDefinition({ id, label, tracker_key, tracker_params, accumulation })`, write rows
     through the feature's own functions, `await settleTrackerWatches()`, then read
     `readSignalPoints(id)` (it zero-fills days; filter `value > 0` to compare). A test that reads
     points after a write must await `settleTrackerWatches()`.
   Core tests import built core: run `bun run build` in `packages/core` after a core change.
7. **Document it**: the feature's `recipes/<id>/SPEC.md` (what it counts, the dating rule, the
   watches) and its `AGENT.md` if agents bind it; a row in the tracker table of `docs/SIGNALS.md`
   in the Stack.
8. **Prove it end to end**: bind a signal through the signal dialog or `signal-upsert`, change the
   underlying data, and see the number move without anyone calling a derive. Then the Box chain
   (`box verify`).

A tracker that changes what an existing key means, or renames one, needs a transition for the
signals already bound to it (an UPDATE of `core.signals.tracker_key` and its params), written as a
backed-up, rehearsed one-off in `_docs/scripts/`; never a compatibility path in code.

## B. A provider for a third-party system

Read the provider section of the Stack's `docs/SIGNALS.md` ("Writing a provider") or, in a Box,
`packages/provider-kit/src/provider.ts`. A provider declares its config fields, credential key
names and a tracker catalogue (`ProviderTracker`, keyed by the remote's native token), and a pure
`pull(ctx)` fetcher; it is registered with `registerProvider` from a server module and appears
under Settings > Data sources. Secrets live in `box.local.json` under
`credentials -> <provider> -> <source id>`, never in code, rows or a transcript. Source trackers
share the catalogue with Box trackers; the owner binds a signal to one with a data source and a
tracker key. Test the provider with a fake `fetch`, never the live service.

## Rules

- The catalogue is for numbers computed from data: counts, sums, ratios, levels. Do not make a
  tracker of anything a person types in (that is a manual signal) or of a number only an outside
  system knows without a provider.
- One tracker per question, with parameters for the filters. Do not register a tracker per stage,
  per owner or per channel.
- Do not invent numbers: a tracker returns what the rows say, and an empty history returns no
  points.
