# Adapt the wiki recipe

This is the adaptation guide for the wiki recipe. Read [RECIPE.md](./RECIPE.md), [SPEC.md](./SPEC.md),
the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's docs/UPSTREAM.md, and its current
_docs/INTEGRATION.md before changing files. These recipe documents ship with core, so a Box has them
at `recipes/wiki/`. The reference implementation does not: it is fetched from the recipe registry as `features/wiki/`. In a Box, run `box recipe fetch wiki` and read `<fetched recipe>/features/wiki/` (`<fetched recipe>` is the path it prints),
so the documents and the code come from the same version.

The base recipe is the vault, the page tools, search, the link graph, lint, the Wiki section and the
`wiki` skill; it runs no agent jobs. Two powerups build on it:
[ask](./powerups/ask/POWERUP.md) (questions answered by an agent job) and
[upkeep](./powerups/upkeep/POWERUP.md) (material filed by an agent job, and the daily and weekly
sweeps; it requires automation). Ask the owner which to add now. Adapt and validate the base first,
then follow each chosen powerup's INSTALL.md.

## Prerequisites

- Existing Box backup and a recorded restore path for both data and matching application source.
  A Box that already has a `data/wiki/` vault must have it in that backup.
- Core only. Builds on: **none**.
- Feature-specific package imports, installed into the root workspace package:
  - dependencies: `js-yaml` `^5.5.0` (core, frontmatter), `tar` `^7.5.22` (core, `wiki-backup`
    archives), `sigma` `^4.0.5`, `graphology` `^0.26.0` and `graphology-layout-forceatlas2` `^0.10.1`
    (web, the graph), `react-markdown` `^10.1.0` and `remark-gfm` `^4.0.1` (web, the reader)
  - devDependencies: `@types/js-yaml` `^4.0.9`, `graphology-types` `^0.24.8`
  - The search index uses the Box database: PostgreSQL text search and pgvector, which both
    engines carry. No search package is installed.
  - Shared framework packages it imports directly and that core already carries: `zod`, NestJS,
    `class-validator`, `@silkweave/nestjs`, `@silkweave/box-ui`, `@tanstack/react-router`,
    `lucide-react`, and `@workerdeck/protocol` (only the powerups' jobs use it, through
    `server/wiki/jobs.ts`).

  Install the versions the fetched recipe's root `package.json` names, or latest where the recipe
  uses a range; record any compatibility pin and its reason in the Box's docs/GOTCHAS.md.
- The source version to fetch (for an update, the one in the `recipes` ledger of `box.json`), and an integration entry with scope, target version,
  intended changes, and state in _docs/INTEGRATION.md.
- A disposable instance for build, typecheck, tests, schema checks, and boot verification, with
  its own `data/` (vault and database): never point two servers at one instance.

## Detect

The Box has adapted this recipe when `wiki` is in the `recipes` ledger of `box.json`. Confirm the
actual state before recording or updating it:

- `features/wiki/{core,server,web}` exist and `wiki` appears in the four registration files below.
- With the Box running, `box wiki-status` answers with a page count and `search.available`, and
  `powerups` says which powerups the running server carries.
- `data/wiki/` holds `schema.md`, `purpose.md` and `index.md` once the server has started with the
  feature registered.
- The backup: `features/wiki/core/manifest.ts` lists `WIKI_BACKUP_ACTION` in `actions`,
  `data/backups/wiki/` holds recent archives, and with automation `box triggers-list` lists a valid
  time trigger whose `action_id` is `wiki-backup`. Without archives or a schedule the wiki has no
  backup; tell the owner.

If it is already adapted, this is an update: compare with the version recorded in the `recipes` ledger of `box.json` (`box recipe fetch wiki --version <that version>`) and keep the
Box's `schema.md`, `purpose.md`, pages and local customizations.

## Owner decisions

Ask these together:

1. **Powerups.** Which to add now: ask, upkeep, both or neither. Each powerup's INSTALL.md lists
   its own decisions (run-as principal, model, toolset, trigger times); ask those together with
   these.
2. **Search by meaning.** Whether to add an OpenAI platform API key for embeddings. Without it
   everything works and search matches words only; the Wiki health view says so. A ChatGPT or
   Codex subscription does not cover the embeddings API. Embedding the vault and every change
   costs API usage.
3. **Who reaches the wiki tools.** The wiki tools are Box tools, so every agent session with the
   Box's tools has them. For an external-facing toolset (one a chat room or trigger serving people
   outside the team names), decide whether to deny the page mutations there: `deny` entries
   `mcp__box__WikiPageWrite`, `mcp__box__WikiPageEdit`, `mcp__box__WikiPageDelete`,
   `mcp__box__WikiPageRename`, `mcp__box__WikiLintFix` (docs/AGENT-TOOLS.md).
4. **Starting conventions.** Whether to keep the shipped `schema.md` page types and `purpose.md`,
   or edit them for this team after the first boot seeds them.
