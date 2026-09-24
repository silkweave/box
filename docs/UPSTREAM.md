# Source record

The Box consumes selected source from [silkweave/stack](https://github.com/silkweave/stack).
Record full source SHAs and path decisions here when refreshing core or integrating a feature; a
date or release label alone is not an ancestor.

## Core consumer baseline

The completed core refresh and guided first-run setup are based on Stack commit
`d34b6182db9cd03bf58f98115bb397f4bbbe25e1`. The Box includes the core server, web application,
Builder, CLI, provider utilities, UI library and core skills. Feature registration and exports are
intentionally empty.

The target includes Stack commits `1679963573056b98046b8c5dc2bf2434452197a9` for the reviewed
dependency and documentation cleanup and `bc9cf70f076ed1d505b380fd2389d51dc2d37a4b` for first-run
owner guidance and the contextual onboarding dashboard. Stack commit
`d34b6182db9cd03bf58f98115bb397f4bbbe25e1` adds `bun setup`, provider-home detection,
first-owner creation, local CLI credential storage and the direct sign-in-link handoff. The
consumer retains its reduced package scope, core-only lockfile, empty feature registration and
Box-specific operational guidance. Stack-only development Box build and reset commands from that
commit are intentionally not part of the consumer.

The consumer intentionally omits repository-local `.codex/config.toml`. Codex configuration is
machine-owned; `docs/examples/codex-config.toml` remains only an example for a user's global
configuration.

## Recipes, recipe catalog and Stack source

Materialized on 2026-09-24 from Stack commit `4d61abad047840b6086d2fe697ab33b767404f53`. The refresh adds the managed `recipes/`
tree (recipe docs and placeholder screenshots), `docs/RECIPES.md`, the onboarding recipe catalog
with search, detail dialog and the Builder brief handoff, the `stack.source` setting with
`box stack where` and `box stack fetch`, and recipe wording in the guides and core skills. The
integration adds no migrations and preserves the consumer's empty feature registration.
`box.local.json` points `stack.source` at the enclosing Stack checkout (`..`).

## Scoped Builder adoption and dev-mode hardening

Stack commit `06aa6af83e9ecf32b1b8fad606bccd68ae6065ee` includes `404de79` (Builder adopts
confirmed uncommitted changes into a new session instead of refusing a dirty checkout),
`381fbc5` (dev-mode Vite serves only source roots, a dev proxy guard refuses `/@fs/` requests
outside them, and the public listener binds the new `server.host` setting, `127.0.0.1` by
default), and `06aa6af` (test fixtures move to the OS temp directory). Adopted paths are the
Builder lifecycle, supervisor and view, the server entry point and new dev proxy guard, the Vite
config, `box.json` parsing and schema, the affected tests and lockfile, and the Builder,
configuration and server guides. The integration adds no migrations and preserves the consumer's
empty feature registration.

## Scoped Builder model integration

Stack commit `b0f5b265335b62f72ca91323161ab04a2c931791` moves WorkerDeck to 2.15.0, starts
Builder sessions on a default model per engine, and narrows the status bar model select to the
current models. Adopted paths are the Builder host and its tests, the Builder view, the new
`apps/web/src/lib/builderModels.ts` with its test, the app manifests and lockfile, and
`docs/BUILDER.md`. The integration adds no migrations and preserves the consumer's empty feature
registration.

## Scoped application-control integration

Stack commit `75a62d2b3bb91367eb9192c85a6363b4284a955c` adds the bounded local application
status and restart commands, keeps the Builder host outside the restartable child process, and
teaches Builder agents never to stop or replace `box dev`. Adopted paths are the Builder local
control and supervisor, Builder session instructions and tests, CLI application control and
dispatch, core skill guidance, and the CLI, Builder and feature operating guides. The integration
adds no migrations and preserves the consumer's empty feature registration.

## Scoped CLI integration

The CLI implementation and tests were copied from the Stack working tree based on
`05f6435d36e1e4f960ab6c05746813d6c1bdec9d` and finalized in Stack commit
`f368209804c3907e19f7cc7b09f1f0ade5e76aff`. The copied paths are
`packages/cli/src/{ui,tasks,task-view,verify}.ts`, their tests and `docs/CLI.md`; the consumer
manifest changed only its verify script.

## Scoped Bun integration

The runtime and package-manager integration began from Stack base
`48146e2d5143d47053db9443147e9d46506e3a12` plus its then-uncommitted Bun changes and was finalized
in Stack commit `2291e2d1562b81b4a2f433469fc47d4f61d9f5b9`. Adopted paths include the CLI/shim,
branding hook, runtime entry points, workspace and lockfile policy, CI, command guidance and setup
skills. Consumer package ownership and empty feature registration remain local decisions.

## Refresh procedure

Compare the recorded source commit, local source and target source before copying. Preserve local
changes and migration identities, document intentional path differences, run the full verification
chain and boot a disposable instance before advancing this record. Unresolved compatibility work
belongs here only when it remains a durable constraint; run-specific evidence belongs in `_docs/`.
