# Public sharing powerup: install

Deploys the public Worker (`features/artifacts/cloudflare/`, see its README for the protocol) to the
owner's Cloudflare account and connects the Box to it. Read [POWERUP.md](POWERUP.md) and the
artifacts [GOTCHAS.md](../../GOTCHAS.md) first. The Box only needs three settings at the end: two
URLs in `box.json` and one shared secret in `box.local.json`. Cloudflare credentials are needed for
the deploy only, never by the running Box.

## Detect

Run `box artifact-sharing-status` (admin). `configured: true` means the Box has the powerup;
`ok: true` means it works. Use this to confirm the Box before recording the powerup in the
`recipes` ledger or when backfilling it. Configured but not ok is a repair, not a new install: read the failing
check, fix that part, and run Verify. `features/artifacts/cloudflare/` in the Box is the deployed
Worker's source; compare it with the Stack's before redeploying.

## Requires

- The Artifacts recipe, adapted and validated.
- `bunx wrangler` (Cloudflare's CLI, fetched on first use; nothing to add to the workspace) and
  `openssl` on the Box host.

## Owner decisions

Ask these together, before any Cloudflare step:

1. **New or existing Worker.** Deploy a new one (the default), or reuse a Worker that already serves
   the standalone artifacts host. Reusing needs that Worker's current `SYNC_TOKEN` from the owner,
   because Cloudflare cannot show a secret again; without it, rotate (Steps 5) and update every
   client of the old token. Never point two Boxes at one Worker: slugs would collide.
2. **Public address.** The Worker's `https://<name>.<account subdomain>.workers.dev` (no domain
   needed), or a custom host such as `share.example.com` on a zone in the same Cloudflare account.
   Never the Box's own host: public copies are a separate origin by design.
3. **Cloudflare sign-in.** `bunx wrangler login` on the Box host (opens a browser there, so someone
   must be at that machine), or a temporary API token (Owner-only steps).
4. **Names.** Worker and bucket default to `artifacts`, so the public address is
   `https://artifacts.<account subdomain>.workers.dev`. A Cloudflare account that serves more than
   one Box needs a distinct pair per Box, for example `<team>-artifacts`.

## Owner-only steps

Ask for each when it is needed, then wait:

1. **Cloudflare account with R2.** Enable R2 once in the Cloudflare dashboard (R2 Object Storage).
   Cloudflare asks for a payment method even on the free allowance.
2. **Sign-in**, one of:
   - run `bunx wrangler login` in a terminal on the Box host and approve it in the browser; or
   - create an API token (My Profile, API Tokens, Create Token) from the "Edit Cloudflare Workers"
     template, limited to this account, and make sure it carries Account · Workers R2 Storage · Edit.
     For a custom domain, include that zone with Workers Routes · Edit and DNS · Edit. Hand it over
     for this session only. Delete it in the dashboard once Verify passes; the Box never needs it.
3. **Custom domain only:** the domain's zone must already be on this Cloudflare account.

## Steps

Run from the Box root. With an API token, prefix each `bunx wrangler` command with
`CLOUDFLARE_API_TOKEN=<token>` for this session. Do not write the token to `box.json`,
`box.local.json`, a shell profile or a file.

1. **Source.** `box recipe fetch artifacts --version <the version in the recipes ledger of box.json>`, then copy
   `<fetched recipe>/features/artifacts/cloudflare/` to the Box's `features/artifacts/cloudflare/`.
   It imports `../../core/{runtime,rules,password}`, so it must sit beside the Box's artifacts core.
   If the Box already has a copy, merge rather than overwrite: it holds that Box's route and names.
2. **Configure** the Box's `features/artifacts/cloudflare/wrangler.toml` with the chosen Worker
   `name` and `bucket_name`. For a custom domain, set
   `routes = [{ pattern = "<host>", custom_domain = true }]`.
3. **Check sign-in.** `bunx wrangler whoami` names the right account. With several accounts, add
   `account_id = "<id>"` to `wrangler.toml`.
4. **Bucket and Worker.**
   ```bash
   bunx wrangler r2 bucket create <bucket>      # skip when `bunx wrangler r2 bucket list` shows it
   bunx wrangler deploy -c features/artifacts/cloudflare/wrangler.toml
   ```
   The deploy prints the workers.dev URL. Until the secrets exist every sync is refused, so a
   deployed Worker without them is safe.
5. **Secrets.** Generate both and hand them over in one shell, so neither is printed or kept:
   ```bash
   SYNC="$(openssl rand -hex 32)"
   printf %s "$SYNC" | bunx wrangler secret put SYNC_TOKEN -c features/artifacts/cloudflare/wrangler.toml
   openssl rand -hex 32 | tr -d '\n' | bunx wrangler secret put COOKIE_SECRET -c features/artifacts/cloudflare/wrangler.toml
   SYNC="$SYNC" bun -e '
     const fs = require("fs"); const f = "box.local.json"
     const d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {}
     const a = ((d.features ??= {}).artifacts ??= {})
     a.public = { ...(a.public ?? {}), syncToken: process.env.SYNC }
     fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n", { mode: 0o600 })'
   ```
   Reusing a Worker with its existing token: write that token instead and skip both `secret put`
   lines. Rotating later is this step again; it breaks nothing but in-flight syncs.
6. **Connect the Box.** In `box.json`, set `features.artifacts.public.workerUrl` to the workers.dev
   URL and `publicBaseUrl` to the public address (the same URL when there is no custom domain). The
   Box reads them on the next request; no restart.
7. **Record** the powerup with the fetched version and sha256 in the `recipes` ledger of `box.json`, the Worker and bucket names and the public address
   in `docs/UPSTREAM.md`, and the session in `_docs/INTEGRATION.md`. No secret goes in either.

## Verify

1. `box artifact-sharing-status` reports `ok: true`, with every check passing: `worker` (reachable,
   token accepted, storage bound), `public-host` (the public address serves the Worker),
   `separate-origin` and `https`.
2. Round trip with a throwaway page:
   ```bash
   box artifact-publish --slug sharing-check --html '<title>Sharing check</title><h1>ok</h1>'
   box artifact-set-public --slug sharing-check --is-public --password <a test password>
   ```
   Open `<publicBaseUrl>/sharing-check/` signed out: the password page appears, the password opens
   it. Then `box artifact-set-public --slug sharing-check --no-is-public` and reload: the link
   answers 410. `box artifact-delete --slug sharing-check`.
3. In the gallery, an artifact's Share dialog offers "Make public" instead of the setup notice.
4. Delete the temporary API token, if one was used.
5. After the checks above and the validation chain pass, record the powerup: add `public-sharing` to
   `recipes.artifacts.powerups` in `box.json`.

## Remove

1. Make every public artifact private (gallery filter "Public", or `box artifact-list --is-public`
   then `box artifact-set-public --slug <slug> --no-is-public` each). This purges their copies.
2. Remove `features.artifacts.public` from `box.json` and `box.local.json`, and remove `public-sharing`
   from `recipes.artifacts.powerups` in `box.json`.
3. Optionally, in the owner's account: `bunx wrangler delete -c features/artifacts/cloudflare/wrangler.toml`
   and `bunx wrangler r2 bucket delete <bucket>` (the bucket must be empty), then delete
   `features/artifacts/cloudflare/`.
