# `comms` - the agent's communications on every channel

The Box agent's own mailbox on each channel, plus shared team mailboxes. The base owns the message
store, the guardrails (recipient allowlist, hourly cap, held sends and their decisions), trust and
release, status, and the surfaces (MCP tools, tRPC, the Comms view and Settings > Comms). A channel
powerup owns its transport and its address rules and registers through the channel port. Every
message on every channel, in either direction, is a row of `comms_messages`.

- **dependsOn**: `automation` (events and event triggers; the `email-inbound` powerup also uses
  its webhook providers and relay).
- **Depended on by**: nothing.
- **Powerups**: [email](./powerups/email/POWERUP.md) (the Email channel, sending through Resend),
  [email-inbound](./powerups/email-inbound/POWERUP.md) (receiving email through the relay).

Without a channel powerup the feature boots, `comms-status` returns `channels: []`, and the Comms
view and Settings say no channel is added yet.

## The channel port

`registerCommsChannel` (core/channels.ts). A channel registers from its core barrel when it loads;
the base reads the registry lazily. A channel provides:

| member | what |
|---|---|
| `id`, `label` | The `channel` column, the `features.comms.<id>` key and the event kind prefix; the human name |
| `address`, `normalizePattern`, `matches` | The bare canonical address in a raw value; one allow/trust entry normalized (or null when invalid); whether an address matches the normalized entries |
| `settings()` | Identity and guardrails, parsed fresh on each call: `agentId`, `accountId`, `accountUser`, `address`, `name`, `problem`, `allowedRecipients`, `trustedSenders`, `sendsPerHour`, `sharedMailboxes`, `configProblems` |
| `sendingProblem(s)` | Why sending is off beyond the identity (a missing key, ...) |
| `sender(s)` | The From value of an outbound row |
| `compose(input, parent, s)` | Recipients, subject and threading of an outbound row; throws `CommsRefusal` on bad input |
| `deliver(row, s)` | Hands a `queued` row to the transport and returns the transport's id |
| `afterSend(row)` | Optional follow-up after `sent`; never throws |
| `bodyText(row)` | The readable body |
| `releaseOnTrust(row)` | Whether trusting a sender also releases the message it came from |
| `receivedFields(row)` | Extra fields on `<channel>.received` |
| `problems()` | Optional problems beyond settings (inbound not set up, ...), each with its fix |

The web side is `WebCommsChannel` (web/channels.ts), listed in `WEB_CHANNELS`: id, label, icon,
`matches` (as the server), an optional `Verification` component (sender checks under a message
header), optional `splitQuoted`, `verified` and `verificationLabel` (for the release warning), and
the channel's `Settings` sections.

A channel powerup adds one line each to `core/index.ts` (its barrel), `server/comms/comms.module.ts`
(its module) and `web/channels.ts` (its web module); removing it removes those lines.

## Identity

Every channel account belongs to the Box agent (`box.json` `agent`), as in chat
(recipes/chat/SPEC.md, "The host"): an account in `accounts.<channel>` whose `user` is not
`agent.id` is refused, status names the problem, and nothing is sent from it. The display name is
`agent.name`. Each channel documents its own account entry and credential.

## Settings

`box.json` `features.comms`: the top level holds what spans channels, each channel's block holds its
own lists and limits.

```json
"features": { "comms": {
  "maxPendingApprovals": 20,
  "approvalExpiryDays": 7,
  "email": { "allowedRecipients": ["*@example.com"], "trustedSenders": ["*@example.com"], "sendsPerHour": 20, "sharedMailboxes": [] }
} }
```

| key | meaning |
|---|---|
| `maxPendingApprovals` | Held sends, across channels, at which `comms-send` refuses outright. Default 20. |
| `approvalExpiryDays` | Held sends older than this become `expired`. Default 7. |
| `<channel>.allowedRecipients` | Every recipient must match, or the send is held for a person's approval in Comms. Empty means every send needs approval. |
| `<channel>.trustedSenders` | Inbound messages from these, passing the channel's sender check, are `trusted` and may wake the agent. |
| `<channel>.sendsPerHour` | Cap on queued and sent messages per channel account in the trailing hour. Default 20; 0 turns sending off. |
| `<channel>.sharedMailboxes` | Team mailboxes the channel offers (Shared mailboxes). |

