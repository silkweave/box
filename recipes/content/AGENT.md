# Adapting the `content` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/content/`; the reference implementation lives in the Stack at `features/content/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** data, planning. Adapt those recipes first; their features must already be registered in the target Box. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/content/` into the Box's `features/content/{core,server,web,skills}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

No shipped migrations currently. A future schema change must be a new migration. Back up data before applying any migration, stage its runner and registration first, and verify migration completion and boot compatibility on a disposable restored instance before continuing.

## 2. Customise for the team

1. **The voice files** - `data/docs/identity/voice-guide.md` and
   `docs/identity/voice/global.md`, then a `<channel>.md` per channel the team uses and
   `@<author>.md` per person. This is the single biggest edit: every skill checks drafts against
   these, and the ones that ship are EXAMPLES - a worked house style for the example authors
   (`alice`, `carol`, `bob`) plus the `company` company-page overlay. Editable in the app at
   Settings → Channels, or as files in the repo (they are markdown on disk on purpose - a style
   rule wants a diff and a git history).
2. **The channel vocabulary** - `CONTENT_CHANNELS` in
   `features/content/core/types.ts`, and the matching entry in
   `CHANNEL_PROFILE_DEFAULTS` in `profiles.ts` (a channel without a profile is not renderable and
   the overlay file will ignore it). Mirror it in
   `features/content/web/content-types.ts` and give it an icon/label in
   `features/content/web/components/contentMeta.tsx`. An enum edit needs **no migration**
   until a Box has shipped with the old set; after that, a migration in `migrations.ts` rewrites the
   existing `content_pieces.channel` rows first.
3. **The channel profiles** - limits, `requires`, `recommends`, `voiceNotes`. Prefer the runtime
   overlay (Settings → Channels → `box.json features.content.channelProfiles`) over editing `profiles.ts`: the
   file holds only the keys the team changed, so a later release that fixes a default still reaches
   them. `publish` is not overlayable - if a channel gains a real sender, that is code plus an
   `ActionSpec`, not config.
4. **The lifecycle copy** - `CONTENT_TRANSITIONS` labels and `intent` strings in `transitions.ts`
   are what the confirm dialogs say. `CONTENT_STATUSES` itself is four stages and an exit and was
   deliberately cut down from eight on 2026-08-13; read the header in `types.ts` before adding one
   back. A topic's statuses come from `planning` - change them there or not at all.
5. **Publishers** - decide per channel whether a real send is wanted. Leave
   `features.content.linkedinPublishLive` and `features.content.substackPublishLive` false and the scheduled
   publishers dry-run. Configure these switches in `box.local.json` only when the team has agreed to real sends.
6. **The skills** - the six under `features/content/skills/`, linked into `.claude/skills/`, are procedures, so they are edited as
   prose. `ingest-sink` applies plans through the planning tools and `illustration` runs the
   `generate-image.mjs` it ships, so neither needs a script in the Box's `package.json`. Rewrite
   authors, hosts and voice paths for the team. (`draft-reply` and `engage` moved to `features/engagement/skills/` on
   2026-09-13 - they drive that feature's tools, not this one's.)
7. **Labels and order** - the nav entry and the Channels settings section in
   `features/content/web/index.tsx`, both band 300.

## 3. Prove it

```bash
box dev
```

Open `http://localhost:8190/content`: the board renders (empty is fine). Create a topic, set its
target channels, move it to `active`, then open `/content/<topic>` - the topic page shows the
brief, the doc editor and the pieces. Open a piece at `/content/<topic>/<channel>`: the transition
wizard offers exactly `Verify`, `Approve`, `Archive` on a draft, the body editor autosaves to
`docs/content/<topic>/<channel>.md` (check the file), and an auto channel shows **Publish now**
while a manual one shows **Record published** and demands the URL. Settings → Channels edits a
profile and writes `box.json features.content.channelProfiles`.

Agent-side, the same surface is MCP:

```bash
bun run cli topic-upsert --id my-topic --title "My topic" --target_channels blog,reddit
bun run cli topic-pending-channels --id my-topic
bun run cli content-upsert --id my-topic/reddit --title "…"
bun run cli content-doc-save --id my-topic/reddit --content "…"
bun run cli voice-read --channel reddit --author alice
bun run cli content-verify --id my-topic/reddit --findings '[]'   # --no-passed for a failing verdict
bun run cli content-list --topic_id my-topic
bun run cli content-publish --id my-topic/reddit --published_url https://… --confirm
```

`content-publish` is record-only and refuses without `confirm`, and refuses `linkedin` outright.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
