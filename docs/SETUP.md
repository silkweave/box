# Setup

Install Bun 1.4.2 as declared in `package.json`, then run `bun install` at the checkout root.
`bun run box:json` creates root `box.json` if needed. Continue with:

```bash
bun setup
bun run box:install
bun dev
```

`bun setup` confirms the system principal before it is locked, asks for the first owner's ID and
display name, detects conventional Codex and Claude configuration directories, and lets the owner
choose which detected profiles to configure. It creates the owner as an administrator, stores the
owner token in mode-0600 `box.local.json` for the local CLI without printing it, and returns a
short-lived single-use sign-in link. A provider directory without its normal login marker is
configured but reported as still needing sign-in.

Edit the system principal in `box.json` before accepting it in setup. Put machine-specific ports
and secrets in `box.local.json`; see [CONFIGURATION.md](CONFIGURATION.md).

Register the `box` shim with `bun run box:install` once, then run `box dev` for server and frontend development. Run `box build` followed by `box start --prod`
for a production build. The default server port is 8190; Vite uses 5190. Configure alternative
ports in the local file before booting another checkout.

The signed-out owner instructions remain a fallback when guided setup was skipped. In that case,
create the first human with `box auth token <id> --quiet`, then use its printed sign-in link. Read
[AUTH.md](AUTH.md) for identity and access rules. For shim installation, `--bin-dir=<path>` selects
a different installation directory.

This checkout is a core-only consumer. Integrate reference features using their source and
documentation; [FEATURES.md](FEATURES.md) describes the process.

Run `box verify` using the [validation procedure](VALIDATION.md) and record the result in local
`_docs/VALIDATION.md`. Test changed routes using Chrome DevTools MCP in an independent checkout
with background work disabled.

See [CLI.md](CLI.md) for verify progress, output detail, retained logs and CI output options.

Bun owns the workspace and the single root `bun.lock`; workspace patterns and trusted dependency
build scripts live in `package.json`. Use `bun install --frozen-lockfile` in CI. The old pnpm
lockfile and workspace YAML are removed. `bunfig.toml` disables dotenv loading and runs JavaScript
tool shebangs through Bun. Native engine executables keep their own requirements.

Before the shim is on PATH, use `packages/cli/bin/box verify` or `bun run verify`.
See [BUN.md](BUN.md) for migration details and the WorkerDeck validation boundary.
