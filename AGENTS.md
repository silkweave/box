# Silkweave Box

This repository is a core-only Silkweave Box consumer. Runtime source is under `apps/` and
`packages/`; reference feature source is added from the upstream Stack into `features/<id>/`
when a team chooses to integrate it.

Configuration is in root `box.json`. The gitignored `box.local.json` carries local overrides,
credentials and secrets. Do not add `.env` files or environment-variable configuration. Runtime
state is under `data/`, and a fresh Box starts with root `box.json` and an empty data directory.

The maintained registration files are the four `src/generated` files in `apps/server`,
`apps/web` and `packages/core`. Keep them empty until a feature is integrated. Workspace package
manifests own their actual dependencies; the root package owns only core and tooling.

Use Bun 1.4.2 (the version pinned in package.json):

```bash
bun install
bun run box:install
box verify
box dev
```

Read `docs/SETUP.md`, `docs/CONFIGURATION.md`, `docs/AUTH.md` and `docs/WAREHOUSE.md`
before changing runtime invariants. Run `box verify` before calling a change complete. Keep
all transient plans, spikes, validation results, local setup notes and handoffs in the gitignored
`_docs/` directory, including `_docs/VALIDATION.md` and `_docs/INTEGRATION.md`. Committed `docs/`
contains supported behavior, reusable procedures and durable integration records only.

Keep this checkout's Git metadata intact while preparing changes. Do not commit or publish from an
agent task unless explicitly asked.
