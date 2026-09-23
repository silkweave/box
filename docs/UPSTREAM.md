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
