# Adapting the `engagement` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/engagement/`; the reference implementation lives in the Stack at `features/engagement/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** content. Adapt those recipes first; their features must already be registered in the target Box. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/engagement/` into the Box's `features/engagement/{core,server,web,skills}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

No shipped migrations currently. A future schema change must be a new migration. Back up data before applying any migration, stage its runner and registration first, and verify migration completion and boot compatibility on a disposable restored instance before continuing.

## 2. Customise for the team

1. **Write `box.json features.engagement.pods`.** Without it no channel expects an engagement and
   the queue is permanently empty - this is the one required step.

   ```jsonc
   {
     "windowDays": 14,
     "channels": { "x": { "actions": ["like", "repost"] }, "linkedin": { "actions": ["react"] } },
     "karma": { "like": 1, "react": 1, "repost": 2, "comment": 5, "crosspost": 2 },
     "autoContent": { "pod": "launch", "channels": ["linkedin", "x"], "enabled": true }
   }
   ```

   It is read at query time, so edits apply without a restart. `autoContent` is what makes a
   published `content` piece appear as a card by itself; leave it `null` to curate by hand.
2. **Create the pods and their members** - Settings → Pods, or `bun run cli pod-upsert` /
   `pod-member-add`. Only `active` pods produce cards, and a piece's own submitter never gets a
   card for it.
3. **Set each member's channel handles** in Settings → Users (`users.channels`, keyed by
   platform). Comment verification hard-requires them; like/react verification does not.
4. **Map browsers** in `box.json browsers.users` (`users.id` → chromatrix identity) if the team wants
   x/linkedin verification rather than manual attestation. The browser lease is core
   (`docs/BROWSERS.md`).
5. **Vocabularies** in `verify/types.ts` (`EngagementAction`) and `inbox/types.ts`
   (`InboxChannel`, `InboxKind`). Adding an action needs a karma rate, an `ACTION_META` /
   `ACTION_ICON` entry in `features/engagement/web/engagement-types.ts`, and usually a
   `runStrategy` case. Leave `ParticipantKind` and `PodContentSource` alone - they are frozen
   single-value enums holding down three composite primary keys.
6. **Labels and order** in `features/engagement/web/index.tsx`: nav `Engagement` and the
   `Pods` settings section are both band 400. "Pods", "karma" and "Replies" are this team's words;
   change them in `index.tsx` and in `EngagementView.tsx`'s `SECTIONS` if they are not yours.
7. Set `server.dashboardUrl` in `box.json` for deep links to this Box.
8. **Which polls run.** Schedule them with Automation time triggers: a fast tier for
   `engagement-reddit-inbox` and `engagement-github-notifications`, about 15 minutes for
   `engagement-traction`. `engagement-github-notifications` needs a `github` account with a
   `GH_TOKEN` credential; `engagement-reddit-inbox` needs the Data Sync `reddit` powerup and
   `engagement-linkedin-comments` the Data Sync `linkedin` powerup for org posts
   (`recipes/data-sync/`); a call without its powerup fails naming it. Member-post comments need the
   author's browser in `box.json browsers.users`. The GitHub and traction polls skip while no
   trigger listens for their kind. `features.engagement.tractionTiers` sets the traction ladder
   (default `[10, 25, 50, 100, 250]`). To have the events delivered to people or rooms, add
   Automation's Alerts powerup and deliver triggers on the kinds.

## 3. Prove it

```bash
box dev
```

- `http://localhost:8190/settings/pods` - create a pod, add two members, add a piece with a URL
  on a channel that `pods.json` covers.
- `http://localhost:8190/engagement` - the Inbox section shows the other member's card for that
  piece (switch the active user in the top-right menu to see it), with the expected actions as
  badges and the karma badge in the top bar. "I did this" records it and the card disappears;
  "Not this one" dismisses it.
- `http://localhost:8190/engagement/replies` - the tactical inbox. Empty until Data Sync has pulled
  a `github-engagement` / `hackernews` / `reddit-engagement` snapshot or the events spine has a
  response-needed row; empty is a correct answer on a fresh Box. Open an item, save a draft, come
  back - it is still there.
- `http://localhost:8190/engagement/karma` - the leaderboards, once one engagement is verified.
- Open a published piece in `content` - the **Engagement** panel is rendered there by this
  feature's `content.piece.panel` slot contribution.

Agent-side:

```bash
bun run cli pods-overview                 # pods, members, content, engagements, cards, karma
bun run cli pod-upsert                    # and pod-member-add / pod-content-add
bun run cli pod-engagement-record         # attest one
bun run cli pod-engagement-draft          # what /engage writes
bun run cli pod-engagement-verify         # the real check; streams progress, lands in automation_runs
bun run cli inbox-draft-save              # what /draft-reply writes
bun run cli InboxSetDone                  # mark an inbox item done/snoozed/open
```

`pod-engagement-verify` and the four polls also appear in the Automation view's action catalog
(group `Engagement`), and every run lands in `automation_runs` like any other op. `box run-now
--action_id engagement-traction` runs a poll by hand; its summary says what it recorded and what
the delivery flush did.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
