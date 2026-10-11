# Adapting the `wiki` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/wiki/`; the reference implementation lives in the Stack at `features/wiki/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** core only. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/wiki/` into the Box's `features/wiki/{core,server,web,skills}`, register it, install its packages and trust `@ladybugdb/core` as INSTALL.md describes. The powerups are [ask](./powerups/ask/POWERUP.md) and [upkeep](./powerups/upkeep/POWERUP.md). Ask the owner which to add now; without them the wiki is complete and agents maintain it with the page tools. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

No shipped migrations. The vault is files, so back up `data/wiki/` before the first boot of an updated feature anyway.

## 2. Customise for the team

1. **The conventions.** `data/wiki/schema.md` (page types, directories, file naming, frontmatter)
   and `data/wiki/purpose.md` (what the wiki is for) are seeded on first open and then belong to
   the team. Agents read them through `WikiConventions` before writing, so this is where a team
   adds a page type or narrows what belongs in the wiki. A new type needs a row in the schema's
   table; lint checks `type:` against the directory it names. Edit them as files (they are not
   pages, so the page tools do not reach them).
2. **The skill.** `features/wiki/skills/wiki/SKILL.md` is the agent's working manual. Add the
   team's own rules (what to file, who to ask) there or in `purpose.md`; keep the tool rules
   (`baseRevision`, never write `log.md`, edit rather than rewrite).
3. **Which agents reach the wiki.** The wiki tools are Box tools, so every agent session with the
   Box's tools has them. For an external-facing toolset, deny the page mutations
   (`mcp__box__WikiPageWrite`, `...Edit`, `...Delete`, `...Rename`, `mcp__box__WikiLintFix`) and
   leave the reads.
4. **Search by meaning.** Add `credentials.openai["*"].OPENAI_API_KEY` to `box.local.json` and
   restart; change `features.wiki.embeddingModel` only knowing that it rebuilds the whole index
   (GOTCHAS.md).
5. **Labels and order.** Nav "Wiki" at 720 and Settings "Wiki" at 840 in `web/index.tsx`.
6. **Prompt additions** (with a powerup). Settings > Wiki, stored in `data/config/wiki.json`, read
   by the next job.

## 3. Prove it

```bash
box dev
box wiki-status
```

`wiki-status` reports the page count, whether search is available and in which mode, how many
sections wait for embeddings, and which powerups the server carries. Fix until `search.available`
is true (and, with a key, `pending` reaches 0).

Then one round trip through the tools (write a test page, search it, read it, edit it with its
revision, lint, delete it) and check `log.md` names the caller for each change. Open `/wiki`,
`/wiki/page/<slug>` and `/wiki/health` in a browser.

Agent-side: `box wiki-pages`, `wiki-page`, `wiki-search`, `wiki-grep`, `wiki-graph`,
`wiki-conventions`, `wiki-lint`, `wiki-status`, `wiki-page-write`, `wiki-page-edit`,
`wiki-page-delete`, `wiki-page-rename`, `wiki-lint-fix`, `wiki-settings`, `wiki-settings-save`.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, remove its powerups first (each powerup's INSTALL.md, including the upkeep triggers), then delete the feature's `core`, `server`, `web` and `skills` source directories and its registration lines. Preserve `data/wiki/` and `data/config/wiki.json` unless the team explicitly chooses to remove them; `data/wiki/.search/` can always go. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
