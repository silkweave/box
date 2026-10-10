# Email powerup: install

Adds the Email channel to Comms. Read [POWERUP.md](POWERUP.md), the recipe [SPEC.md](../../SPEC.md)
and [GOTCHAS.md](../../GOTCHAS.md) ("Email channel") first. Do as much as possible yourself; stop
only for the owner-only steps.

## Detect

Run `box comms-status`. A channel with `id: "email"` in `channels` means the powerup's code is in
the Box; its `accountProblem`, `configProblems` and `sending.problem` name what is still missing,
each with its fix. `box.json` `recipes.comms.powerups` lists `email` once it was verified. A Box
whose `email` channel is present but not sending needs repair, not a new install.

## Requires

- The Communications recipe, adapted and validated.

## Owner decisions

Ask these together:

1. **The address.** The agent's mailbox address on a Resend-verified domain, for example
   `nova@example.com`. The mailbox always belongs to the Box agent (`box.json` `agent`); people do
   not connect their own email.
2. **Allowed recipients.** Who the agent may write to without asking: exact addresses or
   `*@domain`. A send to anyone else waits for a person to approve it in Comms; empty means every
   send needs approval.
3. **Sends per hour.** Default 20.
4. **Inbound.** Whether to add the [Email inbound](../email-inbound/POWERUP.md) powerup too (it
   needs the automation relay powerup). If the agent's public address is on a domain whose MX stays
   elsewhere (Google Workspace), it receives through an alias (Agent inbound alias, below).
5. **Shared mailboxes.** Team mailboxes no user owns (e.g. finance@), read by everyone in Comms and
   readable by agents, never sending and never waking an agent. They arrive through Email inbound.

## Owner-only steps

Ask for each when it is needed, then wait:

