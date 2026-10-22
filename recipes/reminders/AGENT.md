# Adapting the `reminders` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a Box
and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/reminders/`; the reference implementation is fetched from the recipe registry as `features/reminders/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box recipe fetch reminders`.

**Builds on:** core only. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched recipe>/features/reminders/` into the Box's `features/reminders/{core,server,web}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the fetched version and sha256 in the `recipes` ledger of `box.json`, and the path mapping and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

No shipped migrations currently. A future recurrence change must be a new migration. Back up data before applying any migration, stage its runner and registration first, and verify migration completion and boot compatibility on a disposable restored instance before continuing.

## 2. Customise for the team

The app is small on purpose; the interesting edits are all additions.

1. **Make it fire.** Out of the box a reminder is remembered, not delivered. The wiring is an
   `ActionSpec` in `features/reminders/core/` that selects
   `due_at <= now() AND done_at IS NULL`, routes each row through Automation's `alerts` powerup, and stamps `done_at` (or
   a new `fired_at`); `automation` then schedules it. It is not shipped because it would make a
   one-table app depend on three others.
2. **Recurrence** - a `repeat` column plus a re-arm inside `setReminderDone`. Add it as migration
   `001-repeat` in `manifest.ts`; do not edit the `ModelSpec` alone, or a Box that has already
   booted never gets the column.
3. **An owner** - an `assignee` column, a `UserPicker` in the row, a "mine" filter. `created_by` /
   `updated_by` are already there and answer a different question (who typed it, not whose it is).
4. **Nav label and order** - `features/reminders/web/index.tsx`, band 750.
5. **The due field** - `views/RemindersView.tsx` splits it into core's `DateInput` and an `HH:MM`
   text input. If your Box gains a real date-time field in `@silkweave/box-ui`, replace both with it
   and delete `toIso`/`fromIso`.

## 3. Prove it

```bash
box dev
```

Open `http://localhost:8190/reminders`: add one, and it appears with a relative due time; tick it,
and it moves down to **Done**; untick it, and it comes back; delete it, and it goes. An overdue open
reminder renders its time in the danger colour.

Then prove the other half of the seam - the same four operations are MCP tools:

```bash
bun run cli reminder-upsert --title 'Renew the domain' --due-at 2026-10-01T09:00:00Z
bun run cli reminders-list
bun run cli reminder-done --id <id> --done        # --no-done reopens it
bun run cli reminder-delete --id <id>
```

Two things about the proxy that are easy to get wrong: it **kebab-cases** every input field, so the
flag for `due_at` is `--due-at`; and a boolean is a PRESENCE flag, so it is `--done` / `--no-done`,
never `--done true`. Set `mcp.token` to the access token of the user you are acting as.

With the dashboard open while you run these, the list updates without a refresh: the web store is
registered on `table:reminders` and the record layer emits on every write. That round trip is the
whole point of the app - if it holds, the seam is wired correctly.

## 4. Adapt or remove

To update this feature, compare the target Box with the version recorded in the `recipes` ledger of `box.json` (fetch it with `box recipe fetch reminders --version <that version>`), preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