The effective allowlist and trusted senders of a channel are its lists plus exact addresses a person
added in Comms ("Approve and always allow", "Trust sender"), stored in `comms_address_rules` and
merged at check time (send, decide, inbound trust). box.json entries are read-only in the UI; added
ones can be removed in Settings > Comms. Entry syntax is the channel's; an invalid entry is reported
in `configProblems`, and an invalid `allowedRecipients` entry turns that channel's sending off.

## Tables

Created on boot from the models; the manifest carries no migrations yet.

| table | pk | what it holds |
|---|---|---|
| `comms_messages` | `id` | one message: `channel`, `account` (the agent's channel account id, or `shared:<id>`), `mailbox` (the mailbox's public address at the time), `direction` (`in`/`out`), `status`, `external_id` (the transport's id), `message_id` (the protocol id other messages reference), `in_reply_to`, `references_ids`, `thread_id`, `from_addr`, `to_addrs`, `cc_addrs`, `reply_to`, `subject`, `body_text`, `body_html`, `attachments` (metadata only), `verification` (the sender checks the transport reported), `trusted`, `error`, `fetch_attempts` (inbound fetches, or outbound follow-ups), `occurred_at`, `read_at`, `sent_by`, `decided_by`, `decided_at`, `released_by`, `released_at`, timestamps |
| `comms_address_rules` | `channel`, `kind`, `pattern` | an exact address added in Comms: `kind` (`trusted_sender`/`allowed_recipient`), `added_by`, `added_at`, `source_id` (the message it came from) |

Statuses: outbound `queued` -> `sent` or `failed`, or held `pending_approval` -> `queued` (approved),
`denied` or `expired`; inbound `fetching` -> `received`, `ignored` or `failed`. Outbound ids are
UUIDs; a channel picks deterministic inbound ids so a replayed delivery is a no-op.

## Sending

`sendMessage` (core/store.ts), behind `comms-send`:

1. Resolve the channel: `channel`, or for a reply (`reply_to_id`) the parent's channel. A reply on
   another channel than its parent's, and a reply to shared-mailbox mail, are refused.
2. Refuse when sending is off (`sendingProblem`): unusable account, the channel's own problem,
   invalid allowlist, invalid or zero `sendsPerHour`. An empty allowlist is not off.
3. The channel composes the row (recipients, subject, threading). A reply to inbound mail defaults
   its recipient to the sender.
4. If any recipient is outside the effective allowlist, hold it: under the lock, refuse when
   `maxPendingApprovals` sends are already held, else insert the row as `pending_approval` (no
   transport call, not counted toward the cap) and record `<channel>.approval_requested` (fields
   `id`, `channel`, `to`, `not_allowed`, `subject`, `sent_by`). The answer is the row with a
   `notice` ("Waiting for approval in Comms: ... not in the allowed recipients"). Stop here.
5. Under an in-process lock, count the hour's sends for the channel account and insert the row as
   `queued`.
6. The channel delivers it. The row settles to `sent` with `external_id`, then `afterSend` runs; or
   to `failed` with the transport's message. A failure is a visible row, never a silent drop.

`sent_by` records the calling principal; the message always goes out as the agent account.

### Approval

`decideMessage` (core/store.ts), behind tRPC `commsDecide`:

- `approve`: under the lock, check the hourly cap at that moment (over it: refused, the row stays
  pending), set `queued` with `decided_by`, `decided_at` and `occurred_at` now, with the agent's
  current identity, then deliver.
- `approve_always`: first add each recipient outside the allowlist as an exact `allowed_recipient`
  rule, then approve.
- `deny`: `denied`, stamped. Nothing is sent.

`sent_by` stays the requester. Held sends older than `approvalExpiryDays` become `expired`, lazily
on list and status reads and on the maintenance pass (`CommsMaintenanceService`, every 60 seconds,
armed by `background.automation`). To ping people, route `<channel>.approval_requested` with a
`deliver` trigger (INSTALL.md); there is no chat or notification dependency.

### Who decides

Every decision (approve, deny, trust a sender, release, remove a rule) needs a person at a browser:
`req.credential === 'session'` and the principal is not the agent (`commsDecisionProblem`,
core/decisions.ts, a copy of chat's `chatOpNeedsApproval`). Any signed-in user may decide; there is
no admin check. A bearer token (MCP, the cli proxy, a script) is refused with 403, so an agent can
never approve its own held send or release a message to itself. These procedures are tRPC only: no
MCP tool and no CLI command.

## Trust and release

An inbound channel stores each message and records `<channel>.received` for agent-mailbox messages
(fields `id`, `channel`, `mailbox`, `from`, `subject`, the channel's `receivedFields`, `trusted`).
`trusted` is `true` only when the sender matches the effective `trustedSenders` and passes the
channel's sender check. Event triggers filter on `fields.trusted`.

People can act on untrusted agent-mailbox messages in Comms:

- **Trust sender** (tRPC `commsTrustSender`): adds the exact sender address (never a wider pattern)
  as a `trusted_sender` rule; future messages from it are trusted when they pass the sender check.
  The message it was made from is also released (as below, `released_by` the person) when the
  channel's `releaseOnTrust` says it would have been trusted on arrival. Otherwise it stays stored,
  and releasing it stays an explicit decision. Other existing rows are unchanged. Comms confirms
  which of the two happened.
- **Release to agent** (tRPC `commsRelease`): records `<channel>.received` with `trusted` `true`,
  `released` `true` and `released_by`; dedup `<id>:release:<ms>`; stamps
  `released_by`/`released_at`. The UI asks for confirmation, with a forgery warning when the sender
  check did not pass. The only human override of automatic waking.

Both refuse shared-mailbox messages and messages that are not `received`.

## Shared mailboxes

A channel may offer team mailboxes no user owns (`features.comms.<channel>.sharedMailboxes`; each
has `id`, `address`, `name`, `inbound`, `allowPeopleSend`, `allowSystemSend`). Their rows carry
`account = shared:<id>` and `mailbox` is the public address.

- Everyone reads them, in Comms and through `comms-list channel=<channel> mailbox=<id>`.
- Nothing sends from them: `comms-send` only sends as the agent and refuses a reply to shared mail.
  `allowPeopleSend` and `allowSystemSend` are parsed and default to false; they have no effect yet.
- Their messages are never trusted and record no event of any kind, so they can never wake an agent.
- A conversation stays inside its channel and mailbox: a shared thread never pulls in agent mail.

## Procedures and tools

Class-level `AuthGuard`. Reading and sending are MCP tools and tRPC procedures; decisions are tRPC only.

| MCP | tRPC | who | what |
|---|---|---|---|
| `comms-status` | `commsStatus` (query) | member | `agent`; `channels[]` (id, label, account and owner, `accountOk`/`accountProblem`, address, name, `configProblems`, `problems`, `sending` on or why not, effective `allowedRecipients` and `trustedSenders`, `lists` with each entry's source, `sendsPerHour`, `sendsLastHour`, `pendingApproval`, last received and sent, unread, `mailboxes` with unread and last received); `pendingApproval` across channels, `maxPendingApprovals`, `approvalExpiryDays`, top-level `configProblems` |
| `comms-list` | `commsList` (query) | member | `channel` (omitted: the agent mailbox of every channel), `mailbox` (`agent`, the default, or a shared mailbox id; needs `channel`), `folder` (`inbox`/`approval`/`untrusted`/`ignored`/`sent`/`all`), `thread`, `unread`, `limit` (default 50, max 500); metadata and a 160-character preview |
| `comms-read` | `commsRead` (mutation) | member | one message with its body; marks inbound messages read; inbound bodies wrapped in `<<<UNTRUSTED <CHANNEL> CONTENT ...>>>` markers (`<<<UNTRUSTED EMAIL CONTENT ...>>>` for email) with `untrusted: true` |
| `comms-thread` | `commsThread` (mutation) | member | `id`; the whole conversation, oldest first, with bodies (inbound ones in untrusted markers); marks its inbound messages read |
| `comms-send` | `commsSend` (mutation) | admin | `channel` (optional for a reply), `to[]`, `cc[]`, `subject`, `text`, `reply_to_id`; always as the agent; answers with the row including `external_id`, `sent_by` and `notice` (set when held for approval) |
| - | `commsDecide` (mutation) | person at a session | `id`, `decision` (`approve`/`approve_always`/`deny`) |
| - | `commsTrustSender` (mutation) | person at a session | `id` of a received agent-mailbox message; adds its sender |
| - | `commsRelease` (mutation) | person at a session | `id` of an untrusted agent-mailbox message; records `<channel>.received` |
| - | `commsRuleRemove` (mutation) | person at a session | `channel`, `kind`, `pattern`; removes an address added in Comms (box.json entries stay) |

A channel may add its own detail procedures (email: `commsEmailStatus`). Sending is admin-only
because it speaks for the Box to the outside world (docs/AUTH.md: the blast radius is the service
itself).

## Security

Inbound messages are untrusted text that can wake an agent holding a send tool: a path to
exfiltration or to spam in the team's name. The layers, each enforced in code or config:

1. The recipient allowlist bounds where any send can go without a person: anything outside it waits
   for a person at a browser session, which an agent's bearer token can never be. The pending cap
   bounds the queue an injected loop could build.
2. Only trusted senders passing the channel's sender check produce `trusted=true`, and the install
   trigger filters on it.
3. `sendsPerHour` bounds volume; the trigger's daily cap bounds wake-ups.
4. `comms-read`, `comms-thread` and the trigger prompt frame bodies, senders and subjects as data,
   not instructions. Shared-mailbox messages are framed the same way when an agent reads them.
5. Shared mailboxes never wake an agent: no event, never trusted.

## UI

- `/comms` (nav "Comms", order 760), laid out like a mail client. The shell sidebar lists each
  channel's mailboxes with their folders: the agent's (Inbox with its unread count, Awaiting
  approval with its count, Sent, Untrusted, Ignored), then each shared mailbox (Inbox, All
  messages), and last a Comms settings row with a health icon. The middle column lists the folder
  (sender or recipients, subject, snippet, time, unread in bold, a trusted or untrusted shield). The
  right pane shows the selected message's whole conversation, oldest first, with the channel's
  sender checks and an untrusted-content banner on inbound messages. A held send shows who is not
  allowed (highlighted in the recipients) with Approve, Approve and always allow, and Deny;
  untrusted agent messages have Trust sender and Release to agent. Shared messages carry a "never
  wakes the agent" banner. Selection is the URL: `/comms/<channel>/<mailbox>/<folder>/<id>`
  (`mailbox` is `agent` or a shared id; `/comms` lands on the first channel's agent inbox). On wide
  screens an Inbox with nothing selected opens its top message (history replaced, so Back leaves the
  folder; opening marks it read). Below the `md` breakpoint the list and the conversation stack,
  with Back, and the list is the landing view. No compose: sending is the agent's. With no channel,
  the view says so and points at the Recipe Gallery.
- Each folder's list is its own component mounted with `key={channel/mailbox/folder}`: a web data
  store's `useData` subscribes once per component, so switching stores inside one component would
  keep showing the first folder.
- Settings > Comms (order 820): Channels (which channels, the held-send queue and its limits,
  top-level problems), then each channel's own sections.

Quoted reply history is folded behind a quiet `···` toggle where the channel provides
`splitQuoted`. Display only: `comms-read` and `comms-thread` return the full body.

Both reload on the change feed's `table:comms_messages` and `table:comms_address_rules`.

## What a team customises

The channel powerups it adds, each channel's guardrail lists and limits, the approval limits, the
shared mailboxes, the agent's display name (`agent.name`), the trigger prompts, and the
untrusted-content wording in `server/comms/comms.controller.ts`.
