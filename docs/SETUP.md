# Setup

Install Bun 1.4.2 as declared in `package.json`, then run `bun install` at the
checkout root. `bun run box:json` creates root `box.json` if needed. Edit its system principal before
first boot. Put local ports and secrets in `box.local.json`; see [CONFIGURATION.md](CONFIGURATION.md).

Register the `box` shim with `bun run box:install` once, then run `box dev` for server and frontend development. Run `box build` followed by `box start --prod`
for a production build. The default server port is 8190; Vite uses 5190. Configure alternative
ports in the local file before booting another checkout.

Create the first human with `box auth token <id> --quiet`, then use the short-lived sign-in link.
Read [AUTH.md](AUTH.md) for identity and access rules. For shim installation,
`--bin-dir=<path>` selects a different installation directory.

This checkout is a core-only consumer. Integrate reference features using their source and
documentation; [FEATURES.md](FEATURES.md) describes the process.

Run `box verify` and record the result in the gitignored `_docs/VALIDATION.md`. Test changed routes
using Chrome DevTools MCP in an independent checkout with background work disabled.

See [CLI.md](CLI.md) for verify progress, output detail, retained logs and CI output options.

Bun owns the workspace and the single root `bun.lock`; workspace patterns and trusted dependency
build scripts live in `package.json`. Use `bun install --frozen-lockfile` in CI. The old pnpm
lockfile and workspace YAML are removed. `bunfig.toml` disables dotenv loading and runs JavaScript
tool shebangs through Bun. Native engine executables keep their own requirements.

Before the shim is on PATH, use `packages/cli/bin/box verify` or `bun run verify`.
See [BUN.md](BUN.md) for the runtime and package-manager contract, including the current WorkerDeck
compatibility boundary.
