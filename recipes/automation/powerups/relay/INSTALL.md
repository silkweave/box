# Webhook relay powerup: install

Deploys the relay Worker (`features/automation/cloudflare/`, see its README for the protocol) to the
owner's Cloudflare account and connects the Box to it. Read [POWERUP.md](POWERUP.md) and the
automation [GOTCHAS.md](../../GOTCHAS.md) first. Cloudflare credentials are needed for the deploy
only, never by the running Box. Do as much as possible yourself; stop only for the owner-only steps.

## Detect

Run `box webhooks-status` (admin). `relay.state: "connected"` means the Box has a working relay.
`"unconfigured"` names what is missing; `"off"` means `background.relay` is false on this Box;
`"waiting"` carries the last connection error. A Box that has `features.automation.relay` but is not
connected needs repair, not a new install. `features/automation/cloudflare/` in the Box is the
deployed Worker's source; compare it with the Stack's before redeploying.

## Requires

- The Automation recipe, adapted and validated, including `core/relay-protocol.ts`,
  `core/webhooks.ts`, `server/automation/relay-client.service.ts`,
  `server/automation/webhooks.controller.ts` and `web/views/WebhooksSection.tsx` (the base recipe
  carries them; the relay stays off until configured).
- `bunx wrangler` (Cloudflare's CLI, fetched on first use; nothing to add to the workspace) and
  `openssl` on the Box host.

## Owner decisions

Ask these together, before any Cloudflare step:

1. **Worker name.** Default `box-relay`, so the address is `https://box-relay.<account
   subdomain>.workers.dev`. A Cloudflare account that serves more than one Box needs one Worker per
   Box, for example `<team>-relay`.
2. **Which Box takes the webhooks.** Only that Box sets `background.relay: true`. A dev checkout or a
   scratch copy of the same Box must keep it false: the Worker serves one connection, and a second
   one takes over.
3. **Sources to start with.** Each source is a path segment and a provider. Offer `custom` (curl and
   scripts) first; list other providers from `box webhooks-status` (`providers`).
4. **Cloudflare sign-in.** `bunx wrangler login` on the Box host (opens a browser there), or a
   temporary API token (Owner-only steps).

## Owner-only steps

Ask for each when it is needed, then wait:

1. **Sign-in**, one of:
   - run `bunx wrangler login` in a terminal on the Box host and approve it in the browser; or
   - create an API token from the "Edit Cloudflare Workers" template, limited to this account. Hand
     it over for this session only; delete it once Verify passes.
2. **Register the hook URL at each real sender** (GitHub repository webhooks, a SaaS dashboard).
   Hand the owner the URL from Settings > Automation > Webhooks (Copy) and the secret if the
   provider signs; they paste them in.

## Steps

Run from the Box root. With an API token, prefix each `bunx wrangler` command with
`CLOUDFLARE_API_TOKEN=<token>` for this session. Never write a token to a file.

1. **Source.** `box stack fetch --ref <sha>`, then copy `<fetched stack>/features/automation/cloudflare/`
   to the Box's `features/automation/cloudflare/`. It imports `../../core/relay-protocol`, so it sits
   beside the Box's automation core. Merge rather than overwrite an existing copy.
2. **Configure** `features/automation/cloudflare/wrangler.toml` with the chosen `name`. With several
   accounts (`bunx wrangler whoami`), add `account_id = "<id>"`.
3. **Deploy.** `bunx wrangler deploy -c features/automation/cloudflare/wrangler.toml`. It prints the
   workers.dev URL. Until both secrets exist every route except `/` answers 503, so a deployed
   Worker without them is safe.
4. **Secrets.** Generate both and hand them over in one shell, so neither is printed:
   ```bash
   HOOK="$(openssl rand -hex 24)"; CLIENT="$(openssl rand -hex 32)"
   printf %s "$HOOK" | bunx wrangler secret put HOOK_KEY -c features/automation/cloudflare/wrangler.toml
   printf %s "$CLIENT" | bunx wrangler secret put RELAY_CLIENT_TOKEN -c features/automation/cloudflare/wrangler.toml
   HOOK="$HOOK" CLIENT="$CLIENT" bun -e '
     const fs = require("fs"); const f = "box.local.json"
     const d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {}
     const r = (((d.features ??= {}).automation ??= {}).relay ??= {})
     r.hookKey = process.env.HOOK; r.clientToken = process.env.CLIENT
     fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n", { mode: 0o600 })'
   ```
   Rotating later is this step again. A new `HOOK_KEY` changes every hook URL, so every sender must
   be updated; a new client token needs only a reconnect.
5. **Connect the Box.** In `box.json`:
   ```json
   "features": { "automation": { "relay": {
     "url": "https://box-relay.<account subdomain>.workers.dev",
     "sources": { "custom": { "provider": "custom" } }
   } } }
   ```
   A source whose provider signs gets its secret in `box.local.json` at
   `features.automation.relay.sources.<source>.secret` (generate one with `openssl rand -hex 32` for
   `custom`; use the sender's for a third-party provider).
6. **Arm** with the owner's consent: `background.relay: true` in this Box's `box.json`, then restart
   the server (or `box relay-reconnect` when only the relay settings changed).
7. **Record** the powerup, its Stack revision and the Worker name and URL in `docs/UPSTREAM.md`, and
   the session in `_docs/INTEGRATION.md`. No secret goes in either.

## Verify

1. `box webhooks-status` shows `relay.state: "connected"`, no `problems`, and each source without a
   `problem`.
2. `box webhook-test --kind ping` answers `ok: true`; within seconds the ledger (`box
   webhooks-status`, or Settings > Automation > Webhooks) shows a `recorded` row with
   `custom.ping`.
3. With curl, from any machine:
   ```bash
   curl -s -X POST "<hook URL>" -H 'content-type: application/json' \
     -d '{"kind":"deploy.done","dedup_key":"check-1","fields":{"repo":"example"}}'
   curl -s -X POST "<hook URL>" -H 'content-type: application/json' -d '{"fields":{}}'
   ```
   The first is `recorded` as `custom.deploy.done`, the second `rejected` with the schema reason.
   A source with a secret rejects an unsigned post.
4. Buffering: stop the Box server, post once, start it again: the delivery arrives after reconnect.
5. Optional: an event trigger on `custom.deploy.done` fires (with `background.automation` on) or
   `box trigger-run` with that sample event matches.
6. Delete the temporary API token, if one was used.
7. After these checks and the validation chain pass, record the powerup: add `relay` to
   `recipes.automation.powerups` in `box.json`.

## Remove

1. Set `background.relay` to false and remove `features.automation.relay` from `box.json` and
   `box.local.json`; remove `relay` from `recipes.automation.powerups`. The ledger table stays.
2. Remove the hook URLs from the senders.
3. Optionally, in the owner's account: `bunx wrangler delete -c features/automation/cloudflare/wrangler.toml`.
