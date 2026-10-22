# Adapting the `sink` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/sink/`; the reference implementation lives in the Stack at `features/sink/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** core only. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/sink/` into the Box's `features/sink/{core,server,web}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

No shipped migrations currently. Back up data before applying any migration, stage its runner and registration first, and verify migration completion and boot compatibility on a disposable restored instance before continuing.

## 2. Customise for the team

1. **Nav label, order and section** - `features/sink/web/index.tsx`. Band 700 in the Workspace
   section puts it after Chat and Artifacts; move it if the sink is how this team actually works.
2. **The copy button's command** - `features/sink/web/views/SinkView.tsx` offers
   `/ingest-sink <name>`, the skill this recipe ships (`features/sink/skills/ingest-sink/`). It
   needs `planning` (`requires: [planning, sink]`) and turns a note into an initiative, tasks and a
   rationale doc. Without `planning` the skill is not linked: point the button at whatever this team
   does with a note instead, or drop it.
3. **Ingestion routes** - `ingest-sink` hands a note to any linked skill named
   `ingest-sink-<route>` whose description matches it, so another recipe can add a route for its own
   kind of note without editing this skill. Edit the work route's kinds and task funnels in the
   skill to fit the team.
4. **Where the notes live** - `data/docs/sink/`, from core's `docsDir()`. Create the
   folder or let the first save create it. `README.md` and any `_`-prefixed name are skipped, so
   `_done/` is the conventional archive.

There is no vocabulary, no env and no table, so there is nothing else to migrate or seed.

## 3. Prove it

```bash
box dev
```

Open `http://localhost:8190/sink`: the queue renders (empty is fine), **New** creates a file,
typing autosaves, **Delete** removes it. Check `data/docs/sink/` afterwards - the file is
really there. The feature's whole contract is that the folder and the view agree.

Agent-side, the same operations are MCP tools: `bun run cli sink-read`, `sink-save`, `sink-create`,
`sink-delete`.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
