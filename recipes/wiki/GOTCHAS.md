# wiki gotchas

The vault lives in the Box data directory and survives feature removal. Preserve the team's pages,
`log.md` history, `schema.md`, `purpose.md` and `data/config/wiki.json`.

The feature id (`wiki`, the same as the recipe id) is part of runtime registration. Keep it stable.
The recipe ships no migrations; if one is ever added, existing migrations are byte-exact source:
preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## The search index

- **It lives in the Box database** (schema `wiki`, SPEC.md "Tables"). Pages and chunks are derived
  from the vault; the embeddings are kept, because making them again costs API usage. A database
  restore point carries all three; the boot's full sync reconciles them with the vault as it is.
- **Changing the embedding model re-embeds everything.** Opening the index with another
  `features.wiki.embeddingModel` deletes the other model's embeddings and embeds every section
  again in the background (minutes and API usage on a large vault). Removing the key keeps the
  embeddings; they serve again when the same model's key returns.
- **The key is read at open.** Adding or changing `credentials.openai["*"].OPENAI_API_KEY` needs a
  server restart. The key is a platform API key; a ChatGPT or Codex subscription does not cover the
  embeddings API.
- **The index is derived.** A failed reindex is logged and never fails the page change; a full sync
  at boot catches up. When the index is down, search says so and agents fall back to `index.md`
  and `WikiGrep`.
- **Exact search has a size envelope.** Up to 10,000 embeddings (roughly 850 pages of the Stack
  docs' density) exact search is fast on pgrust. Past that semantic search slows; only a Box moved
  to native PostgreSQL by hand gets an HNSW index, built at boot, so it uses exact search until
  its next restart after crossing the limit.
- **HNSW needs `hnsw.ef_search` at least the candidate depth.** With the default 40 a `LIMIT 200`
  scan returns 40 rows. The search sets 400 through the executor whenever the index exists; any new
  vector query on that table must do the same. The planner may still choose an exact scan; that is
  correct, only slower.
- **SQL that pgrust refuses** depends on the plan for the data at hand (docs/GOTCHAS.md, "SQL that
  pgrust refuses"). The keyword search passes its BM25 word weights as parameters and counts
  document frequencies in `UNION ALL` branches for that reason; test changes to it on pgrust with a
  realistic corpus.

## The vault

- **`log.md` belongs to the server.** Every page change appends an entry attributed to the calling
  principal; writing it through the tools is refused, and only the current and previous month stay
  in it (older months move to `log/YYYY-MM.md`). Do not edit it by hand on a running Box.
- **`schema.md` drives lint.** The table under its "Page Types" heading maps each type to its directory, and lint's
  type-mismatch check and the safe `type:` fix read it. Keep the heading and the table shape when
  editing it; a schema lint cannot parse gives no type checks.
- **Slugs are unique across the vault**, not per directory, because `[[slug]]` resolves by file name.
- **A `wiki/` directory at the vault root is refused** when the vault opens; the server logs
  "wiki could not open" and every wiki tool fails. Move its contents up into `data/wiki/`.
- Editing pages on disk with the server running is safe for the pages, but bypasses `log.md` and
  the reindex; the next boot's sync picks the change up. Prefer the tools.

## Backup

- **Box backups do not cover the wiki.** The warehouse, chat and artifacts backups leave
  `data/wiki/` and `data/config/wiki.json` out; only the `wiki-backup` action archives them. A Box
  without a `wiki-backup` trigger (or another schedule for it) has no wiki backup.
- **The archive never holds the search index.** It is in the database: restore a database restore
  point from about the same time to keep the embeddings. With the vault alone restored, the boot's
  sync indexes it against whatever the database holds and embeds only the missing texts.
- **Archives are as sensitive as the vault.** They carry every page, raw source and upkeep record,
  including the text people submitted to `WikiUpdate`. Keep the bucket private.
- **One remote object, overwritten.** `wiki/wiki-latest.tar.gz` keeps history only when the bucket
  has object versioning and a noncurrent-version lifecycle rule (docs/WAREHOUSE.md). Local archives
  share the Box's disk; the bucket is the offsite copy.
- **The action runs in the server.** The vault lock is in-process, so the archive is consistent only
  when the server takes it: `box run-now` and `box wiki-backup` go through the server. A host
  script that tars `data/wiki/` while the server runs can catch a page write half done.

## The graph (sigma 4)

- Node and edge sizes default to graph units in sigma 4; `itemSizesReference: 'screen'` keeps them
  in pixels.
- Sigma's label grid caps labels per cell but does not stop overlaps, so `GraphCanvas` culls
  colliding labels itself through a custom node state (`labelCrowded`, plus `labelLeft` to flip a
  label at the right edge). Keep that state when changing label rendering.
- Curved edges and arrows are built in (`sigma/rendering`); no separate edge-curve package.
- The default hover backdrop is white, unreadable in dark mode; the canvas sets it from the theme.
  The palette reads `--chart-1..8` and chrome tokens at runtime and rebuilds when `data-theme`
  changes, so test a change in both themes.
- The ForceAtlas2 layout runs in a worker (`graphology-layout-forceatlas2/worker`).

## Server and web

- **tRPC procedure names derive from the controller class.** A second controller in the feature
  (as the powerups add) gets names like `wikiAskAsk` unless it sets them: the powerup controllers
  use `@Trpc({ name: 'Wiki.ask' })` and friends. Set the name explicitly on any new controller.
- `index.tsx` sits on the web feature-registry import cycle. Never read a registry binding at module
  scope there, and load the app in a browser after touching it (`AGENTS.md`).
- The base imports nothing from the powerups. They mark themselves present at server init
  (`markWikiPowerup`, `provideWikiUpkeep` in `core/powerups.ts`), which is how `WikiStatus` and the
  web report absence. Keep new cross-links on that port rather than importing powerup code.
