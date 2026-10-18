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

- **`@ladybugdb/core` must be trusted.** Bun runs a dependency's install script only for packages
  in root `trustedDependencies`, and that script places the native `lbugjs.node`. Without the
  entry the import fails with a `dlopen` "no such file" error. A copy installed before the package
  was trusted stays broken: delete its directory under `node_modules/.bun/` and run `bun install`
  again.
- **One process per index.** LadybugDB takes an exclusive lock on `data/wiki/.search/`; a second
  process fails with "Could not set lock on file". The Box server owns it. Agents, the CLI, editors
  and scripts reach search through the server's tools and never open the index themselves; never
  point two servers at one instance.
- **The index rebuilds itself when its fingerprint changes**: the LadybugDB version, the index
  schema, the embedding model and its dimensions, and whether embeddings are on at all. Adding or
  removing the OpenAI key, changing `features.wiki.embeddingModel` or upgrading `@ladybugdb/core`
  drops `.search/` and rebuilds it from the pages in the background, re-embedding every section
  (API usage on a large vault). Keep `@ladybugdb/core` at an exact version and upgrade it
  deliberately, expecting the rebuild. An index that will not open is also dropped and
  rebuilt; deleting `.search/` with the server stopped is a safe reset.
- **The key is read at open.** Adding or changing `credentials.openai["*"].OPENAI_API_KEY` needs a
  server restart. The key is a platform API key; a ChatGPT or Codex subscription does not cover the
  embeddings API.
- **The index is a cache.** A failed reindex is logged and never fails the page change; a full sync
  at boot catches up. When the index is down, search says so and agents fall back to `index.md`
  and `WikiGrep`.
- `QUERY_VECTOR_INDEX` rows are not ordered by distance. Any new vector query must sort its own
  results, as the engine's ranking does.

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
- **The archive never holds the search index.** A restore rebuilds `.search/` on the next boot, and
  with an embeddings key that re-embeds every section: minutes and API usage.
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
