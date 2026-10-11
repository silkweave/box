# Upkeep powerup: install

Adds the update lane (`WikiUpdate`), the daily and weekly sweeps and the maintenance history to the
Wiki. Read [POWERUP.md](POWERUP.md), the recipe [SPEC.md](../../SPEC.md) and
[GOTCHAS.md](../../GOTCHAS.md), and the automation [SPEC.md](../../../automation/SPEC.md)
("Tables", "Procedures and tools") first. Do as much as possible yourself; stop only for the owner
decisions.

## Detect

`features/wiki/server/upkeep/` exists, `features/wiki/server/wiki/wiki.module.ts` lists
`WikiUpkeepController` and `WikiUpkeepService`, and `features/wiki/core/manifest.ts` sets
`actions: WIKI_UPKEEP_ACTIONS`. On a running Box, `box wiki-status` reports `powerups.upkeep: true`,
Wiki > Health shows the Maintenance history (not the powerup note), and `box triggers-list` lists
two time triggers whose `action_id` is `wiki-sweep-daily` and `wiki-sweep-weekly`, both `valid`.
`box.json` `recipes.wiki.powerups` lists `upkeep` once it was verified. Source present with
`powerups.upkeep: false` means the module wiring is incomplete; the powerup present without the
two triggers means step 5 is missing.

## Requires

- The Wiki recipe and the [Automation](../../../automation/RECIPE.md) recipe, adapted and
  validated.

## Owner decisions

Ask these together:

1. **Who files.** `features.wiki.upkeep.runAs`: null runs every update and sweep as the Box agent
   (`box.json` `agent`) on its default profile; another principal needs an agent profile of its
   own. The sender of an update is recorded and named in `log.md` either way.
2. **Model.** `features.wiki.upkeep.model`: null uses the profile's default. Updates and the weekly
   review do real editing; a weak model leaves more for the next sweep.
3. **Toolset.** Whether jobs may read other systems of record to check claims against
   (`features.wiki.upkeep.toolset`, from Settings > Agent tools). Null gives the jobs the Box's own
   tools only.
