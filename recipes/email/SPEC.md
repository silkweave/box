# `email` - the agent's mailbox over Resend

The Box agent's mailbox, plus shared team mailboxes. One identity, the agent's email account, sends
and receives; shared mailboxes (e.g. finance@) only receive, are readable by everyone, and never
wake an agent. Every message in either direction is a row of `email_messages`. Sending is a plain `fetch` to Resend's API with
retry and an idempotency key. Receiving is the `inbound` powerup: Resend posts a signed webhook to
the automation relay, the Box records an event, and a worker fetches the full message afterwards.

- **dependsOn**: `automation` (webhook providers, relay config, event triggers).
- **Depended on by**: nothing.

### What it uses from automation

| what | where |
|---|---|
| `registerWebhookProvider`, `WebhookRejection`, `jsonBody`, the `WebhookProvider` and `RelayEnvelope` types | `core/inbound.ts`, `server/email/inbound.service.ts` |
| `readRelayConfig`, `relaySourceProblem`, `webhookProvider` (inbound status) | `core/inbound-fetch.ts` |
| event triggers on `email.received` (no code dependency; configured at install) | INSTALL |

## Identity

The mailbox is the agent's, as in chat (recipes/chat/SPEC.md, "The host"). It is the default
account in `box.json` `accounts.email` (or the only one):

```json
"accounts": { "email": [{ "id": "<agent.id>", "user": "<agent.id>", "login": "agent@example.com", "default": true }] }
```

- Address: the account's `login`, lowercased. Display name: `agent.name`. From header `Name <address>`.
- The account's `user` must equal `agent.id`. An account owned by a person is refused: status names
  the problem and nothing is sent from it.
- The Resend key: `credentials.email.<account id>.RESEND_API_KEY` in `box.local.json`, with the
  channel-wide `credentials.email["*"]` as fallback.

## Settings

`box.json` `features.email` holds the guardrails and the shared mailboxes:

| key | meaning |
|---|---|
| `allowedRecipients` | Every to and cc must match, or the send is held for a person's approval in Mail (Sending). Empty means every send needs approval. |
| `trustedSenders` | Inbound mail from these, with DMARC `pass`, is `trusted` and may wake the agent. |
| `sendsPerHour` | Cap on queued and sent messages per account in the trailing hour. Default 20; 0 turns sending off. |
| `maxPendingApprovals` | Held sends at which `email-send` refuses outright. Default 20. |
| `approvalExpiryDays` | Held sends older than this become `expired`. Default 7. |
| `sharedMailboxes` | Team mailboxes no user owns (Shared mailboxes). |

The effective allowlist and trusted senders are these lists plus exact addresses a person added in
Mail ("Approve and always allow", "Trust sender"), stored in `email_address_rules` and merged at
check time. box.json entries are read-only in the UI; added ones can be removed in Settings > Email.

Entries are an exact address or `*@domain` (`@domain` is accepted as an alias), matched
case-insensitively on the bare address. `*@domain` matches that domain only, not its subdomains.
Any other `*` (`*`, `*example.com`, `a*@example.com`, `*@*.example.com`) is invalid: it matches
nothing, appears in `configProblems`, and an invalid `allowedRecipients` entry turns sending off.

## Agent inbound aliases

The agent's account in `accounts.email` may carry `inbound`, like a shared mailbox:

```json
"accounts": { "email": [{ "id": "nova", "user": "nova", "login": "nova@atomic.bi", "default": true,
  "inbound": ["nova@in.atomic.bi"] }] }
```

- `login` stays the public address: the From address of every send, and the `mailbox` of every row.
- `inbound`: addresses Resend actually receives for the agent. Mail whose `received_for` names the
  login or an alias routes to the agent mailbox (same trust rules; strict DMARC). Use it when the
  domain's MX stays elsewhere (Google Workspace): a routing rule forwards `nova@atomic.bi` to
  `nova@in.atomic.bi`, a subdomain whose MX is Resend.
- Bare lowercase addresses only, deduplicated, the public address dropped. A malformed list is
  dropped whole and reported in `configProblems`. An alias another mailbox claims is refused on the
  shared mailbox side (that entry is off). `email-status` returns them as `inboundAliases`.
- Threading is by Message-ID and References, not address, so a reply that arrives through the alias
  joins its thread. Replies the agent sends go From the public address.
- DMARC: a forward keeps the sender's DKIM signature, so DMARC can still pass through DKIM
  alignment, but SPF will usually fail (the forwarder's IP is not the sender's). A sender whose DKIM
  breaks in transit (body rewriting) fails DMARC and stays untrusted.

## Shared mailboxes

```json
"sharedMailboxes": [{ "id": "finance", "address": "finance@atomic.bi", "name": "Finance",
  "inbound": ["finance@in.atomic.bi"], "allowPeopleSend": false, "allowSystemSend": false }]
```

