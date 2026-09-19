# Setup

Install the Node and pnpm versions declared in `package.json`, then run `pnpm install` at the
checkout root. `pnpm box:json` creates root `box.json` if needed. Edit its system principal before
first boot. Put local ports and secrets in `box.local.json`; see [CONFIGURATION.md](CONFIGURATION.md).

Run `pnpm dev` for server and frontend development. Run `pnpm build` followed by `pnpm start:prod`
for a production build. The default server port is 8190; Vite uses 5190. Configure alternative
ports in the local file before booting another checkout.

Create the first human with `pnpm auth:token <id> --quiet`, then use the short-lived sign-in link.
Read [AUTH.md](AUTH.md) for identity and access rules. `pnpm box:install` optionally installs the
`box` CLI shim; `--bin-dir=<path>` selects a different installation directory.

The root is the complete development Box. `box/` is a separate checkout with its own code and data.
To produce a core-only consumer, follow [STARTER.md](STARTER.md). Integrate features using their
source and documentation; [FEATURES.md](FEATURES.md) describes the process.

Run `pnpm verify` and record the result in [VALIDATION.md](VALIDATION.md). Test changed routes using
Chrome DevTools MCP in an independent checkout with background work disabled.
