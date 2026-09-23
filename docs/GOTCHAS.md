# Gotchas

This is the project-wide warning record. Feature-specific warnings belong beside the feature. A
consumer Box consolidates its durable local findings here.

## Layout and runtime

- The layout is `features/<id>/{core,server,web}`. Node package resolution follows the file's
  location, so dependencies imported by this shared tree belong in the root workspace package.
  TypeScript paths alone do not repair runtime package resolution.
- `src/generated/features.ts` and `packages/core/src/generated/exports.ts` are maintained and
  tracked. Update them with the source change; do not treat them as disposable install output.
- A scratch or source Stack checkout has its own workspace and install. If code works in the Stack
  but fails here, inspect whether it resolved a package from an ancestor `node_modules`.
- A passing build against the current lockfile does not prove current latest dependencies. Record
  the tested revision, date, and freshness date in `_docs/VALIDATION.md`.
- Migrations are transcribed byte-for-byte, backed up before application, and run before unrelated
  feature changes. Chat's ledger has no checksum, while the warehouse ledger does.
- In development Vite serves files on the Box origin before sign-in, because the login page is the
  SPA. Never widen `server.fs.allow` in `apps/web/vite.config.ts` to the checkout root: that served
  `box.local.json` (the session signing secret) and `data/` to anonymous requests until 2026-09-23.
  Widen it only together with `DEV_SOURCE_DIRS` in `apps/server/src/auth/dev-proxy-guard.ts`.
- The public port binds `server.host`, `127.0.0.1` by default. A Box reached over a tailnet or LAN
  needs `server.host` set explicitly in `box.local.json`; after upgrading from a revision that
  bound every interface, such a Box is unreachable from other machines until that is set.


## Runtime integration

Vitest must resolve every core import to the same source module or its instance override splits
into two states; server tests must apply the SWC decorator transform to feature files outside the
server package. Both are implemented in the package test configs. Keep durable import constraints
and required dependency pins here. This file is not the operation log; use
`_docs/INTEGRATION.md` only while an integration is active.

## Dependency compatibility

Check declared peer ranges when changing Nest/Swagger or WorkerDeck/engine dependencies. A
successful install or disabled-agent browser boot does not prove engine compatibility. Exercise
the affected runtime paths, record results in `_docs/VALIDATION.md`, and document a required pin
with its demonstrated incompatibility. Do not suppress peer warnings globally.

WorkerDeck 2.13.0 declares `@openai/codex ~0.149.0` as its optional peer. Keep Codex on that range
until WorkerDeck widens the contract and the authenticated Codex path has been exercised.
