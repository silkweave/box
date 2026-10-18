# MCP connections

Connect an outside MCP server such as Stripe to the Box once, signed in by an administrator, and every person and agent the team allows can use its tools through the Box, without anyone holding the credential themselves.

## Highlights

- One administrator connects a server once: OAuth sign-in in Settings, or a restricted key where the server offers one
- The server's tools appear on the Box's own MCP endpoint, so people's Claude and Codex clients and the box CLI get them with no new setup
- Chat rooms and agent triggers grant a connection through the existing toolsets, with their allow and deny lists and approvals
- Per-tool levels (on, admins only, off), new upstream tools held until an administrator reviews them, and a per-person rate limit
- Every call recorded in an audit log with who made it, through which surface, and how it ended

## Personal data

The audit log keeps the principal, the tool and the call's arguments (truncated), which can name an
outside system's customers. Tool results pass through and are not stored. Internal users only;
nothing is public. See [SPEC.md](SPEC.md#audit).
