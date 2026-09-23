# Silkweave Box

This is a core-only Silkweave Box consumer. It contains the server, web application, Builder, CLI
and shared core. Reference features are integrated selectively from the upstream Stack and become
ordinary source in this repository.

## Start

Use Bun 1.4.2 or newer, as declared in `package.json`:

```sh
bun install
bun setup
bun run box:install
box verify
box dev
```

Guided setup confirms the machine principal, creates the first owner, detects local Codex and
Claude profiles, configures the selected profiles, and prints a short-lived sign-in link without
printing the permanent owner token.

The browser uses the server port configured in `box.json`. Put machine-specific ports, local
credentials and secrets in gitignored `box.local.json`. Runtime data lives under `data/`. Do not
use `.env` files or environment-variable configuration.

`box dev` serves the application and the stable administrator Builder at `/builder`. The Builder
remains available as the recovery and development surface while the editable application restarts.

## Layout

- `apps/server`: NestJS front door, auth, MCP, tRPC, Builder supervisor and agent host.
- `apps/web`: React/Vite application and standalone Builder shell.
- `packages/core`: warehouse, auth, configuration and runtime ports.
- `packages/cli`: the public `box` CLI and workspace checks.
- `packages/ui`: reusable presentation components.
- `features/`: empty until a team integrates reference feature source.
- `docs/`: supported runtime, maintenance and integration guidance.
- `_docs/`: ignored plans, run logs, screenshots and temporary handoffs.

The four maintained feature registration/export files stay empty for this core-only checkout. When
integrating a feature, read its upstream source and documentation, adapt its code, add the packages
its imports require, update registration and exports, then run the complete validation chain.

## Documentation

Start with the [documentation index](docs/README.md). Read
[Setup](docs/SETUP.md), [Configuration](docs/CONFIGURATION.md),
[Authentication](docs/AUTH.md), [Builder](docs/BUILDER.md) and
[Warehouse](docs/WAREHOUSE.md) before changing runtime invariants. Record current integration and
validation evidence in `_docs/`; keep durable product behavior and ancestry in `docs/`.

## License

MIT. See [LICENSE](.github/LICENSE).
