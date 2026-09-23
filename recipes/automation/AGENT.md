# Adapting the `automation` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box, what to change afterwards, and how to arm it without setting a laptop firing production crons.

## 1. Integrate

The recipe documents ship with core at `recipes/automation/`; the reference implementation lives in the Stack at `features/automation/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** core only. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/automation/` into the Box's `features/automation/{core,server,web}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

No shipped migrations currently. Back up data before applying any migration, stage its runner and registration first, and verify migration completion and boot compatibility on a disposable restored instance before continuing.

## 2. Customise for the team

1. **The schedules file** - `<BOX_DATA_DIR>/box.json features.automation.schedules`. A fresh Box has none; a missing
   file is an empty list, and the first upsert creates it. Shape:

   ```json
   {
     "schedules": [
       { "id": "daily-pulls", "action_id": "warehouse-backup", "cron": "0 7 * * *", "enabled": true, "description": "Nightly snapshot" }
     ]
   }
   ```

   `id` is a slug (`^[a-z0-9][a-z0-9-]*$`) and is stable - it is what a run row is attributed to.
   Write it by hand or through Settings → Schedules; both end in the same file.

2. **Cron expressions** - full 5-field, parsed by `cron-parser`, evaluated in the **server's local
   timezone**. There is no per-schedule timezone. The UI renders each one back in English via
   `cronstrue` ("At 07:00 AM"), which is the fastest way to catch a field-order mistake.

3. **Which actions to arm** - the catalog is every `ActionSpec` the installed features contribute,
   plus core's `warehouse-backup`. Two entries cannot be scheduled and will be refused at upsert
   time: an `action_id` that no present feature declares, and an action marked `parameterized`
   (it needs per-run params a cron cannot supply). The catalog itself is `opsActions`, tRPC-only -
   there is no MCP tool that lists actions, so read it from Automation → Actions in the UI.

4. **Labels and order** - `features/automation/web/index.tsx`, band 800 for both the nav
   entry and the Settings section.

There is no vocabulary, no table and no migration, so there is nothing to seed.

## 3. Prove it

```bash
box dev
```

Open `http://localhost:8190/automation`. You should see the Automation view with two sections:
**Schedule Runs** (every execution of every action - cron, dashboard, agent - newest first; empty on
a fresh Box) and **Actions** (the registry as a console). Click a run to get its stored log.

Then `http://localhost:8190/settings/schedules`: the schedule cards. On a dev checkout the header
reads "timers NOT armed - set background.automation=true in box.local.json to run them", which is the correct state.
Create one with **New schedule**, and confirm `<BOX_DATA_DIR>/box.json features.automation.schedules` really changed -
the file and the view agreeing is the feature's whole contract.

Press **Run now** on a card. That does not touch the scheduler: it calls core's `opsRunNow`
subscription with the schedule's `action_id` (and `scheduleId` for attribution), streams the
progress inline, and lands a `trigger: 'manual'` row in the run history. If the run appears under
Schedule Runs, the funnel works even though nothing is armed.

Editing the config also flips the topbar: after any upsert or delete, **Restart required** appears,
because the running scheduler keeps its boot-time snapshot. That indicator is the proof that the
config and the armed timers are two different things.

Agent-side, the same operations are MCP tools:

```bash
bun run cli schedules-list                 # what is configured, valid, next fire
bun run cli schedule-upsert                # create/update one entry
bun run cli schedule-delete                # remove one
bun run cli run-now                        # core's, not this feature's - run any action immediately
bun run cli run-get                        # core's - one run with its full log
bun run cli service-restart                # apply a config change (refuses mid-turn without force)
```

**Arming it deliberately.** Set `AUTOMATION_ENABLED=1` (exactly `1`; `true` and `yes` do nothing)
in the environment and restart. The boot log then says `armed N/M schedule(s) from
box.json features.automation.schedules`, and every entry that is `enabled` and valid gets a timer.

Do **not** do this on a dev checkout seeded from production. Such a checkout shares the tenant's
credentials and, often, its warehouse snapshot; armed timers mean a laptop firing the real pulls,
backups and publishes beside the production Box, writing real rows and posting real posts. The
off-by-default is the guard. If you must watch the scheduler itself arm, do it with a throwaway
instance dir and a schedule pointing at something harmless:

```bash
BOX_DATA_DIR=$(mktemp -d) AUTH_SESSION_SECRET=<16+ chars> AUTOMATION_ENABLED=1 CHAT_AGENT_ENABLED=0 \
PORT=8123 node --conditions=@silkweave/box-source --import @swc-node/register/esm-register apps/server/src/main.ts
```

(create `$BOX_DATA_DIR/config` first). Pick a `server.port` no other Box could be holding: a throwaway
that lands beside a real Box on another address family is mistaken for it rather than rejected
(`apps/server/src/agent/loopback-guard.ts`).

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
