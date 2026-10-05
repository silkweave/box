# Adapting the `artifacts` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it
gets into a Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/artifacts/`; the reference implementation lives in
the Stack at `features/artifacts/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and
[GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with
`box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** core only, at a revision with the path-mount port. Copy or adapt
`<fetched stack>/features/artifacts/` into the Box and register it (INSTALL.md lists the four
registration files). Record the source SHA, path mapping, and skipped upstream changes in the Box's
`docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

### Mobile module

When the owner wants artifacts in the mobile app, integrate `features/artifacts/mobile/` as described
in the [Mobile app powerup](./powerups/mobile/INSTALL.md). Its wire models mirror `dto.ts`; a change that
renames or removes a field the app reads breaks every installed build (docs/MOBILE.md, "Version
skew").

## 2. Customise for the team

- **Kinds.** `ARTIFACT_KINDS` in `core/rules.ts`. It is also the `artifacts.kind` enum: once rows carry
  a value, removing it needs a migration that rewrites them.
- **Reserved slugs.** `RESERVED_SLUGS` in `core/rules.ts`. They protect the public Worker's routes; add
  any route you give the Worker.
- **Upload size.** `features.artifacts.maxUploadMb` in `box.json`.
- **Comment alerts.** Add an alerts rule for `artifact.annotated` / `artifact.replied` that routes to
  the `owner` field or a chat room. Without the alerts recipe the events are still recorded.
- **Toolbar.** `features/artifacts/toolbar/`. It renders in a shadow root with its own CSS string;
  Tailwind classes do not exist there.
- **Public sharing.** The Public sharing powerup
  ([powerups/public-sharing](powerups/public-sharing/INSTALL.md)) deploys the Worker and sets
  `features.artifacts.public`; its domain is `routes` in the Box's
  `features/artifacts/cloudflare/wrangler.toml` plus `publicBaseUrl`.

## 3. Prove it

`box verify`, then the runtime checks in INSTALL.md's Validation. Load `/artifacts` and a published
page in a browser: the path mount and the sign-in return are not covered by typechecking.

## 4. Adapt or remove

Removing it: revoke every public copy, unregister the feature from the four registration files and
the web nav, delete `features/artifacts/`. The tables, `data/artifacts.db` and `data/artifacts/` stay
until removed by hand.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md).
