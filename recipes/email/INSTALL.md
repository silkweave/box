# Adapt the email recipe

This is the adaptation guide for the email recipe. Read [RECIPE.md](./RECIPE.md), [SPEC.md](./SPEC.md),
the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's docs/UPSTREAM.md, and its current
_docs/INTEGRATION.md before changing files. These recipe documents ship with core, so a Box has them
at `recipes/email/`. The reference implementation does not: it lives in the Stack at
`features/email/`. In a Box, run `box stack fetch --ref <recorded Stack SHA>` and read
`<fetched stack>/features/email/`, so the documents and the code come from the same Stack revision.

The recipe has one powerup, [inbound](./powerups/inbound/POWERUP.md). Ask the owner whether to add
it now; the base recipe is complete without it and it can be added later.

## Prerequisites

- Existing Box backup and a recorded restore path for both data and matching application source.
- Core and the **automation** recipe already adapted and registered in the target Box.
- No third-party packages beyond what automation and core already import (`zod`, NestJS, the UI library).
- A recorded source SHA in docs/UPSTREAM.md, and an integration entry with scope, target SHA,
  intended changes, and state in _docs/INTEGRATION.md.
- A disposable instance for build, typecheck, tests, schema checks, and boot verification.

## Owner decisions

Ask these together:

1. **The address.** The agent's mailbox address on a Resend-verified domain, for example
   `nova@example.com`. The mailbox always belongs to the Box agent (`box.json` `agent`); people do
   not connect their own email.
2. **Allowed recipients.** Who the agent may write to without asking: exact addresses or
   `*@domain`. A send to anyone else waits for a person to approve it in Mail; empty means every
   send needs approval.
3. **Sends per hour.** Default 20. Also the approval limits: `maxPendingApprovals` (default 20) and
   `approvalExpiryDays` (default 7).
4. **Inbound.** Whether to add the inbound powerup now (it needs the automation relay powerup).
   If the agent's public address is on a domain whose MX stays elsewhere (Google Workspace), add
   `"inbound": ["<agent>@in.example.com"]` to the agent's `accounts.email` entry and forward the
   public address to it; see the inbound powerup INSTALL.md "Agent alias".
5. **Shared mailboxes.** Team mailboxes no user owns (e.g. finance@), read by everyone in Mail and
   readable by agents, never sending and never waking an agent. They need the inbound powerup;
   see its INSTALL.md "Shared mailboxes" for the routing.
6. **Approval pings.** Who hears about a held send: a person, a role or a chat room (a deliver
   trigger on `email.approval_requested`, below), or nobody (the Awaiting approval count in Mail).

## Owner-only steps

Ask for each when it is needed, then wait:

1. **Resend domain.** In the Resend dashboard, add and verify the sending domain (its DNS records
   are the owner's to set).
2. **API key.** Create a Resend API key with sending access (full access if the inbound powerup will
   fetch received mail) and place it in `box.local.json` at
   `credentials.email.<agent.id>.RESEND_API_KEY`. Never paste it into a transcript.

## Integration

1. Copy/adapt `<fetched stack>/features/email/` into the Box's `features/email/{core,server,web}`.
   Register the result as the `email` feature: `packages/core/src/generated/features.ts` (the core
   manifest), `packages/core/src/generated/exports.ts` (the core barrel),
   `apps/server/src/generated/features.ts` and `apps/web/src/generated/features.ts` (plus
   `...email.routes` in `WEB_ROUTES`). Do not create a feature package, a symlink, or a release
   catalogue entry.
2. Without the inbound powerup, remove the `EmailInboundService` line from
   `features/email/server/email/email.module.ts`; keep `core/inbound.ts` and
   `core/inbound-fetch.ts`, which `email-status` uses to report inbound as absent.
3. Configure `box.json` (shared; no secrets):
   ```json
   "accounts": { "email": [{ "id": "<agent.id>", "user": "<agent.id>", "login": "<address>", "default": true }] },
   "features": { "email": {
     "allowedRecipients": ["*@example.com", "partner@elsewhere.test"],
     "trustedSenders": ["*@example.com"],
     "sendsPerHour": 20,
     "maxPendingApprovals": 20,
     "approvalExpiryDays": 7,
     "sharedMailboxes": [{ "id": "finance", "address": "finance@example.com", "name": "Finance", "inbound": ["finance@in.example.com"] }]
   } }
   ```
   `<agent.id>` is the Box's own agent id (`box.json` `agent.id`); never copy another Box's.
   `trustedSenders` and `sharedMailboxes` matter only with the inbound powerup.
4. **Approval pings** (optional, needs the alerts recipe), with `trigger-upsert`; the route is the
   owner's choice (`user:<id>`, `chat:<room-slug>`, `owner`):
   ```json
   {
     "id": "email-approval-requested",
     "name": "Email waiting for approval",
     "enabled": true,
     "when_kind": "event",
     "event_kind": "email.approval_requested",
     "do_kind": "deliver",
     "route": "user:<admin id>",
     "message": "An email to {{fields.not_allowed}} waits for approval in Mail (requested by {{fields.sent_by}})."
   }
   ```
   The message leaves out the subject: it is written by whoever asked for the send.
5. Check that no new core export collides with another feature's by importing the source barrel at
   runtime (GOTCHAS.md): `cd apps/server && bun --conditions=@silkweave/box-source -e "await import('@silkweave/box-core')"`.
6. Preserve local customizations and write durable findings to the Box's docs/GOTCHAS.md. Update
   _docs/INTEGRATION.md as each step completes. Advance the completed upstream SHA in
   docs/UPSTREAM.md only after the full validation and boot pass.

Migrations: `email:001-sent-by` and `email:002-decisions` (columns only, `ADD COLUMN IF NOT
EXISTS`). Back up the warehouse before the first boot that applies them. `email_address_rules` is a
new table, created on boot.

## Validation

1. Run `box verify`, then boot a disposable instance and load `/mail` and Settings > Email.
   The `box email-*` commands below need a CLI token: a fresh Box has none, so ask the owner to set
   `mcp.token` in `box.local.json` to an admin's token (`box auth token <admin id> --quiet`, never
   printed into the transcript). The agent session that adapted the recipe does not list the new
   `email-*` MCP tools until it restarts; use the CLI.
2. `box email-status`: `accountOk: true`, `keyPresent: true`, `sending.on: true`, no `configProblems`.
3. Approval: `box email-send` to an address outside `allowedRecipients` answers with `status:
   "pending_approval"` and a `notice`, and sends nothing. In Mail > Awaiting approval, a person at a
   browser denies it (`denied`). The same decision through an API token is refused (403).
4. A real send, with the owner's go-ahead on the recipient: `box email-send` to one allowed
   address. The answer has `status: "sent"`; the owner confirms the mail arrived with the agent's
   display name and address; it appears under Mail > Sent.
5. Record the actual commands and results. After these pass, add `email` to the `box.json`
   `recipes` ledger (with `inbound` under `powerups` only once that powerup is verified too).