- `id`: a lowercase slug, not `agent`. Rows carry `account = shared:<id>`; `mailbox` is the public
  `address`.
- `inbound`: the addresses Resend actually receives for it. The domain's MX can stay where it is
  (Google Workspace): a routing rule forwards `finance@atomic.bi` to `finance@in.atomic.bi`, a
  subdomain whose MX is Resend.
- Every address and alias must be a bare address, unique across mailboxes, and never the agent's.
  An entry with any problem is dropped whole and reported in `configProblems`.
- Phase 1 (this version): everyone reads them, in Mail and through `email-list mailbox=<id>`.
  Nothing sends from them: `email-send` has no mailbox parameter and refuses a reply to shared mail.
  `allowPeopleSend` (phase 2, people) and `allowSystemSend` (phase 3, Box features through a
  server-side port) are parsed and default to false; they have no effect yet.
- Shared mail is never trusted and records no event at all (Inbound).

## Tables

| table | pk | what it holds |
|---|---|---|
| `email_messages` | `id` | one message: `account` (the agent's account id, or `shared:<id>`), `mailbox` (the mailbox's public address at the time), `direction` (`in`/`out`), `status`, `resend_id`, `message_id`, `in_reply_to`, `references_ids`, `thread_id`, `from_addr`, `to_addrs`, `cc_addrs`, `reply_to`, `subject`, `body_text`, `body_html`, `attachments` (metadata only), `authentication` (`spf`/`dkim`/`dmarc`), `trusted`, `error`, `fetch_attempts` (inbound fetches, or outbound Message-ID backfills), `occurred_at`, `read_at`, `sent_by`, `decided_by`, `decided_at`, `released_by`, `released_at`, timestamps |
| `email_address_rules` | `kind`, `pattern` | an exact address added in Mail: `kind` (`trusted_sender`/`allowed_recipient`), `added_by`, `added_at`, `source_id` (the message it came from) |