1. **Resend domain.** In the Resend dashboard, add and verify the sending domain (its DNS records
   are the owner's to set).
2. **API key.** Create a Resend API key with sending access (full access if Email inbound will
   fetch received mail) and place it in `box.local.json` at
   `credentials.email.<agent.id>.RESEND_API_KEY`. Never paste it into a transcript.

## Steps

1. **Source.** Copy/adapt from `<fetched stack>/features/comms/`: `core/email/` (without
   `core/email/inbound/` unless Email inbound is added too), `server/email/` and `web/email/`.
   Register it in the comms feature: `export * from './email/index.js'` in `core/index.ts`,
   `EmailModule` in the `imports` of `server/comms/comms.module.ts`, and `EMAIL_WEB` in
   `WEB_CHANNELS` of `web/channels.ts`. Without Email inbound, also remove the
   `EmailInboundService` import and provider line from `server/email/email.module.ts`.
   `core/approvals.test.ts` exercises the base through this channel; bring it along.
2. **Configure** `box.json` (shared; no secrets):
   ```json
   "accounts": { "email": [{ "id": "<agent.id>", "user": "<agent.id>", "login": "<address>", "default": true }] },
   "features": { "comms": { "email": {
     "allowedRecipients": ["*@example.com", "partner@elsewhere.test"],
     "trustedSenders": ["*@example.com"],
     "sendsPerHour": 20,
     "sharedMailboxes": [{ "id": "finance", "address": "finance@example.com", "name": "Finance", "inbound": ["finance@in.example.com"] }]
   } } }
   ```
   `<agent.id>` is the Box's own agent id (`box.json` `agent.id`); never copy another Box's.
   `trustedSenders` and `sharedMailboxes` matter only with Email inbound.
3. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md` and the session in
   `_docs/INTEGRATION.md`. No secret goes in either.

### Identity and settings

- Address: the account's `login`, lowercased. Display name: `agent.name`. From header
  `Name <address>`. With several `accounts.email` entries, exactly one is `"default": true`.
- The account's `user` must equal `agent.id`; an account owned by a person is refused.
- The Resend key: `credentials.email.<account id>.RESEND_API_KEY`, with the channel-wide
  `credentials.email["*"]` as fallback. tRPC `commsEmailStatus` reports `keyPresent` and `keyPath`.
- Allow and trust entries are an exact address or `*@domain` (`@domain` is accepted as an alias),
  matched case-insensitively on the bare address. `*@domain` matches that domain only, not its
  subdomains. Any other `*` (`*`, `*example.com`, `a*@example.com`, `*@*.example.com`) is invalid:
  it matches nothing, appears in `configProblems`, and an invalid `allowedRecipients` entry turns
  sending off.

### Agent inbound alias

The agent's account may carry `inbound`: addresses Resend actually receives for the agent.

```json
"accounts": { "email": [{ "id": "nova", "user": "nova", "login": "nova@example.com", "default": true,
  "inbound": ["nova@in.example.com"] }] }
```

- `login` stays the public address: the From address of every send, and the `mailbox` of every row.
  Mail whose envelope recipient is the login or an alias routes to the agent mailbox, under the same
  trust rules.
- Bare lowercase addresses only, deduplicated, the public address dropped. A malformed list is
  dropped whole and reported in `configProblems`. An alias a shared mailbox also claims is refused on
  the shared mailbox side (that entry is off). `commsEmailStatus` returns them as `inboundAliases`.
- Threading is by Message-ID and References, not address, so a reply that arrives through the alias
  joins its thread.
- The receiving subdomain and the forward are set up in Email inbound's INSTALL.md.

### Shared mailboxes

```json
"sharedMailboxes": [{ "id": "finance", "address": "finance@example.com", "name": "Finance",
  "inbound": ["finance@in.example.com"], "allowPeopleSend": false, "allowSystemSend": false }]
```

- `id`: a lowercase slug, not `agent`. Rows carry `account = shared:<id>`; `mailbox` is the public
  `address`.
- `inbound`: the addresses Resend actually receives for it (forward targets); the domain's MX can
  stay where it is.
- Every address and alias must be a bare address, unique across mailboxes, and never the agent's.
  An entry with any problem is dropped whole and reported in `configProblems`.
- `allowPeopleSend` and `allowSystemSend` are parsed and default to false; they have no effect yet.

### Sending detail

- `POST https://api.resend.com/emails` with `Idempotency-Key: <row id>`, plus `In-Reply-To` and
  `References` (the parent's stored Message-ID, up to 20 references) for a reply. No Message-ID
  header. Retries 429 and 5xx with backoff (honouring `Retry-After`), up to 4 attempts; other
  errors fail at once with Resend's message.
- A reply to received mail defaults `to` to its Reply-To, else its From.
- Message-ID backfill from `GET /emails/{external_id}`: 3 s, 15 s and 60 s after the send, then on
  the maintenance pass (`EmailMaintenanceService`, every 60 seconds, armed by
  `background.automation`, and Email inbound's fetch pass), at most 10 attempts per row.

## Verify

1. Run `box verify`, then boot a disposable instance and load `/comms` and Settings > Comms.
2. `box comms-status`: the `email` channel has `accountOk: true`, `sending.on: true`, no
   `configProblems`; Settings > Comms > Email mailbox shows the Resend API key set.
3. Approval: `box comms-send --channel email` to an address outside `allowedRecipients` answers
   with `status: "pending_approval"` and a `notice`, and sends nothing. In Comms > Awaiting
   approval, a person at a browser denies it (`denied`). The same decision through an API token is
   refused (403).
4. A real send, with the owner's go-ahead on the recipient: `box comms-send --channel email` to one
   allowed address. The answer has `status: "sent"`; the owner confirms the mail arrived with the
   agent's display name and address; it appears under Comms > Email > Sent, and within a minute the
   row has a `message_id`.
5. Record the actual commands and results. After these pass, add `email` to
   `recipes.comms.powerups` in `box.json`.

## Remove

1. Delete any `email.approval_requested` and `email.received` triggers; remove Email inbound first
   if it is added.
2. Remove the three registration lines (core barrel, `EmailModule`, `EMAIL_WEB`) and delete
   `core/email/`, `server/email/` and `web/email/` (and `core/approvals.test.ts`, or rewrite it
   against another channel).
3. Remove `email` from `recipes.comms.powerups`. Stored messages stay in `comms_messages`;
   `accounts.email`, `features.comms.email` and the key stay unless the owner removes them.