5. **Backup.** The time of the daily `wiki-backup` trigger (04:10 in the Box's zone unless the owner
   names another; it needs the automation recipe), and whether archives also go offsite: they do
   when `backup.gcsBucket` is set in `box.json` (docs/WAREHOUSE.md for the bucket setup). Without
   automation, someone runs the backup by hand or from the host's scheduler with
   `box run-now --action-id wiki-backup`.

## Integration

1. Copy/adapt `<fetched recipe>/features/wiki/` into the Box's
   `features/wiki/{core,server,web,skills}`. The base is `core/` outside `core/ask/` and
   `core/upkeep/`, `server/index.ts` and `server/wiki/`, `web/` outside `web/ask/` and
   `web/upkeep/`, and `skills/wiki/`. Do not create a feature package, a symlink, or a release
   catalogue entry.
2. For each powerup the owner did not choose, leave its source out and remove its wiring lines.
   Each is marked by a comment naming `recipes/wiki/powerups/<id>`:
   - ask: in `server/wiki/wiki.module.ts` the `WikiAskController` and `WikiAskService` imports and
     entries; in `core/index.ts` the `wikiAsk` namespace export; in `web/views/WikiGraphView.tsx`
     the `AskInput`, `AnswerPanel` and `useWikiAsk` imports and their use, so the graph input keeps
     only its search.
   - upkeep: in `server/wiki/wiki.module.ts` the `WikiUpkeepController` and `WikiUpkeepService`
     imports and entries; in `core/index.ts` the `wikiUpkeep` namespace export; in
     `core/manifest.ts` the `WIKI_UPKEEP_ACTIONS` import and its spread (keep
     `actions: [WIKI_BACKUP_ACTION]`); in `web/views/WikiHealthView.tsx` the `UpkeepHistory` import and its use
     (keep the `WikiPowerupNote` branch).
   Leave the base's powerup ports (`core/powerups.ts`) and the `WikiPowerupNote` component in place:
   they are how the base reports an absent powerup.
3. Register it as the `wiki` feature, keeping each list's order:
   - `packages/core/src/generated/features.ts`:
     ```ts
     import wiki from '../../../../features/wiki/core/manifest.js'
     ```
     and `wiki` in `FEATURES`.
   - `packages/core/src/generated/exports.ts`:
     ```ts
     export * from '../../../../features/wiki/core/index.js'
     ```
   - `apps/server/src/generated/features.ts`:
     ```ts
     import wiki from '../../../../features/wiki/server/index.js'
     ```
     and `wiki` in `SERVER_FEATURES`.
   - `apps/web/src/generated/features.ts`:
     ```ts
     import wiki from '../../../../features/wiki/web/index.js'
     ```
     and `wiki` in `WEB_FEATURES`, `...wiki.routes` in `WEB_ROUTES`.
4. Install the packages above into the root `package.json` and run `bun install`.
5. Configure `box.json` only to change a default (shared; no secrets):
   ```json
   "features": { "wiki": { "embeddingModel": "text-embedding-3-small" } }
   ```
   For search by meaning, the owner puts the key in the gitignored `box.local.json` (the agent
   never prints it):
   ```json
   "credentials": { "openai": { "*": { "OPENAI_API_KEY": "<platform API key>" } } }
   ```
   The key is read when the server opens the index, so add it before boot or restart afterwards.
6. Check that no new core export collides with another feature's by importing the source barrel at
   runtime: `cd apps/server && bun --conditions=@silkweave/box-source -e "await import('@silkweave/box-core')"`.
7. With the automation recipe, create the backup trigger with `trigger-upsert` (MCP
   `TriggerUpsert`, `box trigger-upsert`, or Settings > Automation > Triggers), at the owner's time
   and zone. `owner` is an admin; the system agent must name the admin it acts for.
   ```json
   {
     "id": "wiki-backup",
     "name": "Wiki backup",
     "description": "Daily wiki archive (recipes/wiki).",
     "enabled": true,
     "when_kind": "time",
     "cron": "10 4 * * *",
     "timezone": "<IANA zone, or omit for the server's>",
     "do_kind": "action",
     "action_id": "wiki-backup",
     "owner": "<admin id>"
   }
   ```
   It fires only while `background.automation` is `true`; on a rehearsal checkout leave it off and
   use `box run-now --action-id wiki-backup`.
8. Preserve local customizations and write durable findings to the Box's docs/GOTCHAS.md. Update
   _docs/INTEGRATION.md as each step completes. Record the fetched version and sha256 in the `recipes` ledger of `box.json` only after the full validation and boot pass.

Migrations: none. The search tables (`wiki_pages`, `wiki_chunks`, `wiki_embeddings` in the `wiki`
schema) come from the models and baseline; on an existing database the new tables take the
automatic `pre-migrate` restore point first. Run `bun run schema:check` after integrating. The
vault is files under `data/wiki/`, seeded on first open; an existing vault is opened as it is and
indexed in the background.

### Data layout

