# Silkweave Box

This is a core-only Silkweave Box consumer. It contains the server, web app, CLI and shared core; reference features are integrated selectively from the Stack.

## Start

    bun --version    # 1.4.2 or newer
    bun install
    bun run box:install
    box verify
    box dev

The browser uses the server port configured in box.json. Put machine-specific ports, local credentials and secrets in the gitignored box.local.json. Runtime data lives under data/. Do not use .env files.

## Layout

- apps/server: NestJS front door, auth, MCP, tRPC and the agent host.
- apps/web: React/Vite browser application.
- packages/core: warehouse, auth, configuration and runtime ports.
- packages/cli: the box CLI and workspace checks.
- packages/ui: shared presentation components.
- features/: empty until a team integrates a reference feature.
- docs/: runtime and integration guidance.

The four maintained feature registration/export files stay empty for this core-only checkout. When integrating a feature, copy its source, add its package dependencies, update registration, and run the complete validation chain.

## Documentation

Start with docs/SETUP.md, then read docs/CONFIGURATION.md, docs/AUTH.md, docs/SERVER.md and docs/WAREHOUSE.md. Validation results belong in docs/VALIDATION.md.
