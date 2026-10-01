# Adapting the `alerts` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/alerts/`; the reference implementation lives in the Stack at `features/alerts/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** data, planning, content, engagement. Adapt those recipes first; their features must already be registered in the target Box. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/alerts/` into the Box's `features/alerts/{core,server,web}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

No shipped migrations currently. If one is added, preserve the feature id and append a new identity. Back up data before applying any migration, stage its runner and registration first, and verify migration completion and boot compatibility on a disposable restored instance before continuing.

## 2. Customise for the team

1. **The rules are the main thing.** Everything else is plumbing. Create
   `box.json features.alerts.rules`:

   ```json
   {
     "_readme": "route: owner | channel | user:<id> | chat:<room-slug>",
     "rules": [
       { "id": "reddit-replies", "event": "reddit.inbox", "route": "owner",
         "message": "u/{author} replied in r/{subreddit}: {summary}", "enabled": true },
       { "id": "run-failures", "event": "run.error", "route": "channel", "cooldown_min": 30,
         "message": "{action_id} failed: {error}", "enabled": true },
       { "id": "stars", "event": "github.star", "route": "channel", "notify": "digest",
         "message": "new star", "enabled": true },
       { "id": "daily-digest", "event": "digest.daily", "route": "channel",
         "message": "{summary}", "enabled": true }
     ]
   }
   ```

   `{token}`s are filled from the event's flat `fields`; unknown tokens are left intact, which is
   how you discover the real field names. `notify: "digest"` records the event and **no** alert row
   - the daily digest and traction detection read it from `events` instead. Rule ids are
   kebab-case; the route grammar is enforced. Editing through Settings -> Rules writes the same
   file, and the file is re-read per evaluation, so no restart either way.

2. **Routing.** `box.json features.alerts.routing`: `{ "routes": { "channel": {...},
   "user:alice": {...} }, "fallback": "channel" }`, each target a `{ receive_id, type }`. A route
   with no mapping and no transport records a delivery `error`. If the team lives in the Box's own
   chat instead of Lark, install `notifications` and route rules at `chat:<room-slug>` - that
   transport bypasses Lark entirely and needs no routing file.

3. **Which evaluators run.** Schedule the `alerts-*` actions through `automation` (fast tier for
   `alerts-reddit` / `alerts-github`, ~15 min for `alerts-traction`, daily for `alerts-digest`).
   `alerts-github` needs a `github` account with a `GH_TOKEN` credential; `alerts-linkedin` needs
   published LinkedIn pieces and, for member posts, the author's Chrome in `box.json features.data.browsers`.
   An evaluator with no matching rule short-circuits, so an unused one costs nothing.

4. **The vocabularies.** `cards.ts` `titleFor()` and the header colours, `traction.ts`
   `ENGAGEMENT_KINDS` / `DEFAULT_TIERS` / the 60-minute window, `digest.ts` `KIND_LINE`,
   `flush.ts` `DEFAULT_DEBOUNCE_SEC`. These nouns are inherited from the predecessor; change them to the team's.

5. **Labels and order.** Nav `Alerts` at band 810 and the settings section `Rules` at 810, both in
   `features/alerts/web/index.tsx`.

## 3. Prove it

```bash
box dev
```

Open `http://localhost:8190/alerts`: the feed renders (empty is fine) with a status badge per
row. Settings -> Rules lists the rules grouped by event kind; adding one there rewrites
`box.json features.alerts.rules` on disk - check the file, that is the whole contract.

Agent-side the same surface is MCP: `bun run cli alerts-rules`, `bun run cli alerts-list`,
`bun run cli alert-rule-save`, `bun run cli alert-rule-delete`.

To fire a test alert without waiting for anything real, use the cheapest source - a failed run.
With a rule on `run.error` enabled, run an action that will fail (an `alerts-github` with no
credential configured will do) from the Automation view or `bun run cli run-now`. The funnel records
the failure, `onRunOutcome` ingests a `run.error` event, the policy records a `pending` row, and
the feed shows it within its 10s poll; it flips to `delivered`, `suppressed` or `error` when the
debounced flush (default 300s) lands. `error` with `no Lark route mapping for "..."` means the
whole path worked and only `lark-routing.json` is missing.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
