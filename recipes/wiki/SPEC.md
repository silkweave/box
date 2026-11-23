# `wiki` - the team's linked markdown knowledge base

An LLM-maintained wiki: interlinked markdown pages under `data/wiki/`, written and repaired by
agents through Box tools and read and steered by people in the Wiki section. Pages carry typed
frontmatter and link each other as `[[slug]]`; `index.md` is the curated catalog and `log.md` the
change history, written by the server. The files on disk are the state; the search index over
them lives in the Box database (schema `wiki`), derived from the pages except for the embeddings,
which are kept because they cost API usage to make.

- **dependsOn**: nothing. Core only. The base runs no agent jobs: any Box agent maintains the wiki
  by driving the page tools through the `wiki` skill.
- **Powerups**: `ask` (questions answered by an agent job with checked citations) and `upkeep`
  (material filed by a single-writer agent job, plus daily and weekly sweeps on automation
  triggers). Their documents are under `recipes/wiki/powerups/`. The base reports their absence in
  `WikiStatus` and the web, and imports nothing from them.
- **Removal**: remove the feature's `core`, `server`, `web` and `skills` trees and its registration
  lines. The vault under `data/wiki/` survives untouched unless the team chooses to delete it.

## Tables

The search index, in the `wiki` schema (`features/wiki/core/models.ts`); `migrations: []`, so a
fresh or existing Box gets the tables from the baseline. The manifest carries the `wiki-backup`
action, and the upkeep powerup adds two more (below).

| Table | What |
|---|---|
| `wiki_pages` | One row per indexed page: `path`, `slug`, `title`, `type`, the `revision` it was indexed at and the chunking `format`. |
| `wiki_chunks` | The page's sections: `heading` trail, `body`, `text` (title, heading trail and body: what is embedded), `terms` (the text with camel-case names also split into their parts), `hash` of `text`, `tsv` (`to_tsvector('english', terms)`, GIN-indexed) and its length `dl`. Foreign key to `wiki_pages` (cascading). |
| `wiki_embeddings` | One `ext.vector(1536)` per distinct chunk text, keyed by its `hash` and shared by every chunk with that text, tagged with the `model` that made it. |

The baseline also creates the chunk indexes and, only on a Box moved to native PostgreSQL by hand
(core's `docs/NATIVE-POSTGRES.md`) and only past 10,000 embeddings, the HNSW index
`derived_wiki_embeddings_hnsw` (m 16, ef_construction 64). It is built at boot, so a Box that
crosses the limit gets it on its next start. pgrust, the Box's engine, never has it.

## Files on disk

The vault root is `data/wiki/` (`dataPath('wiki')`), fixed; there is no setting for it.

| Path | What |
|---|---|
| `schema.md` | Page types, the directory each lives in, file naming, required frontmatter. Seeded on first open, then the team's to edit. Not a page. |
| `purpose.md` | What this wiki is for. Seeded, then the team's. Not a page. |
| `index.md` | The catalog, one line per page by section. Seeded; a page, but cannot be deleted or renamed. |
| `log.md` | Change history, one entry per change, attributed to the principal. Written only by the server; holds the current and previous month. |
| `log/YYYY-MM.md` | Older log months, archived out of `log.md`. Not pages. |
| `overview.md` and `<type dir>/*.md` | The pages: `entities/`, `concepts/`, `people/`, `projects/`, `sources/`, `meetings/`, `decisions/`, `comparisons/`, `queries/`, `synthesis/` as `schema.md` defines them. |
| `raw/sources/` | Original material kept beside its source page. Not pages. |
| `raw/updates/<id>.md` | Upkeep powerup only: one durable record per update or sweep. |

Backups of the wiki are archives under `data/backups/wiki/` (see "Backup").
Seeding copies a template only when the file is absent; existing files are never touched. A page
path must end in `.md`, may not start with `raw/`, `log/`, `wiki/`, `schema.md` or `purpose.md`,
and may not contain hidden or control-character segments. File names are unique across the whole
vault, because `[[slug]]` resolves by file name alone. A directory named `wiki/` at the vault root
is refused at open.

`data/config/wiki.json` (`configPath('wiki.json')`) holds this Box's additions to the prompts of
the powerups' agent jobs: `{ "prompts": { "ask", "update", "daily", "weekly" } }`, each at most
20,000 characters. The base keeps the file but reads none of it.

## Process model

The Box server owns the vault and the index's upkeep. The vault lock is in-process, so every
reader and writer goes through the server: the web over tRPC, agents and the CLI over MCP, and the
powerups' jobs through the `box` session MCP server as their principal. The server opens the vault
and index at boot in the background, then reconciles the index with pages changed while it was
down (a full sync: new and changed pages are indexed, pages gone from the vault lose their rows). A
page change reindexes what it touched; an index failure is logged and never fails the change.
When the index cannot open, search reports itself unavailable and everything else works.

Access follows the `wiki` area. A search and the status run on the caller's own login and need
wiki read; the database grants back the check. Indexing (opening the index, every sync, the
embedding worker) is named system work, `wiki: search index upkeep`, so a page change by any
writer keeps the index current.

Embeddings use OpenAI directly (not an agent call) with the Box credential
`credentials.openai["*"].OPENAI_API_KEY` and the model in `features.wiki.embeddingModel`. Without
the key, search is keyword-only and says so. The key is read when the index opens, so adding or
changing it needs a server restart; pages are then embedded in the background.

## Search

- **Sync.** Each page is chunked by its headings; a page whose content revision and chunking format
  are unchanged is skipped. A changed page's row and chunks are replaced in one transaction (the
  page row first, so overlapping syncs of one page queue on its lock). Chunks exist before, and
  without, embeddings.
