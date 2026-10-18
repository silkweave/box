# Adapting the `automation` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box, what to change afterwards, and how to arm it without setting a laptop firing production crons.

## 1. Integrate

The recipe documents ship with core at `recipes/automation/`; the reference implementation lives in the Stack at `features/automation/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** core, and the server's agent host for agent triggers (`box.json` `workerdeck`; without it, agent triggers are refused and the rest works). Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/automation/` into the Box's `features/automation/{core,server,web}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

The recipe has two powerups: Alerts (`recipes/automation/powerups/alerts/`, delivery for event triggers) and Webhook relay (`recipes/automation/powerups/relay/`). Ask the owner which to add now. The Stack's tree carries the Alerts source (`core/alerts/`, `server/alerts/`, `web/alerts/`) and its wiring lines; leave both out of the base adaptation unless the owner picks the powerup, then follow its INSTALL.md.

Migrations: `automation:001-import-schedules` (imports `features.automation.schedules` from
`box.json` / `box.local.json` as time triggers), `automation:002-trigger-permission-mode` (adds the
nullable `triggers.permission_mode` column), `automation:003-trigger-toolset` and
`automation:004-trigger-groups` (the `trigger_groups` table's Default row and `triggers.group_id`,
so every trigger is in a folder), `automation:005-trigger-concurrency-key` (the nullable
`triggers.concurrency_key` column) plus core's `004-runs-trigger-id` and
`005-runs-event-id`, which arrive with core. Back up the warehouse first, then boot a restored copy
and confirm every configured schedule is a trigger (`triggers-list`) before the live Box takes it.
After the live boot, remove `features.automation.schedules` from the config files: it is no longer
read, and the boot log warns while it is present.

## 2. Customise for the team

1. **The triggers** - rows in the `triggers` table, created in Settings -> Automation -> Triggers or
   with `trigger-upsert`. A fresh Box has none. `id` is a stable slug (`^[a-z0-9][a-z0-9-]*$`); run
   rows link to it. Every trigger belongs to an admin (`owner`); an agent acting for an admin names
   them.
2. **Cron and time zone** - full 5-field cron, parsed by `cron-parser` in the trigger's IANA zone
   (empty: the server's zone). The UI renders each back in English via `cronstrue`, the fastest way
   to catch a field-order mistake.
3. **Which actions to arm** - the catalog is every `ActionSpec` the installed features contribute,
   plus core's `warehouse-backup` (Settings -> Automation -> Actions). An unknown `action_id` is
   refused; a `parameterized` action needs `params` on the trigger.
4. **Agent triggers** - a prompt that runs unattended as a WorkerDeck job under an admin's agent
   profile (`run_as`), in a directory inside `workerdeck.cwdRoots`, optionally with a success marker
   line. The unattended permission mode (`workerdeck.queue.permissionMode`) is `auto` by default:
   the engine's classifier decides each tool call, and denials land in the run's permission report.
   `dontAsk` (Claude only) runs only what the run_as profile's settings allow. Either way, check the
   profile's settings and MCP servers before moving a job in. A job gets the Box's own MCP
   server (`box`) as its run_as user from the session, on Claude and Codex (SPEC "The Box MCP server
   in a job"). A trigger can instead run its main
   job in `bypassPermissions` ("Bypass permissions" in the editor, `permission_mode` in
   `trigger-upsert`), for a trusted prompt the classifier keeps blocking; put deny rules for what it
   must never do in the job folder's settings. Tune the
   queue in `box.json` `workerdeck.queue` (SPEC.md, "Settings").
5. **Event triggers** - When = a Box event: an exact kind (`content.published`) or a family
   (`signal.*`); `triggers-list` returns `eventKinds`, the kinds recorded in the last 30 days.
   Narrow with filters (`fields.<name>` or `actor`, `subject`, ...; one of equals, regex, in; all
   must match). Action params and agent prompts take `{{fields.name}}` placeholders; an agent
   prompt also gets the event as JSON. `daily_cap` (default 50 for agent prompts, none for actions)
   and `max_depth` (default 2) keep a chatty kind or a loop of triggers in check. An agent prompt
   can ask a cheap gate first (`gate_prompt`, `gate_model`, `gate_marker`).
6. **Deliveries** - with the Alerts powerup, an event trigger can deliver a message instead (Do =
   "Deliver a message": `route`, `message`, `notify`, `cooldown_min`, `debounce_sec`). The powerup
   registers the runner through automation's port; without it the option is disabled, a stored
   delivery is listed invalid, and the Triggers tab offers admins a Builder brief to add it
   (recipes/automation/powerups/alerts/).
7. **Labels and order** - `features/automation/web/index.tsx`, band 800.

## 3. Prove it

```bash
box dev
```

Open Settings -> Automation. **Triggers** lists the cards; on a dev checkout the header says the
timers are not armed, which is the correct state. As an admin, create one with **New trigger**
(`0 7 * * *`, `warehouse-backup`) and confirm `triggers-list` returns it with a `nextFire` once
armed. **Run now** on a card streams the action inline through core's `opsRunNow` with the trigger
id and lands a `manual` run in **Runs** showing who ran it and the trigger id. A member sees the
cards and Run now, but no create, edit or delete.

For an agent trigger, create one with Do = "Run an agent prompt" and a harmless prompt ending in a
marker line (`Reply with the word READY on its own line.`, marker `READY`). **Run now** links the
run; it goes `queued` -> `running` -> `success`, with the session id as the first log line and the
final text as the summary. Remove the marker from the reply to see the run fail on it.

For an event trigger, pick When = "When a Box event arrives", a kind from the suggestions and a
filter, Do = an action. **Run now** opens a sample event; the reply says whether the filters match
it, and the run shows the event's values in its params. With `background.automation` on, a real
event of that kind lands a run with `trigger = event` and the event id in Run detail. A loop (two
triggers feeding each other) stops at the max depth.

Agent-side:

```bash
box triggers-list                     # every trigger, valid or not, next fire
box trigger-upsert                    # create/update one (admin; params as a JSON string)
box trigger-delete                    # remove one (admin)
box trigger-run                       # run one now, returns the run id (admin; optional sample event JSON)
box run-get                           # core's - one run with its log (live while running; --after <seq>, --tail <n>)
box service-restart                   # restart under a supervisor (refuses mid-turn without force)
```

**Arming it deliberately.** Set `background.automation` to `true` in that checkout's
`box.local.json` and restart. The boot log says `armed N/M time trigger(s)` and `listening with N
event trigger(s)`; afterwards every edit re-arms at once.

Do **not** do this on a dev checkout seeded from production: armed timers and listening event triggers there fire the real
pulls, backups and publishes beside the production Box. If you must watch the scheduler arm, use a
throwaway second checkout with its own `data/` ("Boot a throwaway Box" in `docs/SERVER.md`),
`background.automation` true, `background.chatAgent` false, a trigger pointing at something
harmless, and a `server.port` no other Box could be holding.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. The `triggers` table stays in the warehouse. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
