# Bun runtime and package manager

Stack and the core-only Box use Bun 1.4.2, pinned in `package.json` and CI. Bun runs the CLI,
Nest server, generation scripts and JavaScript build/test tools. The runtime SWC loader is
removed; SWC remains a compiler for the server's production build. Node-compatible imports
and `@types/node` remain useful APIs and types, not a requirement to launch Box with Node.

## Setup and commands

Install Bun using its [installation instructions](https://bun.sh/docs/installation), then:

```sh
bun --version                 # 1.4.2 or newer; CI uses exactly 1.4.2
bun install
bun run box:install           # register the public CLI once
box verify
box dev
```

Before registration, `packages/cli/bin/box` works from the checkout root. The installer will
not overwrite another program named `box`. If its directory is not on PATH, follow the
installer's printed shell instruction. Each checkout has its own source and lockfile; the
shim selects the nearest Box above the invocation directory. `box where` explains that choice.

`box build`, `box start` and `box start --prod` cover build and startup. Auth, database and MCP
verbs retain their existing behavior. `box verify --plain` is append-only and `--verbose`
includes child output. `bun run verify` remains a package-script entry point. Use explicit
`bun run build` for internal scripts: `bun build` means Bun's bundler.

## Dependency and configuration contract

- `package.json` declares `workspaces: ["apps/*", "packages/*"]` and the Bun version.
- Each repo has one `bun.lock`. The pnpm lock and workspace YAML are removed. Use
  `bun install --frozen-lockfile` for reproducible installation. Existing `workspace:*`
  dependencies and source export conditions are retained.
- `bunfig.toml` selects the isolated dependency linker and Bun execution for JavaScript tool
  shebangs, with no-orphans handling for launcher shutdown. `trustedDependencies` explicitly permits SWC, esbuild and better-sqlite3 install
  scripts. Other dependency lifecycle scripts are not implicitly trusted.
- Automatic dotenv loading is disabled with `env = false`. Public entry points also pass
  `--no-env-file`. Box settings still come from `box.json` and `box.local.json`; no environment
  configuration or replacement instance-data location is introduced.
- Each actual workspace owns its package dependencies. Features have no dependency manifests.

When moving an existing checkout, a clean dependency install can remove obsolete pnpm links
and stores under `node_modules`; never remove `data/` or local configuration as part of a
package-manager migration. Historical validation records retain the commands actually run.

## Validation boundary

See [VALIDATION.md](VALIDATION.md) for the actual migration checks. Browser/runtime rehearsals
use independent checkouts and data, with background work disabled.

WorkerDeck's upstream Bun improvements are being implemented by its maintainer. This migration
assumes that work will land, but does not claim it has landed or silently update WorkerDeck.
The earlier compatibility spike found test-loader and WebSocket shutdown differences and a
Node-specific development reload hook. Authenticated provider turns and active-turn recovery
must still be validated against the fixed release. Provider executables may retain their own
Node or native runtime requirements even though Box itself runs on Bun.
