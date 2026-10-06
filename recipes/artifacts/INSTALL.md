# Adapt the artifacts recipe

This is the adaptation guide for the artifacts recipe. Read [RECIPE.md](./RECIPE.md), [SPEC.md](./SPEC.md),
the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's docs/UPSTREAM.md, and its current
_docs/INTEGRATION.md before changing files. These recipe documents ship with core, so a Box has them
at `recipes/artifacts/`. The reference implementation does not: it lives in the Stack at
`features/artifacts/`. In a Box, run `box stack fetch --ref <recorded Stack SHA>` and read
`<fetched stack>/features/artifacts/`, so the documents and the code come from the same Stack revision.

## Prerequisites

- Existing Box backup and a recorded restore path for both data and matching application source.
- Core at a revision with the path-mount port (`packages/core/src/path-mounts.ts`, the mount
  dispatch in `apps/server/src/main.ts` and the sign-in return in `apps/web/src/lib/returnPath.ts`).
  An older core needs `$upgrade` first.
- No recipe to build on.
- Feature-specific package imports: `tar` and `lucide-static` (core), `better-sqlite3` (core, already
  a root dependency for chat), `pindrop.js` (toolbar). Install latest into the root workspace
  package. `react`, `lucide-react` and the shared UI come from the root workspace already.
- A recorded source SHA in docs/UPSTREAM.md, and an integration entry with scope, target SHA,
  intended changes, and state in _docs/INTEGRATION.md.
- A disposable instance for build, typecheck, tests, schema checks, and boot verification.

## Integration

1. Copy/adapt `<fetched stack>/features/artifacts/{core,server,web,toolbar,skills}` into the Box's
   `features/artifacts/`. `cloudflare/` and `mobile/` belong to powerups; leave them out.
   Replace the placeholder web route if the Box carried it.
2. Register the feature in `packages/core/src/generated/features.ts`,
   `packages/core/src/generated/exports.ts`, `apps/server/src/generated/features.ts` and
   `apps/web/src/generated/features.ts` (`WEB_FEATURES`, `WEB_ROUTES`). Place the `artifacts`
   navigation entry under the Workspace heading.
3. Keep `**/toolbar/**` in the server build's swc `--ignore` list (`apps/server/package.json`): the
   toolbar is a browser bundle Bun builds at request time, not server code.
4. Run `bun run skills` so `publish-artifact` is linked for the Box's agents.
5. There are no migrations yet. The tables come from the baseline and `data/artifacts.db` creates
   itself. New schema behaviour gets a new migration (warehouse) or a new `STEPS` entry
   (`core/kv.ts`); never edit a shipped one.
6. Preserve local customizations and write durable findings to the Box's docs/GOTCHAS.md. Advance the
   completed upstream SHA in docs/UPSTREAM.md only after full validation and a boot pass.

### Powerups (optional)

- **Public sharing** ([powerups/public-sharing](powerups/public-sharing/INSTALL.md)): public copies
  on Cloudflare with password and expiry. A Worker already deployed for the standalone artifacts
  host speaks the same protocol and can be reused with its existing token.
- **Mobile app** ([powerups/mobile](powerups/mobile/INSTALL.md)): the Artifacts tab in the Box app.

Adapt and validate the recipe first; each powerup can be added then or later.

### Importing from the standalone artifacts host (optional)

1. Back up the standalone data dir and the Box (`box db backup`, plus `data/artifacts/` and
   `data/artifacts.db` if they exist).
2. Make sure every teammate is a Box user. Dry-run first:
   `box artifact-import --from <data dir> --users luna=<agent id>,toby=<id> --dryRun`. Unmapped
   roster ids that are not Box users fall to the system principal and are listed as warnings.
   Annotations that carry only a display name (no roster id) match a Box user's full name or
   nickname; map any other name explicitly (`--users "Tobias Strebitzer=toby"`).
3. Run it without `--dryRun`. It is idempotent per slug (`--replace` overwrites). It re-stamps every
   entry document for `/artifacts/<slug>/` and keeps public state, so a reused Worker keeps serving.
4. Point the old host's URLs at `/artifacts/<slug>/` on the Box (a redirect at the old host's proxy),
   then retire it.

## Validation

Run `box verify`, then boot a disposable instance (background work disabled) and exercise:

- publish an HTML page and a gzipped tree over `box artifact-publish`, and a large tree over the
  multipart upload; open both at `/artifacts/<slug>/` signed in, and signed out (expect the sign-in
  round trip back to the page);
- `artifact.kv` from the page, the toolbar (share dialog, copy link, a pinned comment and a reply);
- rename, delete, folder create/delete, filters in the gallery at `/artifacts`;
- the import dry run against a copy of the standalone data dir, when relevant;
- without public sharing: the Share dialog shows the setup notice (admins get "Set up public
  sharing"), and `box artifact-sharing-status` lists the missing keys;
- with the Public sharing powerup: its Verify steps.

Record the commands and results in _docs/VALIDATION.md.
