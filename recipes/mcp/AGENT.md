# Adapting the `mcp` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it
gets into a Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/mcp/`; the reference implementation is fetched from
the recipe registry as `features/mcp/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md) and
[GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with
`box recipe fetch mcp`.

**Builds on:** core only. Core owns the consent page, Connected apps and `box auth connections`;
the recipe supplies the OAuth server and grant store through `ServerFeature.mcpAuth`. Ask the owner
which powerups to add (`servers` now; `desktop-extension` and `public-endpoint` are planned).

## 2. Help a person connect

1. **Check the address first.** `box auth connections` prints the MCP URL, or says it is not offered.
   Fix `server.dashboardUrl` (https) with the owner before anything else.
2. **Point them at Settings > Profile > Connect an AI client.** It shows the URL and the commands
   for Claude Code (`claude mcp add --transport http <name> <url>`, then `/mcp` and Authenticate)
   and Codex (`codex mcp add <name> --url <url>`). Other clients take the URL as a streamable HTTP
   server and find the sign-in themselves.
3. **The person approves in their own browser.** Never approve on someone's behalf and never mint
   or paste a token for this: that is the access-token path, kept for scripts and the CLI.
4. **Prove it**: the client lists the Box's tools, and Connected apps shows the connection.

## 3. Read problems

| Symptom | Likely cause | What to do |
|---|---|---|
| The client cannot find a sign-in | address not offered (plain http, not localhost), or the recipe is not adapted | `box auth connections`; set an https `server.dashboardUrl` |
| `/connect` says the request is no longer open | answered, older than 10 minutes, or the Box restarted | start the connection again in the client |
| Everyone was disconnected | the MCP URL changed (`url_changed`) | everyone connects again; expected |
| One person was disconnected | their access was revoked (`user_revoked`), they revoked it, or the refresh chain reached 30 days | connect again; check `box auth connections <user-id>` |
| A client stopped after working | replay of a rotated refresh token (the grant is revoked) or an hour-old token with no refresh | connect again; two copies of one client config share one chain |
| Tools missing for a connected client | the person's role or areas do not include them | same as with an access token: `AccessExplain` |

## 4. Revoke

Use Connected apps (Profile, or Users for an administrator) or `box auth connections revoke
<grant-id>` and `revoke-all <user-id>`. Rotating a person's access token or the session secret is
not a revoke (SPEC.md, "Revocation"). Tell the person that removing the app inside the vendor's own
settings does not revoke it in the Box.

## 5. What not to change

- Do not accept OAuth tokens on any route but `/mcp`: core's single resolver keeps REST, tRPC and
  path mounts on access tokens.
- Do not widen the redirect list or the audience, derive the MCP URL from a request, or add a
  setting for either: the fixed list and the config-built URL are the safety.
- Do not take the person from anything a client sends: the grant belongs to the consenting session.
- Do not let an agent principal connect or approve: sign-in is for people.

The `servers` powerup has its own agent notes
([powerups/servers/POWERUP.md](powerups/servers/POWERUP.md#adding-and-using-a-server)).