Statuses: outbound `queued` -> `sent` or `failed`, or held `pending_approval` -> `queued` (approved),
`denied` or `expired`; inbound `fetching` -> `received`, `ignored` or `failed`. Outbound ids are UUIDs; inbound ids are `in-<resend email id>`, so a replayed webhook is a
no-op. `thread_id` is the root Message-ID (first `References` entry, else `In-Reply-To`, else the
message's own). Migration `email:001-sent-by` (2026-10-08) adds `sent_by` to tables created
before it replaced `actor` (GOTCHAS.md); `email:002-decisions` (2026-10-08) adds `decided_by`,
`decided_at`, `released_by`, `released_at`. `email_address_rules` is created on boot.

## Sending

`sendEmail` (core/store.ts), behind `email-send`:

1. Refuse when sending is off (`sendingProblem`): unusable account, missing key, invalid
   allowlist, invalid or zero `sendsPerHour`. An empty allowlist is not off.
2. Resolve recipients. A reply (`reply_to_id`) to inbound mail defaults `to` to its Reply-To, else
   its From, and the subject to `Re: <subject>`. A reply to shared-mailbox mail is refused.
3. If any to or cc is outside the effective allowlist, hold it: under the lock, refuse when
   `maxPendingApprovals` sends are already held, else insert the row as `pending_approval` (no
   Resend call, not counted toward the cap) and record `email.approval_requested` (fields `id`,
   `to`, `not_allowed`, `subject`, `sent_by`). The answer is the row with a `notice` ("Waiting for
   approval in Mail: ... not in the allowed recipients"). Stop here.
4. Under an in-process lock, count the hour's sends and insert the row as `queued`.
5. `POST https://api.resend.com/emails` with `Idempotency-Key: <row id>`, plus `In-Reply-To` and
   `References` (the parent's stored Message-ID) for a reply. No Message-ID header: Resend replaces
   it. Retries 429 and 5xx with backoff (honouring `Retry-After`), up to 4 attempts; other errors
   fail at once.
6. Settle the row to `sent` with `resend_id`, or `failed` with Resend's message. A failure is a
   visible row, never a silent drop.
7. Backfill `message_id` (and `thread_id` for a root send) from `GET /emails/{resend_id}`: 3 s,
   15 s and 60 s after the send, then on the maintenance pass (`EmailMaintenanceService`, armed by
   `background.automation`, and the inbound pass), at most 10 attempts per row.

`sent_by` records the calling principal; the message always goes out as the agent account.

### Approval

`decideEmail` (core/store.ts), behind tRPC `emailDecide`:

- `approve`: under the lock, check the hourly cap at that moment (over it: refused, the row stays
  pending), set `queued` with `decided_by`, `decided_at` and `occurred_at` now, then steps 5 to 7.
- `approve_always`: first add each recipient outside the allowlist as an exact `allowed_recipient`
  rule, then approve.
- `deny`: `denied`, stamped. Nothing is sent.

`sent_by` stays the requester. Held sends older than `approvalExpiryDays` become `expired`, lazily
on list and status reads and on the maintenance pass (no new timer). To ping people, route
`email.approval_requested` with a `deliver` trigger (INSTALL.md); there is no chat or notification
dependency.

### Who decides

Every decision (approve, deny, trust a sender, release, remove a rule) needs a person at a browser:
`req.credential === 'session'` and the principal is not the agent (`emailDecisionProblem`,
core/decisions.ts, a copy of chat's `chatOpNeedsApproval`). Any signed-in user may decide; there is
no admin check. A bearer token (MCP, the cli proxy, a script) is refused with 403, so an agent can
never approve its own held send or release mail to itself. These procedures are tRPC only: no MCP
tool and no CLI command.

## Inbound (powerup)

Two events, so the trigger sees a decision that needed the full message:

1. **Provider** (`RESEND_PROVIDER`, core/inbound.ts). `verify`: Svix. The key is base64 after
   `whsec_`; signed content `${svix-id}.${svix-timestamp}.${rawBody}`; HMAC-SHA256, base64;
   `svix-signature` holds space-separated `v1,<sig>` entries; constant-time compare. The timestamp
   must be within 5 minutes of the envelope's `receivedAt` (when the relay Worker took it), not the
   clock, because the relay can hold a delivery for days. `parse`: `type` must be
   `email.received`; records `<source>.email.received` with dedup key `data.email_id` and fields
   `email_id`, `from`, `to`, `subject`, `message_id` (newlines flattened).
2. **Listener** (`EmailInboundService`). On each fresh `<source>.email.received` from a source whose
   provider is `resend`, insert the row as `fetching` and start the fetch without awaiting it.
   `recordEvent` awaits its listeners, so a fetch there would hold the webhook ack.
3. **Worker** (`fetchInboundEmail`). `GET https://api.resend.com/emails/receiving/{id}` (with the
   agent account's key, for every mailbox), then route (`routeInbound`). The recipients are
   Resend's `received_for` whenever it is present, and To/Cc only when it is absent: headers are
   written by the sender, so a forward to `finance@in.atomic.bi` whose To also names the agent
   stays shared and can never reach the trust path.
   - The agent's address or an `inbound` alias on its account: the agent mailbox. The row becomes `received`, `trusted` is computed, and
     the worker records `email.received` (dedup: our id; fields `id`, `mailbox`, `from`, `subject`,
     `message_id`, `thread_id`, `trusted`, `dmarc`).
   - A shared mailbox's address or inbound alias: `account = shared:<id>`, `received`, never
     trusted, and no event of any kind (GOTCHAS.md).
   - Anything else: `ignored`, no event.
   A message for both the agent and a shared mailbox is one row, in the agent mailbox.
4. **Retry.** A failed fetch stays `fetching` with `fetch_attempts` and `error`. A pass every 60
   seconds and one at boot pick up `fetching` rows (armed by `background.relay`). After 6 attempts,
   or at once on a 4xx other than 429, the row is `failed`.

`trusted` is strict: the From header's bare address matches the effective `trustedSenders` AND
Resend's receiving server reports `authentication.dmarc === "pass"`. A missing authentication block
is untrusted; Reply-To and the envelope sender are never considered.

People can act on untrusted agent mail in Mail:

- **Trust sender** (tRPC `emailTrustSender`): adds the bare From address (never the domain) as a
  `trusted_sender` rule. Existing rows are unchanged and nothing is woken; future mail from it is
  trusted with DMARC pass.
- **Release to agent** (tRPC `emailRelease`): records `email.received` with `trusted` `true`,
  `released` `true`, `released_by` and the real `dmarc`; dedup `<id>:release:<ms>`; stamps
  `released_by`/`released_at`. The UI asks for confirmation, with a forgery warning when DMARC did
  not pass. The only human override of automatic waking.

Both refuse shared-mailbox mail.

## Procedures and tools

Class-level `AuthGuard`. Reading and sending are MCP tools and tRPC procedures; decisions are tRPC only.

| MCP | tRPC | who | what |
|---|---|---|---|
| `email-status` | `emailStatus` (query) | member | agent, account and owner, key present and its path, address, config problems, sending on or why not, effective allowlist and trusted senders (`lists` with each entry's source), hourly usage, `pendingApproval` and its limits, last activity, unread, `mailboxes` (shared: id, address, name, inbound, flags, unread, last received), inbound block (`installed`, `recorded`, `source`, `problems`, `fetching`, `failed`, `lastError`) |
| `email-list` | `emailList` (query) | member | `mailbox` (`agent`, the default, or a shared mailbox id), `folder` (`inbox`/`approval`/`untrusted`/`ignored`/`sent`/`all`), `thread`, `unread`, `limit` (max 500); metadata and a 160-character preview |
| `email-read` | `emailRead` (mutation) | member | one message with its body (text part, else HTML stripped); marks inbound mail read; inbound bodies wrapped in `<<<UNTRUSTED EMAIL CONTENT ...>>>` markers with `untrusted: true` |
| `email-thread` | `emailThread` (mutation) | member | `id`; the whole conversation, oldest first, with bodies (inbound ones in untrusted markers); marks its inbound mail read |
| `email-send` | `emailSend` (mutation) | admin | `to[]`, `cc[]`, `subject`, `text`, `reply_to_id`; always as the agent mailbox; answers with the row including `resend_id`, `sent_by` and `notice` (set when held for approval) |
| - | `emailDecide` (mutation) | person at a session | `id`, `decision` (`approve`/`approve_always`/`deny`) |
| - | `emailTrustSender` (mutation) | person at a session | `id` of received agent mail; adds its From address |
| - | `emailRelease` (mutation) | person at a session | `id` of untrusted agent mail; records `email.received` |
| - | `emailRuleRemove` (mutation) | person at a session | `kind`, `pattern`; removes an address added in Mail (box.json entries stay) |

Sending is admin-only because it speaks for the Box to the outside world (docs/AUTH.md: the blast
radius is the service itself).

## Security

Inbound mail is untrusted text that can wake an agent holding a send tool: a path to exfiltration
or to spam from the team's domain. Four layers, each enforced in code or config:

1. The recipient allowlist bounds where any send can go without a person: anything outside it waits
   for a person at a browser session, which an agent's bearer token can never be. The pending cap
   bounds the queue an injected loop could build.
2. Only trusted senders with DMARC pass produce `trusted=true`, and the install trigger filters on it.
3. `sendsPerHour` bounds volume; the trigger's daily cap bounds wake-ups.
4. `email-read` and the trigger prompt frame bodies, senders and subjects as data, not instructions.
   Shared-mailbox mail is framed the same way when an agent reads it.
5. Shared mailboxes never wake an agent: no event, never trusted, routing on the envelope only.

## UI

- `/mail` (nav "Mail"), laid out like a mail client. The shell sidebar lists each mailbox with its
  folders: the agent's (Inbox with its unread count, Awaiting approval with its count, Sent,
  Untrusted, Ignored), then each shared mailbox (Inbox, All mail), and last an Email settings row
  with a health icon. The middle column lists the folder (sender or
  recipients, subject, snippet, time, unread in bold, a trusted or untrusted shield). The right
  pane shows the selected message's whole conversation, oldest first, with SPF/DKIM/DMARC badges and
  an untrusted-content banner on inbound mail. A held send shows who is not allowed (highlighted in
  the recipients) with Approve, Approve and always allow, and Deny; untrusted agent mail has Trust
  sender and Release to agent. Shared mail shows its SPF/DKIM/DMARC badges neutrally with a note
  that forwards often fail them, and a "never wakes the agent" banner. Selection is the URL:
  `/mail/<mailbox>/<folder>/<id>` (`mailbox` is `agent` or a shared id; `/mail` lands on the agent
  inbox; the older `/mail/<folder>[/<id>]` redirects). On wide screens an Inbox with nothing
  selected opens its top message (history replaced, so Back leaves the folder; opening marks it
  read). Below the `md` breakpoint the list and the conversation stack, with Back, and the list is
  the landing view. No compose: sending is the agent's.
- Each folder's list is its own component mounted with `key={mailbox/folder}`: a web data store's
  `useData` subscribes once per component, so switching stores inside one component would keep
  showing the first folder.
- Settings > Email (order 820): Mailbox (account and owner, key, invalid settings), Sending
  (allowed recipients with their source, Remove on added ones, held sends and their limits, hourly
  usage), Inbound (each problem and its fix, trusted senders likewise), Shared mailboxes.

Quoted reply history (an "On ... wrote:" attribution, an Outlook header block, or a trailing run of
`>` lines) is hidden behind a quiet `···` toggle in the conversation view (`core/quotes.ts`,
`splitQuotedHistory`; text only, since Mail never renders HTML). Display only: `email-read` and
`email-thread` return the full body, so nothing is hidden from review of what the agent reads.

Both reload on the change feed's `table:email_messages` and `table:email_address_rules`.

## What a team customises

The guardrail lists and limits, the shared mailboxes, the agent's display name (`agent.name`), the trigger prompt, and the
untrusted-content wording in `email.controller.ts`.