4. **Trigger times.** Default daily at 03:30 and weekly on Sunday at 04:00, in which time zone
   (empty means the server's), and which admin owns the triggers. Pick a time that does not overlap
   the warehouse backup or other heavy agent runs.
5. **Prompt additions.** Anything this Box wants updates or sweeps to follow (house terms, what
   counts as authoritative). They can be added later in Settings > Wiki.

## Owner-only steps

None, unless the run-as profile has no connected engine account yet: then the owner (or an admin)
connects it in Settings > Profile or the Users detail. Never copy a token by hand. Arming
`background.automation` on an instance needs the owner's consent.

## Steps

1. **Source.** `box stack fetch --ref <sha>`, then copy these from `<fetched stack>` into the Box,
   merging with any local copy:
   - `features/wiki/core/upkeep/`
   - `features/wiki/server/upkeep/`
   - `features/wiki/web/upkeep/`
   `features/wiki/core/powerups.ts` (the upkeep port), `features/wiki/server/wiki/jobs.ts`, the
   `job` parameter of the page tools and `WikiGrep` are base source; keep them.
2. **Wire them into the base recipe.**
   - `features/wiki/core/index.ts`: `export * as wikiUpkeep from './upkeep/index.js'`.
   - `features/wiki/core/manifest.ts`: import `WIKI_UPKEEP_ACTIONS` from `./upkeep/actions.js` and
     set `actions: WIKI_UPKEEP_ACTIONS`.
   - `features/wiki/server/wiki/wiki.module.ts`: import `WikiUpkeepController` from
     `../upkeep/upkeep.controller.js` and `WikiUpkeepService` from `../upkeep/upkeep.service.js`;
     add `WikiUpkeepController` to `controllers` and `WikiUpkeepService` to `providers`.
   - `features/wiki/web/views/WikiHealthView.tsx`: import `UpkeepHistory` from
     `../upkeep/UpkeepHistory.tsx` and render `<UpkeepHistory />` when `status.powerups.upkeep` is
     true, in place of the Maintenance section with the upkeep powerup note.
   No table, no migration and no registration file changes: the records are files in the vault.
3. **Configure** `box.json` with the owner's choices (omit the block to take every default):
   ```json
   "features": { "wiki": { "upkeep": { "runAs": null, "model": null, "toolset": null } } }
   ```
   A toolset id must exist in `agentMcp.toolsets`; to deny more tools to the jobs, put them in that
   toolset's deny list.
4. **WebFetch** (Claude profile): the unattended `auto` mode refuses WebFetch unless allowed, so
   add it to the allow rules of the run-as profile's `settings.json`, in the profile's config dir
   (`workerdeck.profiles[].home`): `"permissions": { "allow": ["WebFetch"] }`, keeping any rules it
   has. A Codex profile uses its own web search setting in `config.toml`.
5. **Triggers.** Create two time triggers with `trigger-upsert` (MCP `TriggerUpsert`, `box
   trigger-upsert`, or Settings > Automation > Triggers), using the owner's times and zone.
   `owner` is an admin; the system agent must name the admin it acts for.
   ```json
   {
     "id": "wiki-sweep-daily",
     "name": "Wiki daily sweep",
     "description": "Daily wiki maintenance (recipes/wiki/powerups/upkeep).",
     "enabled": true,
     "when_kind": "time",
     "cron": "30 3 * * *",
     "timezone": "<IANA zone, or omit for the server's>",
     "do_kind": "action",
     "action_id": "wiki-sweep-daily",
     "owner": "<admin id>"
   }
   ```
   ```json
   {
     "id": "wiki-sweep-weekly",
     "name": "Wiki weekly review",
     "description": "Weekly wiki review (recipes/wiki/powerups/upkeep).",
     "enabled": true,
     "when_kind": "time",
     "cron": "0 4 * * 0",
     "timezone": "<IANA zone, or omit for the server's>",
     "do_kind": "action",
     "action_id": "wiki-sweep-weekly",
     "owner": "<admin id>"
   }
   ```
   The triggers fire only while `background.automation` is `true`; on a rehearsal checkout leave it
   off and use Run Now.
6. **Prompt additions** (optional): Settings > Wiki > Prompt additions (Update, Daily sweep, Weekly
   sweep), or `box wiki-settings-save` with `update`, `daily` or `weekly` as an admin. They are
   stored in `data/config/wiki.json`.
7. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md`, the session in
   `_docs/INTEGRATION.md`.

## Verify

1. Run `box verify`, then boot a disposable instance (background work off) and load `/wiki/health`
   and Settings > Wiki.
2. `box wiki-status`: `powerups.upkeep` is `true`. Settings > Wiki shows Upkeep with a check mark and
   the Update, Daily sweep and Weekly sweep prompt fields.
3. `box triggers-list`: both triggers are `valid`, with the expected `nextFire`.
4. An update: `box wiki-update` with a short real note (`--title` optional). It returns the record
   at once with status `received`. Follow it with `box wiki-update-get --id <id>` until it is
   `done`: pages created or updated are listed, `log.md` names them `<you> via ingest <id>`, and
   no warning says the job ended without `WikiUpdateFinish`.
5. A sweep: `box run-now --action-id wiki-sweep-daily` (or Run now on the trigger) returns at once
   with "queued"; a second run while it waits or runs says "already queued or running". With a
   planted broken link in a scratch vault, the sweep's record shows the findings count drop and
   `log.md` gets a `sweep` entry.
6. Guards: `box wiki-page-edit` with `job` set to that finished update is refused, and `box
   wiki-update-finish` on a finished update answers 409.
7. Browser: Wiki > Health > Maintenance lists the update and the sweep with their status, pages
   changed, questions, lint counts, tokens and cost; it polls while a job runs. No page errors in
   the console.
8. Record the actual commands and results. After these pass, add `upkeep` to
   `recipes.wiki.powerups` in `box.json`.

## Remove

1. Delete the two sweep triggers (`box trigger-delete`); afterwards they would be listed invalid.
2. Remove the wiring from step 2: the `wikiUpkeep` export, the `actions` line and its import in
   the manifest, the two module entries, and `UpkeepHistory` in `WikiHealthView.tsx` (the
   Maintenance section shows the powerup note again).
3. Delete `features/wiki/core/upkeep/`, `features/wiki/server/upkeep/` and
   `features/wiki/web/upkeep/`.
4. Remove `upkeep` from `recipes.wiki.powerups`. The records under `data/wiki/raw/updates/`,
   `features.wiki.upkeep`, the prompt additions and the WebFetch rule stay unless the owner removes
   them.
5. Run `box verify` and load Wiki > Health: Maintenance shows the upkeep powerup note.
