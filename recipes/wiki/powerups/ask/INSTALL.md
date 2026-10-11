# Ask powerup: install

Adds questions answered by an agent job to the Wiki. Read [POWERUP.md](POWERUP.md) and the recipe
[SPEC.md](../../SPEC.md) and [GOTCHAS.md](../../GOTCHAS.md) first. Do as much as possible yourself;
stop only for the owner decisions.

## Detect

`features/wiki/server/ask/` exists and `features/wiki/server/wiki/wiki.module.ts` lists
`WikiAskController` and `WikiAskService`. On a running Box, `box wiki-status` reports
`powerups.ask: true`, and Settings > Wiki shows Ask under Powerups with a check mark. `box.json`
`recipes.wiki.powerups` lists `ask` once it was verified. Source present with `powerups.ask: false`
means the module wiring below is incomplete.

## Requires

- The Wiki recipe, adapted and validated.

## Owner decisions

Ask these together:

1. **Who answers.** `features.wiki.ask.runAs`: null runs every ask as the Box agent (`box.json`
   `agent`) on its default profile; another principal needs an agent profile of its own. The
   asker is recorded either way.
2. **Model.** `features.wiki.ask.model`: null uses the profile's default. A cheaper model keeps
   asks fast; most tokens are the fixed context of each turn.
3. **Live systems.** Whether answers may read other systems of record (CRM, a ticket tracker):
   if so, which toolset (`features.wiki.ask.toolset`, from Settings > Agent tools). Null gives the
   job the Box's own tools only.
4. **Web.** Whether asks may search and fetch the web for public facts. On a Claude profile under
   the unattended `auto` mode this means allow rules in the run-as profile (step 4).
5. **Wait.** How long `WikiAsk` waits for the answer before returning the id
   (`features.wiki.ask.waitSeconds`, default 90).
6. **Prompt addition.** Anything this Box wants every ask to know (where live records are, house
   terms, answer style). It can be added later in Settings > Wiki.

## Owner-only steps

None, unless the run-as profile has no connected engine account yet: then the owner (or an admin)
connects it in Settings > Profile or the Users detail. Never copy a token by hand.

## Steps

1. **Source.** `box stack fetch --ref <sha>`, then copy these directories from `<fetched stack>`
   into the Box, merging with any local copy:
   - `features/wiki/core/ask/`
   - `features/wiki/server/ask/`
   - `features/wiki/web/ask/`
   `features/wiki/server/wiki/jobs.ts` (job working directory and error text) is base source shared
   with the upkeep powerup; keep it.
2. **Wire them into the base recipe.**
   - `features/wiki/core/index.ts`: `export * as wikiAsk from './ask/index.js'`.
   - `features/wiki/server/wiki/wiki.module.ts`: import `WikiAskController` from
     `../ask/ask.controller.js` and `WikiAskService` from `../ask/ask.service.js`; add
     `WikiAskController` to `controllers` and `WikiAskService` to `providers`.
   - `features/wiki/web/views/WikiGraphView.tsx`: import `AskInput` from `../ask/AskInput.tsx`,
     `AnswerPanel` from `../ask/AnswerPanel.tsx` and `useWikiAsk` from `../ask/useWikiAsk.ts`, and
     use them as the Stack's view does: the `asking` hook, the Ask and Find segmented control with
     `AskInput`, the answer's cited pages narrowing the graph, the graph reload after a save, and
     `AnswerPanel` in the right pane while an answer is open and no page is selected.
   No table, no migration and no registration file changes: the procedures are on the wiki's own
   module.
3. **Configure** `box.json` with the owner's choices (omit the block to take every default):
   ```json
   "features": { "wiki": { "ask": { "runAs": null, "model": null, "toolset": null, "waitSeconds": 90 } } }
   ```
   A toolset id must exist in `agentMcp.toolsets`; to deny more tools to the job, put them in that
   toolset's deny list.
4. **Web access** (if the owner wants it, Claude profile): add the web tools to the allow rules of
   the run-as profile's `settings.json` (in the profile's config dir, `workerdeck.profiles[].home`),
   for example `"permissions": { "allow": ["WebSearch", "WebFetch"] }`. Keep any rules it has. A Codex
   profile uses its own web search setting in `config.toml`.
5. **Prompt addition** (optional): Settings > Wiki > Prompt additions > Ask, or
   `box wiki-settings-save` with `ask` as an admin. It is stored in `data/config/wiki.json`.
6. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md` and the session in
   `_docs/INTEGRATION.md`.

## Verify

1. Run `box verify`, then boot a disposable instance (background work off) and load `/wiki` and
   Settings > Wiki.
2. `box wiki-status`: `powerups.ask` is `true`. Settings > Wiki shows Ask with a check mark and an
   Ask field under Prompt additions.
3. CLI: `box wiki-ask` with a question the vault can answer. Within the wait it returns
   `status: "done"`, an answer with `[[slug]]` citations, a confidence and `usage`. If it returns
   `queued` or `running`, follow it with `box wiki-ask-get --ask-id <id> --wait-seconds 60`.
4. Guards: `box wiki-ask-answer` for that ask as a principal other than the run-as one is refused
   (403); `pages` naming a page that does not exist is refused (400).
5. Browser: on `/wiki`, ask from the Ask box. The log lines update while it runs, the answer pane
   shows the citations, the graph narrows to the cited pages, and Save as a page creates a page
   under `queries/` that appears in the graph and in `index.md`. No page errors in the console.
6. Prompt addition: save one in Settings > Wiki; `data/config/wiki.json` holds it and the next ask
   follows it.
7. Record the actual commands and results. After these pass, add `ask` to
   `recipes.wiki.powerups` in `box.json`.

## Remove

1. Remove the wiring from step 2: the `wikiAsk` export, the two module entries, and the ask
   imports and their use in `WikiGraphView.tsx` (the graph keeps Find).
2. Delete `features/wiki/core/ask/`, `features/wiki/server/ask/` and `features/wiki/web/ask/`.
3. Remove `ask` from `recipes.wiki.powerups`. `features.wiki.ask` and `prompts.ask` in
   `data/config/wiki.json` stay unused unless the owner removes them; saved query pages stay in the
   vault.
4. Run `box verify` and load Settings > Wiki: Ask shows the powerup note.