- **Embeddings.** A background worker embeds chunk texts that have no embedding in batches of 64
  (each text cut at 20,000 characters). A failure is reported in the status and retried after a
  minute; search falls back to keywords meanwhile. When nothing is pending, embeddings no chunk
  uses any more are deleted. Opening the index with another embedding model deletes the other
  model's embeddings and embeds every text again; without a key the embeddings stay. Query
  embeddings are cached for five minutes (128 queries).
- **Keyword candidates.** BM25 (k1 1.2, b 0.75) over the chunks' `tsv`, with document frequencies
  and corpus size read at query time; the query gets the same camel-case expansion. The words are
  alternatives, except when no page is near the query in meaning, then every word must match.
- **Vector candidates.** The 200 nearest chunks by cosine distance: an exact scan, or the HNSW
  index where it exists (with `hnsw.ef_search` 400, so the scan returns all 200). Pages are ranked
  by their best chunk; a page must stand out from the median of the list (the vector floor), and
  with fewer than five candidate pages all are kept.
- **Fusion.** Reciprocal rank fusion (k 60) of the keyword and vector page lists; ties go to the
  page whose title or slug names the query, then to a vector match, then by path. `strategy:
  "vector"` uses the vector list alone, scored by the best chunk's similarity, at least 0.25.
- **Health.** The status reports the engine, the stored embeddings against the exact-search limit
  (10,000) and whether the HNSW index serves the search. Past the limit on pgrust it says semantic
  search slows as the wiki grows; on native PostgreSQL without the index it advises a restart.

## Procedures and tools

`WikiController` (`@Controller('wiki')`, class-level `@UseGuards(AuthGuard)`). MCP names are
`wiki-<name>`, listed to agents as `Wiki<Name>` and on the CLI as `box wiki-<name>`.

| tRPC | MCP | what |
|---|---|---|
| `wikiPages` (query) | `wiki-pages` | every page: path, slug, title, type |
| `wikiPage` (mutation) | `wiki-page` | one page: markdown, frontmatter, revision |
| `wikiSearch` (mutation) | `wiki-search` | ranked pages with the matching section; `mode` says keyword, hybrid or vector |
| `wikiGrep` (mutation) | `wiki-grep` | every matching line on every page (regex or `literal`), up to 200 |
| `wikiGraph` (query) | `wiki-graph` | nodes with type and degrees, link and slug edges, broken references |
| `wikiConventions` (query) | `wiki-conventions` | `schema.md` and `purpose.md` |
| `wikiLint` (query) | `wiki-lint` | deterministic structural findings, no fixes |
| `wikiStatus` (query) | `wiki-status` | page count, search state (available, mode, embeddings configured, chunks, embedded, pending, error, health: engine, embeddings, exact-search limit, index, advice), `powerups { ask, upkeep }` |
| `wikiWrite` (mutation) | `wiki-page-write` | create or replace a page; `baseRevision` for a replace |
| `wikiEdit` (mutation) | `wiki-page-edit` | exact text replacements, all or nothing |
| `wikiDelete` (mutation) | `wiki-page-delete` | delete with a required `baseRevision`; removes its index entry and references |
| `wikiRename` (mutation) | `wiki-page-rename` | move a page and rewrite every link and frontmatter reference |
| `wikiLintFix` (mutation) | `wiki-lint-fix` | with `apply: true`, the two safe fixes: stale index entries and directory-matching `type:` |
| `wikiSettings` (query) | `wiki-settings` | the prompt additions in `data/config/wiki.json` |
| `wikiSettingsSave` (mutation) | `wiki-settings-save` | replace named prompt additions; `@Admin()` |
| `wikiBackup` (mutation) | `wiki-backup` | run the `wiki-backup` action now, recorded as an automation run; returns its `summary`; `@Admin()` |

The four page mutations take an optional `summary` (recorded in `log.md`) and an optional `job`
reserved for the upkeep powerup's jobs: with it the change is logged as
`<requester> via <kind> <id>`, and the server refuses it unless the caller is that running job's
principal. Without the upkeep powerup a `job` is refused. Page errors map to HTTP: invalid 400,
not found 404, conflict 409, protected 403 (writing `log.md`, deleting or renaming `index.md` or
`log.md`). The server stamps `updated:` on every change.

The reads are mutations where they take an input body, the same call as the sink and planning doc
reads.

