# Adapting the `mcp` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it
gets into a Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/mcp/`; the reference implementation lives in the
Stack at `features/mcp/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md) and
[GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with
`box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** core only. Chat rooms and automation triggers reach connections through core's
toolsets; neither imports this feature. A Box that defined servers under `agentMcp.servers` runs
the transition in INSTALL.md first.

## 2. Connect a server

1. **Pick the credential.** Prefer a key the upstream scopes to read-only and to one account (a
   Stripe agent API key with read permissions). Use OAuth when the server offers nothing else; the
   connection then acts as the administrator who signed in.
2. **Add it** in Settings > Connections: id (the tool prefix, short: `stripe`, `linear`), URL, auth.
   The owner pastes the key or clicks Connect. The agent prepares everything else and asks for
   exactly that step.
3. **Review the tools.** Every tool starts held. Turn on what the team needs, set write tools to
   `admins` or leave them off, and read each description: it is text the upstream wrote and agents
   will follow.
4. **Choose the audience.** `admins` until the team has seen the tool list; then `everyone` or a
   list of people.
5. **Grant agents** by adding the connection to a toolset (Settings > Agent tools), with `allow`
   for the read tools an unattended trigger needs.
6. **Prove it**: `box mcp-connection-check <id>`, one read call through `box <id>-<tool>`, and the
   row in `box mcp-calls`.

## 3. Customise for the team

1. **Defaults.** `rateLimit` per connection and `auditDays` in `features.mcp`. Raise the rate limit
   for a connection agents use in bulk; lower it for one with a costly upstream.
2. **Tool naming.** The prefix is the connection id. Choose ids that read well in front of the
   upstream's names (`stripe` gives `StripeStripeApiRead`; a shorter id cannot remove the upstream's
   own prefix). Changing an id later renames every tool and breaks toolset entries; treat it as a
   new connection.
3. **More upstreams.** Nothing in the feature is Stripe-specific. A server that needs a
   pre-registered OAuth client takes `oauth.clientId` in settings and `clientSecret` in
   credentials. Record anything unusual about an upstream in the Box's `docs/GOTCHAS.md`.
4. **The skill.** `features/mcp/skills/mcp/SKILL.md` tells agents how to find a connection's tools,
   read a failure message (reconnect, unreachable, rate limited) and when to ask a person instead of
   retrying. Keep its rule that agents never ask anyone for an upstream credential.

## 4. What not to change

- Do not hand a session the upstream credential (a toolset server with a token, a profile's
  `mcpServers`): the relay is what keeps the credential, the audit and the tool levels in one place.
- Do not expose passthrough tools to agent principals on `/mcp`: it would grant every connection to
  every session through the auto-approved `box` server, past its toolset.
- Do not add a second way to define a server (back in `agentMcp`, or in a feature's own settings).
