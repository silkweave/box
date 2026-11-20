# mcp gotchas

The feature id (`mcp`, the same as the recipe id) is part of runtime registration and settings
keys. Keep it stable. Record any local exception in the Box's `docs/GOTCHAS.md` and leave current
operation state in `_docs/INTEGRATION.md`.

- **`features.mcp` is not core's `mcp`.** Core's `mcp.url` and `mcp.token` configure the `box`
  CLI's connection to this Box. The `servers` powerup keeps its settings under
  `features.mcp.servers` and its secrets under `credentials.mcp.<id>`.
- **Sign-in needs an https address.** The MCP URL is `server.dashboardUrl` + `/mcp`, offered only on
  https or on `http://localhost` and `http://127.0.0.1` when the client runs on the Box's machine.
  A Box reached at `http://box.tailnet:8190` offers no sign-in; serve it over https
  (`tailscale serve` gives a `ts.net` certificate) and set `dashboardUrl`.
- **Changing the MCP URL disconnects everyone.** Grants are issued for one URL; at the next start
  the old ones are revoked (`url_changed`) and every person connects again. Changing
  `dashboardUrl` for another reason, such as a new hostname, does the same.
- **The client must reach the address.** Claude Code, Codex and the other local clients run on the
  person's machine and call the Box's URL directly, so a tailnet address works for a person on the
  tailnet. The claude.ai and ChatGPT web apps, mobile apps and Claude Desktop Connectors call from
  the vendor's servers and cannot reach a private Box; this recipe offers no way around that.
  The person's browser must reach the dashboard (`/connect`) while signing in.
- **Rotating a person's access token changes nothing; revoking them ends everything.** A person's
  connections are separate credentials from their access token. Revoking the person's access or
  deleting them ends all their connections, and restoring them later does not bring any back.
- **Rotating `auth.sessionSecret` is not "disconnect all apps".** It ends access tokens (their key
  derives from the secret); clients then refresh and carry on. To disconnect, revoke.
- **A connected client holds the person's permissions.** Including changes the person can make,
  and later role changes apply to it. A client's name is what it says about itself: only the
  publishing host of a metadata document is shown as identified, and a self-registered client is
  shown as unverified.
- **Removing the app in the vendor does not revoke it in the Box.** Revoke it in Connected apps.
- **A connection lasts 30 days, then the client signs in again.** Refresh tokens rotate on every
  use; two copies of the same client configuration (a copied config, two machines sharing a token
  store) fight over one chain, and a replay revokes the grant.
- **Pending sign-ins live in memory.** A restart, or ten minutes, drops them: the consent page says
  the request is no longer open and the person starts again in the client.
- **The redirect list is fixed.** Loopback on any port, `claude.ai` and `chatgpt.com` callbacks
  only. A client that redirects elsewhere is refused; there is no setting to add one.
- **Open registration is rate limited.** More than 5 anonymous client registrations in 10 minutes
  from one address, or 50 for the whole Box, answer 429 until the window passes. Behind a proxy
  that is not on loopback every caller shares the proxy's address, so the per-address limit is
  reached sooner.
- **Outside MCP servers are the `servers` powerup.** Its gotchas (Stripe keys, the OAuth
  redirect to upstream servers, untrusted upstream text, audit arguments) are in
  [powerups/servers/POWERUP.md](powerups/servers/POWERUP.md#gotchas).
