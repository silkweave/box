# MCP sign-in

People connect their own AI clients (Claude Code, Codex, Cursor, VS Code and others) to the Box with the Box's URL alone: they approve the connection in their signed-in browser, and the client gets tokens that act as that person, with that person's role and permissions.

## Highlights

- One URL, no token to copy and no config file to edit: the client finds the sign-in itself, the person clicks Allow in their Box session
- The client acts as the person who approved it: same role, areas, row security and role-filtered tool list as a Box access token, and it follows later role changes
- Connected apps in Settings > Profile (your own) and in the Users detail (an administrator's view), each with the browser it was approved in, when it connected, when it was last used, when it must reconnect, and Revoke
- `box auth connections` lists and revokes from the shell; `box auth connections log` shows the audit trail (consents, connections, refreshes, revokes)
- Connect an AI client in Settings > Profile gives the MCP URL and a copy-ready command for Claude Code and Codex
- Access tokens last one hour; a connection lasts 30 days, then the client signs in again
- Revoking a person or deleting them ends all their connections; rotating a person's access token does not
- A Box without this recipe keeps working with access tokens on `/mcp`, exactly as before
- Powerup `servers` (MCP Servers): outside MCP servers (Stripe and others) connected once by an administrator and shared through the Box

## Personal data

Each connection is recorded as a grant: the person, the client (its name and the address of its metadata document, or the id it registered under), the browser it was approved in, when it was approved, connected and last used (to the minute), when it expires, and, once ended, when, why and by whom. An audit trail of registrations, consents, connections, refreshes and revokes, with the caller's address, is kept 90 days. Registered clients are stored with their declared name and redirect addresses. Refresh tokens are kept only as SHA-256 hashes. Internal users only; nothing is public. The `servers` powerup adds its own call audit log (see [its POWERUP.md](powerups/servers/POWERUP.md#audit)). See [SPEC.md](SPEC.md#data).