| Path | In the wiki backup | What |
|---|---|---|
| `data/wiki/` (pages, `index.md`, `log.md`, `log/`, `schema.md`, `purpose.md`, `raw/`) | yes | the vault: the team's knowledge and its history |
| `wiki` schema in the Box database | no (database restore points) | the search index; pages and chunks rebuild from the vault, the embeddings cost API usage to make again |
| `data/config/wiki.json` | yes | prompt additions for the powerups' jobs, edited in Settings > Wiki |
| `data/backups/wiki/` | no | the local archives `wiki-backup` writes |

The warehouse, chat and artifacts backups do not cover the wiki; the `wiki-backup` action does
(SPEC.md "Backup").

## Restore

Restore is manual and replaces the whole vault. On the live Box it is an owner decision; rehearse
it on a scratch checkout first.

1. Pick the archive. Local: `ls -t data/backups/wiki/`. Offsite, the newest:
   `gsutil cp gs://<bucket>/wiki/wiki-latest.tar.gz /tmp/`; an older one:
   `gsutil ls -a gs://<bucket>/wiki/wiki-latest.tar.gz` lists every version with its
   `#<generation>`, and `gsutil cp 'gs://<bucket>/wiki/wiki-latest.tar.gz#<generation>' /tmp/`
   fetches it.
2. Check it: `tar -tzf <archive>` lists `wiki/...` and, when the Box had one, `config/wiki.json`.
3. Take a fresh `wiki-backup` first if the vault still opens, then stop the Box server: a running
   server would write pages and the index during the swap.
4. From the checkout root, move the current state aside (`<date>` as `YYYY-MM-DD`):
   `mv data/wiki data/wiki.pre-restore-<date>`, and, if the archive carries `config/wiki.json`,
   `cp data/config/wiki.json data/config/wiki.json.pre-restore-<date>`.
5. Extract into `data/`: `tar -xzf <archive> -C data`. This writes `data/wiki/` and
   `data/config/wiki.json`.
6. Start the server. It reconciles the search index with the restored vault in the background and
   embeds only section texts the database holds no embedding for (to bring the embeddings back
   too, restore a database restore point from about the same time, docs/WAREHOUSE.md).
   `box wiki-status` reports the page count and `pending` falls to 0; `box wiki-lint` should match
   what the vault had.
7. Once the team has confirmed the restored wiki, delete `data/wiki.pre-restore-<date>/` and the
   `wiki.json` copy.

## Verify

1. Run `box verify`. It links the `wiki` skill, and the core tests run the wiki engine's tests
   (`features/wiki/core/**/*.test.ts`), including the search index on the test cluster (pgrust).
2. Boot a disposable instance (background work off) and check the server log has no
   `wiki search unavailable` or `wiki could not open` line. `data/wiki/` now holds `schema.md`,
   `purpose.md` and `index.md`.
3. The `box wiki-*` commands need a CLI token: a fresh Box has none, so ask the owner to set
   `mcp.token` in `box.local.json` to an admin's token (`box auth token <admin id> --quiet`, never
   printed into the transcript). The agent session that adapted the recipe does not list the new
   `Wiki*` MCP tools until it restarts; use the CLI.
4. `box wiki-status`: `search.available` true; `search.mode` `keyword` without a key, `hybrid` with
   one, and then `pending` falls to 0; `search.health` names the engine and has no advice on a
   small vault. `powerups` matches what was added.
5. Round trip through the tools: `box wiki-conventions`; `box wiki-page-write` a test page in a
   type directory with valid frontmatter and a summary; `box wiki-search` finds it;
   `box wiki-page` returns it with a `revision`; `box wiki-page-edit` with that `baseRevision`;
   `box wiki-lint` reports it as an orphan missing from `index.md`; `box wiki-page-delete` with the
   new revision. `log.md` shows each change under the admin's id.
6. In a browser, load `/wiki` (the graph renders, or the empty state on a new vault), open a page
   at `/wiki/page/<slug>` and save an edit, and load `/wiki/health` (tiles, the keyword-only
   callout when there is no key, lint findings) and Settings > Wiki (powerup presence). Check the
   console for errors and toggle light and dark once.
7. Backup: `box run-now --action-id wiki-backup` and `box wiki-backup` each answer with a summary
   naming `backups/wiki/wiki-<stamp>-<id>.tar.gz` and the file count, and say whether it was
   uploaded; both appear in the automation run history. `tar -tzf` on the newest archive lists
   `wiki/index.md` and `config/wiki.json` (when present). With a
   bucket, `gsutil ls -l gs://<bucket>/wiki/` shows `wiki-latest.tar.gz` with the run's time.
   With automation, `box triggers-list` shows the `wiki-backup` trigger `valid` with the expected
   `nextFire`.
8. Restore rehearsal, on a second scratch checkout, never the live Box: follow "Restore" below with
   the newest archive, boot, and check `box wiki-status` reports the same page count, `box wiki-lint`
   matches the source Box, and a recently changed page reads the same.
9. Record the actual commands and results. After these pass, add `wiki` to the `box.json`
   `recipes` ledger, with each powerup under `powerups` only once its own Verify steps pass:
   `"wiki": { "powerups": [] }`.
