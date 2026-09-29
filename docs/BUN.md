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
verbs retain their existing behavior. `box verify --plain` is append-only, `--verbose`
includes child output and `--force` bypasses Turbo's cache. `bun run verify` remains a package-script entry point. Use explicit
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
package-manager migration.

## Local WorkerDeck development

The tracked helper can temporarily replace installed WorkerDeck packages with the built output of
a local WorkerDeck checkout. Manifests and `bun.lock` keep their registry versions.

```sh
# Build WorkerDeck in its own checkout first.
bun --no-env-file scripts/workerdeck-local.ts /path/to/workerdeck
bun run build --force
bun run typecheck --force
box verify

# Restore the registry packages.
bun --no-env-file scripts/workerdeck-local.ts --restore
bun run build --force
bun run typecheck --force
box verify
```

The local checkout must have its dependencies installed and its package outputs built. Rebuild it
after every change, then force Stack's build and typecheck because Turbo cannot track source outside
this checkout. Restart running Box processes after rebuilding. An install may replace the links;
the helper records their state in ignored `node_modules/.workerdeck-local.json` and refuses to
restore links that another operation changed.

## Validation boundary

See [VALIDATION.md](VALIDATION.md) for validation requirements. Browser/runtime rehearsals
use independent checkouts and data, with background work disabled.

Validate WorkerDeck upgrades against Box's actual runtime behavior: authenticated provider turns,
streaming, approvals, interruption, reconnect, recovery and shutdown. Upstream's supported Node
test suite and focused Box/Bun integration checks serve different purposes. A test-harness
failure alone does not establish a deployed runtime failure. Provider executables may retain
their own Node or native runtime requirements even though Box itself runs on Bun.