The powerups add their own controllers on the same `wiki` path: `WikiAsk`, `WikiAskGet`,
`WikiAskAnswer`, `WikiAnswerSave` (ask) and `WikiUpdate`, `WikiUpdateGet`, `WikiUpdates`,
`WikiUpdateFinish` (upkeep). Their tRPC names are set explicitly (`Wiki.ask` gives `wikiAsk`).

## Actions

The base adds `wiki-backup` (group Wiki) to the core action registry. An automation time trigger
schedules it; `box run-now --action-id wiki-backup` and the `WikiBackup` tool run it by hand,
neither needing the automation recipe. Every run is an automation run with its summary. The upkeep
powerup adds `wiki-sweep-daily` and `wiki-sweep-weekly` (group Wiki); they only queue a sweep and
return.

## Backup

Neither the warehouse, chat nor artifacts backups cover the wiki's files; `wiki-backup` does
(`features/wiki/core/backup.ts`). The search tables are in the database and travel in its restore
points, embeddings included; after a restore the boot's full sync reconciles pages and chunks with
the vault and embeds only texts the restore point does not hold. One run writes one archive:

- **Contents.** `data/wiki/` and `data/config/wiki.json` (when present), with entry paths relative
  to `data/` (`wiki/...`, `config/wiki.json`), so a restore extracts into `data/`. Left out: the
  temp files of atomic writes in flight.
- **Consistency.** The archive is taken inside the vault lock every page write queues on, so no
  page write lands mid-archive. Upkeep records and `wiki.json` are written atomically, so a racing
  write gives one version or the other, never a torn file.
- **Refusal.** A missing vault, or one without a page, fails the run and writes nothing, rather
  than archive nothing.
- **Local.** `data/backups/wiki/wiki-<stamp>-<id>.tar.gz`, written as `.partial` and renamed when
  complete. Retention after each run is the warehouse's: every archive from the last 24 hours, the
  newest of each UTC day for 7 days, the newest of each ISO week for 28 days, and always the newest.
  Only names the action wrote are listed or pruned.
- **Offsite.** When `backup.gcsBucket` is set in `box.json` (the warehouse's private bucket), the
  same archive is uploaded over `gs://<bucket>/wiki/wiki-latest.tar.gz`. History is the bucket's
  object versioning, as for the warehouse. A failed upload fails the run and says the local archive
  was written. Without a bucket the run is local-only and its summary says so.
- **Restore** is a documented procedure (INSTALL.md "Restore"), never a tool or tRPC procedure.

## UI

- **Routes**: `/wiki` (the link graph with a page pane), `/wiki/page/$slug` (reader and editor),
  `/wiki/health` (status, lint findings, maintenance). A page opens by its slug, the same name an
  agent writes as `[[slug]]`.
- **Graph**: sigma 4 over graphology with a ForceAtlas2 layout, colored by page type from the theme's
  chart tokens, with type filters and a search that narrows the graph. Selecting a node shows its
  details, links, backlinks and broken links. With the ask powerup the input has an Ask mode that
  answers about the selected page and narrows the graph to the cited pages.
- **Page**: rendered markdown with live `[[links]]` (broken ones struck through); the editor saves
  against `baseRevision` with a summary and reports a conflict; rename and delete. `log.md` is
  read-only; `index.md` cannot be renamed or deleted. Pages are created by agents, not in the web.
- **Health**: Pages, Search (with how semantic candidates are found, on which engine) and Embeddings
  tiles; a callout when the index is not open, when search is keyword-only (naming the credential),
  when embedding failed and when the search health has advice; lint findings with a filter
  and "apply safe fixes". Below, the upkeep powerup's maintenance history, or a note naming the
  powerup when it is absent.
- **Nav**: one entry, `Wiki`, icon `Network`, order **720**.
- **Settings**: Settings > Wiki (order 840): the prompt additions, grouped by the powerup that
  runs each job and editable by administrators. Where a powerup is absent its note stands in for
  its fields: what it adds, and for administrators a Builder brief to add it. The Recipe Gallery,
  not Settings, lists the powerups.

## Settings

`features.wiki` in `box.json` (shared, no secrets):

| Key | Default | What |
|---|---|---|
| `embeddingModel` | `text-embedding-3-small` | OpenAI embedding model (1536 dimensions). Changing it deletes the stored embeddings at the next start and embeds every section again (API usage). |

The powerups add `features.wiki.ask` and `features.wiki.upkeep`. Secrets live in `box.local.json`:
`credentials.openai["*"].OPENAI_API_KEY`, a platform API key (a ChatGPT or Codex subscription does
not cover the embeddings API). It is a Box-wide credential, so other features may share it.

## Agent skill

`features/wiki/skills/wiki/` teaches any agent the tools: status first, search and grep before
writing, edit rather than rewrite, `baseRevision` on every change, never write `log.md`, and the
health-check workflow in `references/lint.md`. It uses `WikiAsk` and `WikiUpdate` only when
`WikiStatus` reports those powerups.

## What a team customises

`schema.md` and `purpose.md` in the vault (the page types and what the wiki is for), the nav label
and order, the embedding model, which agent toolsets reach the wiki tools, and, with the powerups,
the prompt additions and the jobs' run-as principal, model and toolset.
