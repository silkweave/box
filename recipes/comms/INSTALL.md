# Adapt the Communications recipe

This is the adaptation guide for the comms recipe. Read [RECIPE.md](./RECIPE.md), [SPEC.md](./SPEC.md),
the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's docs/UPSTREAM.md, and its current
_docs/INTEGRATION.md before changing files. These recipe documents ship with core, so a Box has them
at `recipes/comms/`. The reference implementation does not: it lives in the Stack at
`features/comms/`. In a Box, run `box stack fetch --ref <recorded Stack SHA>` and read
`<fetched stack>/features/comms/`, so the documents and the code come from the same Stack revision.

The base recipe is the message store, the guardrails and the surfaces; channels are powerups:
[email](./powerups/email/POWERUP.md) (sending through Resend),
[email-inbound](./powerups/email-inbound/POWERUP.md) (receiving email; it requires email) and
[whatsapp](./powerups/whatsapp/POWERUP.md) (a linked device per agent number). Ask the
owner which to add now. The base is complete without them, but it carries no channel until one is
added, and the Comms view says so.

## Prerequisites

- Existing Box backup and a recorded restore path for both data and matching application source.
- Core and the **automation** recipe already adapted and registered in the target Box.
- No third-party packages beyond what automation and core already import (`zod`, NestJS, the UI
  library, `lucide-react`).
- A recorded source SHA in docs/UPSTREAM.md, and an integration entry with scope, target SHA,
  intended changes, and state in _docs/INTEGRATION.md.
- A disposable instance for build, typecheck, tests, schema checks, and boot verification.

## Owner decisions

Ask these together:

1. **Channels.** Which channel powerups to add now: Email, Email inbound on top of it, WhatsApp. Each
   powerup's INSTALL.md lists its own decisions (address, allowed recipients, trusted senders,
   shared mailboxes); ask those together with these.
2. **Approval limits.** `maxPendingApprovals` (default 20): held sends across channels at which a
   send refuses outright; `approvalExpiryDays` (default 7).
3. **Approval pings.** Who hears about a held send: a person, a role or a chat room (a deliver
   trigger on `<channel>.approval_requested`, below), or nobody (the Awaiting approval count in
   Comms).

## Integration

1. Copy/adapt `<fetched stack>/features/comms/` into the Box's `features/comms/{core,server,web}`.
   The base is `core/*.ts` (outside `core/email/`), `server/comms/`, and `web/` outside `web/email/`.
   Register it as the `comms` feature: `packages/core/src/generated/features.ts` (the core
   manifest), `packages/core/src/generated/exports.ts` (the core barrel),
   `apps/server/src/generated/features.ts` and `apps/web/src/generated/features.ts` (plus
   `...comms.routes` in `WEB_ROUTES`). Do not create a feature package, a symlink, or a release
   catalogue entry.
2. For each channel powerup the owner did not choose, leave its source out and remove its lines: in
   `core/index.ts` its barrel export, in `server/comms/comms.module.ts` its module import, in
   `web/channels.ts` its entry in `WEB_CHANNELS`. Each powerup's INSTALL.md lists its files.
   `core/approvals.test.ts` exercises the base through the email channel; without email, keep it
   out too.
3. Configure `box.json` (shared; no secrets):
   ```json
   "features": { "comms": { "maxPendingApprovals": 20, "approvalExpiryDays": 7 } }
   ```
   Each channel adds its own block under `features.comms` (its INSTALL.md).
4. **Approval pings** (optional, needs Automation's Alerts powerup), with `trigger-upsert`, one per channel;
   the route is the owner's choice (`user:<id>`, `chat:<room-slug>`, `owner`):
   ```json
   {
     "id": "email-approval-requested",
     "name": "Email waiting for approval",
     "enabled": true,
     "when_kind": "event",
     "event_kind": "email.approval_requested",
     "do_kind": "deliver",
     "route": "user:<admin id>",
     "message": "A message to {{fields.not_allowed}} waits for approval in Comms (requested by {{fields.sent_by}})."
   }
   ```
   The message leaves out the subject: it is written by whoever asked for the send.
5. Check that no new core export collides with another feature's by importing the source barrel at
   runtime (GOTCHAS.md): `cd apps/server && bun --conditions=@silkweave/box-source -e "await import('@silkweave/box-core')"`.
6. Preserve local customizations and write durable findings to the Box's docs/GOTCHAS.md. Update
   _docs/INTEGRATION.md as each step completes. Advance the completed upstream SHA in
   docs/UPSTREAM.md only after the full validation and boot pass.

Migrations: `comms:001` to `comms:011` (SPEC.md, Tables). On a fresh Box the tables are created on
boot in their current shape and the migrations run as no-ops. Back up the warehouse
before the first boot anyway, and before any upgrade that brings new comms migrations.

## Validation

1. Run `box verify`, then boot a disposable instance and load `/comms` and Settings > Communications. The
   `box comms-*` commands below need a CLI token: a fresh Box has none, so ask the owner to set
   `mcp.token` in `box.local.json` to an admin's token (`box auth token <admin id> --quiet`, never
   printed into the transcript). The agent session that adapted the recipe does not list the new
   `comms-*` MCP tools until it restarts; use the CLI.
2. `box comms-status`: no top-level `configProblems`; `channels` lists each added channel. With no
   channel powerup, `channels` is empty and `/comms` says no channel is added yet.
3. Each channel powerup's Verify steps prove sending, the held send and its decision end to end.
4. Record the actual commands and results. After these pass, add `comms` to the `box.json`
   `recipes` ledger, with each channel powerup under `powerups` only once its own Verify steps pass:
   `"comms": { "powerups": ["email", "email-inbound", "whatsapp"] }`.
