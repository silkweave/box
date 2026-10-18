# mcp gotchas

The feature id (`mcp`, the same as the recipe id) is part of runtime registration and settings
keys. Keep it stable. Record any local exception in the Box's `docs/GOTCHAS.md` and leave current
operation state in `_docs/INTEGRATION.md`.

- **`features.mcp` is not core's `mcp`.** Core's `mcp.url` and `mcp.token` configure the `box`
  CLI's connection to this Box. Connections live under `features.mcp.connections`; their secrets
  under `credentials.mcp.<id>`.
- **The redirect URI is `server.dashboardUrl`.** OAuth 2.1 servers refuse plain-http redirect URIs
  that are not loopback, so a Box reached at `http://box.tailnet:8190` cannot complete OAuth. Serve
  it over https (`tailscale serve` gives a `ts.net` certificate) and set `dashboardUrl` to that
  address before connecting. Changing `dashboardUrl` later needs a reconnect (and, with Dynamic
  Client Registration, a fresh registration). Keys are unaffected.
- **The OAuth session belongs to the admin who clicked Connect.** Upstream it is that person's
  grant: if they leave the upstream team or lose the role, the connection drops to `reauth`. For a
  team connection that should outlive a person, prefer a service key.
- **Authorization server metadata can sit at the path-inserted URL.** Stripe's issuer
  `https://access.stripe.com/mcp` publishes its metadata at
  `https://access.stripe.com/.well-known/oauth-authorization-server/mcp`, not under `/mcp/`.
  Discovery tries the RFC 8414 form first.
- **Stripe keys.** From 2026-12 Stripe MCP accepts only agent API keys (the "Agent" badge) and
  OAuth; full secret keys and other restricted keys answer 401. Most of Stripe is behind two tools,
  `stripe_api_read` and `stripe_api_write`, so the key's own permissions, not the tool list, are
  the fine-grained limit. Stripe asks a human to confirm some writes (refunds, outbound payments)
  through a URL in the tool result; that person approves as the connection's identity.
- **Clients cache tool lists.** A tool turned on, or a new connection, appears in a person's Claude
  or Codex only after the client reconnects, and in an agent session only from its next session.
  Use `box <id>-<tool>` to test in the meantime.
- **A session's shell can reach `/mcp` as its principal.** Sessions get passthrough tools only by
  toolset, but a session allowed to run shell commands can read its principal's Box token and call
  `/mcp` directly, getting what that person could. Toolsets for runs that read outside content
  should deny `Bash`, as docs/AGENT-TOOLS.md already says.
- **Upstream text is untrusted.** Tool descriptions and results come from outside the Box. Held
  tools and the changed-description flag exist so a new or rewritten tool is read by a person before
  agents follow it.
- **The audit log holds call arguments.** They can name an upstream's customers. Keep `auditDays`
  short enough for the team's data rules, and include the table in backups like other personal data.
