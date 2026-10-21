# `comms` - the agents' communications on every channel

One mailbox per agent account on each channel, plus shared team mailboxes. The base owns the message
store, the guardrails (recipient allowlist, hourly cap, held sends and their decisions), trust and
release, status, and the surfaces (MCP tools, tRPC, the Comms view and Settings > Communications). A channel
powerup owns its transport and its address rules and registers through the channel port. Every
message on every channel, in either direction, is a row of `comms_messages`.

- **dependsOn**: `automation` (events and event triggers; the `email-inbound` powerup also uses
  its webhook providers and relay).
- **Depended on by**: nothing.
- **Powerups**: [email](./powerups/email/POWERUP.md) (the Email channel, sending through Resend),
  [email-inbound](./powerups/email-inbound/POWERUP.md) (receiving email through the relay),
  [whatsapp](./powerups/whatsapp/POWERUP.md) (the WhatsApp channel: a linked device per agent
  number, every chat stored, groups handled by one agent, and people's own business numbers).

Without a channel powerup the feature boots, `comms-status` returns `channels: []`, and the Comms
view and Settings say no channel is added yet.

## The channel port

`registerCommsChannel` (core/channels.ts). A channel registers from its core barrel when it loads;
the base reads the registry lazily. A channel provides:

| member | what |
|---|---|
| `id`, `label` | The `channel` column, the `features.comms.<id>` key and the event kind prefix; the human name |
| `address`, `normalizePattern`, `matches` | The bare canonical address in a raw value; one allow/trust entry normalized (or null when invalid); whether an address matches the normalized entries |
| `settings()` | The channel-wide guardrails, parsed fresh on each call: `allowedRecipients`, `trustedSenders`, `sendsPerHour`, `sendPolicy`, `stopWords`, `sharedMailboxes`, `configProblems` |
| `accounts()` | The channel's accounts (Accounts), read fresh with each owner judged now |
| `accountsSource?` | Where the accounts come from, named in the "no account" problem (default `box.json accounts.<id>`; WhatsApp: pairing in Settings) |
| `sendingProblem(s, account)` | Why this account cannot send beyond its owner (a missing key, ...) |
| `sender(account)` | The From value of an outbound row from the account |
| `compose(input, parent, s, account)` | Recipients, subject and threading of an outbound row; throws `CommsRefusal` on bad input |
| `admit(row, s, account)` | Optional: why this row may not go out now (checked on compose and under the send lock) |
| `deliver(row, s, account)` | Hands a `queued` row to the transport as the account and returns the transport's id |
| `afterSend(row)` | Optional follow-up after `sent`; never throws |
| `bodyText(row)` | The readable body |
| `releaseOnTrust(row)` | Whether trusting a sender also releases the message it came from |
| `receivedFields(row)` | Extra fields on `<channel>.received` |
| `problems()` | Optional problems beyond settings (inbound not set up, ...), each with its fix |

The web side is `WebCommsChannel` (web/channels.ts), listed in `WEB_CHANNELS`: id, label, icon,
`matches` (as the server), an optional `Verification` component (sender checks under a message
header), optional `splitQuoted`, `verified` and `verificationLabel` (for the release warning),
optional `MessageView` (how a message shows in a conversation), `Members` (who is in a
conversation, in its header), `Picture` (a chat's or
person's picture), `mentionOptions` (who a reply can `@` mention), `UserPanel` (the channel's section
on a user's page in Settings > Users) and `groups` (whether the channel has group chats), the
channel's `Settings` page and its own settings `pages`.

A channel powerup adds one line each to `core/index.ts` (its barrel), `server/comms/comms.module.ts`
(its module) and `web/channels.ts` (its web module); removing it removes those lines.

## Accounts

An account is a mailbox on one channel owned by one agent, or by a person where the channel offers
people's own accounts (People's own accounts) (core/accounts.ts, `CommsAccount`: `id`, `owner`,
`ownerKind`, `address`, `name`, `problem`). Its `id` is the mailbox key stored in
`comms_messages.account`. No account is special, and an owner has at most one account per channel.
Entries in `accounts.<channel>` (`id`, `user` = the owner, `login` = the address) are validated with
one rule set; an entry with a bad id, a missing owner, an invalid login, or an id, owner or address
used twice is dropped whole and reported in `configProblems`. The display name is the owner's.

The owner's eligibility is the agent predicate (docs/AUTH.md), judged at call time. An account
whose owner is a retired agent, or not an agent at all, carries a `problem`: its mail is still
stored in its mailbox, but it sends nothing and its mail never records `<channel>.received`. A
channel with people's own accounts judges a person's account by an active human user instead. Only
an agent's account records `<channel>.received` (`accountWakes`). Each channel documents its own
account entry and credential.

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
| `<channel>.trustedSenders` | Inbound messages from these, passing the channel's sender check, are `trusted` and may wake the account's agent. |
| `<channel>.sendsPerHour` | Cap on queued and sent messages per account in the trailing hour. Default 20 (WhatsApp 10); 0 turns sending off. |
| `<channel>.sendPolicy` | `allowlist` (an agent send outside `allowedRecipients` is held) or `approve-all` (every agent send is held). Default `allowlist` (WhatsApp `approve-all`). A person's own reply is never held. |
| `<channel>.stopWords` | An inbound message that is exactly one of these (case-insensitive) opts its sender out. Only one-to-one conversations count: a group send addresses the group, so a stop word in a group opts nobody out (unmanage the chat to stop answering it). Default `STOP`, `UNSUBSCRIBE`. |
| `<channel>.sharedMailboxes` | Team mailboxes the channel offers (Shared mailboxes). |

The effective allowlist and trusted senders of a channel are its lists plus exact addresses a person
added in Comms ("Approve and always allow", "Trust sender"), stored in `comms_address_rules` and
merged at check time (send, decide, inbound trust). box.json entries are read-only in the UI; added
ones can be removed in Settings > Communications. Entry syntax is the channel's; an invalid entry is reported
in `configProblems`, and an invalid `allowedRecipients` entry turns that channel's sending off.

## Tables

Created on boot from the models. The manifest's migrations `comms:001` to `comms:011` bring older
instances to the current shape: 001-006 add `conversation_id`, `kind`, `media`, `meta`,
`edited_by` and `seq` to `comms_messages`, 007-009 backfill conversations for existing email,
010 adds `handler`, and 011 keys each conversation by its account and makes each group one Box
conversation (ids recomputed and carried through messages and favourites).

| table | pk | what it holds |
|---|---|---|
| `comms_messages` | `id` | one message: `channel`, `account` (the account id, `shared:<id>`, or empty for mail no mailbox has), `mailbox` (the mailbox's public address at the time), `direction` (`in`/`out`), `status`, `external_id` (the transport's id), `message_id` (the protocol id other messages reference), `in_reply_to`, `references_ids`, `thread_id`, `from_addr`, `to_addrs`, `cc_addrs`, `reply_to`, `subject`, `body_text`, `body_html`, `attachments` (metadata only), `verification` (the sender checks the transport reported), `trusted`, `error`, `fetch_attempts` (inbound fetches, or outbound follow-ups), `occurred_at`, `read_at`, `sent_by`, `decided_by`, `decided_at`, `released_by`, `released_at`, `conversation_id`, `kind` (`text` or the channel's media kind), `media` (stored media items), `meta` (channel detail: sender role, mentions, format, draft recommendation, completion marks), `edited_by` (who edited a held draft), `seq` (order within a conversation), timestamps |
| `comms_conversations` | `id` | one email thread or chat in one mailbox: `id` = `conversationKey(channel, scope, peer)`, `scope` (the account id, `shared:<id>`, or `group`: a group chat is one conversation for the whole Box, whichever of our accounts stored its messages), `handler` (the agent that answers a group, whose inbox shows it, changeable among our agents in the group; null when nobody handles it, and for every other conversation), `peer` (thread root or chat JID), `kind` (`direct`/`group`), `title`, `participants`, `contact_id`, `crm_account_id`, `status` (`open`/`waiting`/`done`), `assignee`, `delegated_by`, `delegated_at`, `delegate_job`, timestamps |
| `comms_address_rules` | `channel`, `kind`, `pattern` | an exact address added in Comms: `kind` (`trusted_sender`/`allowed_recipient`), `added_by`, `added_at`, `source_id` (the message it came from) |
| `comms_optouts` | `channel`, `address` | an address never messaged again, by anyone: `reason` (`stop_word`/`manual`), `source_id`, `added_by`, `added_at` |
| `comms_favorites` | `user_id`, `conversation_id` | a person's starred conversation, `added_at` |

Statuses: outbound `queued` -> `sent` or `failed`, or held `pending_approval` -> `queued` (approved),
`denied` or `expired`; inbound `fetching` -> `received`, `ignored` or `failed`. Outbound ids are
UUIDs; a channel picks deterministic inbound ids so a replayed delivery is a no-op.

## Sending

`sendMessage` (core/store.ts), behind `comms-send`:

1. Resolve the channel: `channel`, or for a reply (`reply_to_id`) the parent's channel. A reply on
   another channel than its parent's, and a reply to shared-mailbox mail, are refused.
2. Resolve the account it goes out from: a reply's parent's account (in a group, a reply to one of
   our own messages goes out from the group's handler); else `from`; else the
   calling agent's own account; else the channel's only account. With several and none named, the
   send is refused and lists them. An agent sends only from its own account; a person may name any.
3. Refuse when sending from it is off (`sendingProblem`): the account's `problem`, the channel's
   own problem for it, invalid allowlist, invalid or zero `sendsPerHour`. An empty allowlist is not
   off.
4. The channel composes the row (recipients, subject, threading). A reply to inbound mail defaults
   its recipient to the sender.
5. If any recipient is outside the effective allowlist, hold it: under the lock, refuse when
   `maxPendingApprovals` sends are already held, else insert the row as `pending_approval` (no
   transport call, not counted toward the cap) and record `<channel>.approval_requested` (fields
   `id`, `channel`, `to`, `not_allowed`, `subject`, `sent_by`). The answer is the row with a
   `notice` ("Waiting for approval in Comms: ... not in the allowed recipients"). Stop here.
6. Under an in-process lock, count the hour's sends for the account and insert the row as
   `queued`.
7. The channel delivers it. The row settles to `sent` with `external_id`, then `afterSend` runs; or
   to `failed` with the transport's message. A failure is a visible row, never a silent drop.

`sent_by` records the calling principal; the message goes out from the resolved account.

### Group handler

A WhatsApp group is one conversation for the Box, whichever of our numbers stores it. It is
handled when an agent of ours is its `handler`. Every inbound group message belongs to the handler
(`comms_messages.account`), whoever it `@`-mentions, so the row is the same whichever of our
connections stores it; with no handler it belongs to the connection that stored it. Everything follows the
handler: `whatsapp.received` carries it as `agent` and `account`, a reply goes out from its number,
and delegate drafts as it. Mentions are stored readable on every connection (each records its own
number's LID in `link.json`). A team member's group message waits on the client and records no
event unless it mentions the handler: then it is a request to the handler, opens the conversation and wakes it. A message
one of our numbers writes never wakes anyone. The handler is set by a person in Settings >
Communications > WhatsApp > Groups ("Handled by"; tRPC `commsWhatsappHandler`), among our agents
whose numbers WhatsApp lists in the group now, or cleared: a group without a handler is stored
for the team and wakes nobody.

### Settle window

A client often asks over several messages, so a chat channel that declares `settle` (WhatsApp:
`features.comms.whatsapp.settle`, `quietSeconds` 90 and `capSeconds` 300 by default, 0 turns it
off) hands them to an agent together. Every message that records `<channel>.received` is marked
`meta.woke` and opens or extends its conversation's window. The window is never stored: it is the
inbound `woke` rows after the conversation's last answer, where an answer is a send of ours that
went out (`queued`, `sent`, `delivered`, `read`; a held draft is not one) or a team member's
message that wakes nobody. It closes when the newest of them (or the newest typing, WhatsApp
presence `composing`) is `quietSeconds` old, and at the latest `capSeconds` after the first. Then
comms records `comms.conversation.settled` (dedup `<conversation_id>:<newest message id>`, so each
window settles once) with `conversation_id`, `channel`, `kind`, `account` and `agent` (the newest
message's mailbox and its owner: a group's handler), `crm_account_id`, `messages` (the unanswered
ids, oldest first, comma-separated), `count`, `from`, `trusted` (`true` only when every one is) and
`first_at`/`last_at`. An answer before the window closes records nothing.

The server holds the timers (`server/comms/settle.service.ts`) and re-arms windows with a waking
message from the last hour at boot, firing overdue ones at once. An auto-draft is an agent trigger
on that event: toolset `comms-draft` (a feature-built-in toolset: the Delegate tools only) and
concurrency key `{{fields.conversation_id}}`, so conversations draft side by side and a window that
settles while its conversation's draft still runs waits and redrafts once; the newer draft replaces
the waiting one.

### Approval

`decideMessage` (core/store.ts), behind tRPC `commsDecide`:

- `approve`: under the lock, check the hourly cap at that moment (over it: refused, the row stays
  pending), set `queued` with `decided_by`, `decided_at` and `occurred_at` now, from the account it
  was written for as that account is now (gone or unable to send: it stays held), then deliver.
- `approve_always`: first add each recipient outside the allowlist as an exact `allowed_recipient`
  rule, then approve.
- `deny`: `denied`, stamped. Nothing is sent. The conversation view leaves denied and expired
  sends out of the thread; the row and its events stay.
- `close` (optional, with any approval): the conversation is closed once the send goes out. A
  draft carries its writer's recommendation (`comms-draft` `close`, stored as `meta.closeAfterSend`,
  read as `close_after_send`); the approval card preselects "Close after sending" from it.

A `comms-draft` replaces its writer's own draft that still waits in the same conversation (same
row id, new text, recipients and recommendation; no second `approval_requested`), so a person
decides one current reply. Once that draft is decided, the next one is a new held send.

`sent_by` stays the requester. Held sends older than `approvalExpiryDays` become `expired`, lazily
on list and status reads and on the maintenance pass (`CommsMaintenanceService`, every 60 seconds,
armed by `background.automation`). To ping people, route `<channel>.approval_requested` with a
`deliver` trigger (INSTALL.md); there is no chat or notification dependency.

### Formatting

Text written in the Box (people's replies, agent sends and drafts) is stored as written, in a small
Markdown subset, and marked `meta.format: 'md'` (read as `format`). `core/format.ts` owns the one
parser and its three dialects:

- Email (`md`): `**bold**`, `_italic_`/`*italic*`, `~~strike~~`, `` `code` ``, fenced blocks,
  `- `/`1. ` lists, `> ` quotes, `# heading`, `[text](url)`. The send stores an HTML part rendered
  from the final text (after a redraft or an approval edit) in `body_html` before the network call
  (the channel's `prepare`), and sends it with a plain-text part (the text without markup).
- WhatsApp, written in the Box (`wa-authored`): as email, except a single `*x*` is bold, as people
  used to WhatsApp type it. It goes out as WhatsApp markup (`*b*`, `_i_`, `~s~`; a heading as a bold
  line, a link as `text (url)`); mentions resolve in plain text runs only.
- WhatsApp's own text (`wa`): inbound, sent from the phone, or sent before this format. Shown as
  the phone shows it.

Code and URLs are opaque (no formatting, no mentions). Delimiters that do not pair, and `_` inside a
word, stay literal. Every newline is a line break. Tables have no syntax: they stay as their text.
Only http, https, mailto and tel destinations become links; there is no raw HTML and no image in any
dialect. The view renders the same parse as React elements, a Box-authored WhatsApp message after
conversion (a draft previews as the phone will show it); stored `body_html` is never injected.
The composers (reply, Edit and send) show formatting live: a styled backdrop behind a
transparent-text textarea, built from `highlight()`, whose runs join to the textarea's value
exactly, marks dimmed in place, a bullet's dash drawn as a dot over it, and `@Name` of someone the
composer can mention coloured. The textarea stays the editor (caret, undo, input methods, the `@`
picker). The backdrop copies the textarea's box and metrics and styles only without changing glyph
widths (a text stroke for bold; italic only where the font's italic measures as wide). It checks
itself after each layout and steps aside, leaving plain text, if it would not line up; text over
20,000 characters stays plain. Cmd+B and Cmd+I wrap the selection, undoable.
Agents read the source text. Search matches the source text, so `invoice total` does not find
`invoice **total**`; list previews show the text without markup.

### Who decides

Every decision (approve, deny, trust a sender, release, remove a rule) needs a person at a browser:
`req.credential === 'session'` and the principal is no agent, by kind or by configured id
(`commsDecisionProblem`, core/decisions.ts, a copy of chat's `chatOpNeedsApproval`). Any signed-in user may decide; there is
no admin check. A bearer token (MCP, the cli proxy, a script) is refused with 403, so an agent can
never approve a held send or release a message. These procedures are tRPC only: no
MCP tool and no CLI command.

## Trust and release

An inbound channel stores each message and records `<channel>.received` for messages in an
account's mailbox (fields `id`, `channel`, `conversation_id`, `account`, `agent` (the account's
owner), `mailbox`, `from`, `subject`, the channel's `receivedFields`, `trusted`), unless the owner
cannot be woken or the message came from one of our own accounts. `trusted` is `true` only when the
sender matches the effective `trustedSenders` and passes the channel's sender check. Event triggers
filter on `fields.trusted` and `fields.agent` and name their own `run_as`: the event says who the
message is for, and nothing runs as that agent implicitly.

People can act on untrusted messages in an account's mailbox in Comms:

- **Trust sender** (tRPC `commsTrustSender`): adds the exact sender address (never a wider pattern)
  as a `trusted_sender` rule; future messages from it are trusted when they pass the sender check.
  The message it was made from is also released (as below, `released_by` the person) when the
  channel's `releaseOnTrust` says it would have been trusted on arrival. Otherwise it stays stored,
  and releasing it stays an explicit decision. Other existing rows are unchanged. Comms confirms
  which of the two happened.
- **Release to agent** (tRPC `commsRelease`): refused when the account's owner cannot be woken;
  records `<channel>.received` with `trusted` `true`,
  `released` `true` and `released_by`; dedup `<id>:release:<ms>`; stamps
  `released_by`/`released_at`. The UI asks for confirmation, with a forgery warning when the sender
  check did not pass. The only human override of automatic waking.

Both refuse shared-mailbox messages and messages that are not `received`.

## Shared mailboxes

A channel may offer team mailboxes no user owns (`features.comms.<channel>.sharedMailboxes`; each
has `id`, `address`, `name`, `inbound`, `allowPeopleSend`, `allowSystemSend`). Their rows carry
`account = shared:<id>` and `mailbox` is the public address.

- Everyone reads them, in Comms and through `comms-list channel=<channel> mailbox=<id>`.
- Nothing sends from them: `comms-send` only sends from an account and refuses a reply to shared mail.
  `allowPeopleSend` and `allowSystemSend` are parsed and default to false; they have no effect yet.
- Their messages are never trusted and record no event of any kind, so they can never wake an agent.
- A conversation stays inside its channel and mailbox: a shared thread never pulls in agent mail.

## People's own accounts

A channel may offer people's own accounts (WhatsApp: a person links their own business number).
Such a mailbox is the team's like any other: every member reads it, in Comms and through the
tools. It differs in who may act from it:

- It never wakes an agent: no `<channel>.received`, nothing to trust or release, no Untrusted
  folder. Only agents run, so only an agent's account wakes one (`wakeAccount`).
- Any person may send from it in Comms, at once, never held. An agent may send or draft from it
  (`from`, or a reply in its conversation); every such send waits for a person whatever the send
  policy, and any person at a browser session may approve, edit or deny it.
- It is never the default sending account: it is used only when named with `from` or when
  replying in its conversation.
- Delegate on one of its conversations runs as the Box's agent (`box.json` `agent`), drafting for
  a person to approve.

## Procedures and tools

Class-level `AuthGuard`. Reading and sending are MCP tools and tRPC procedures; decisions are tRPC only.

| MCP | tRPC | who | what |
|---|---|---|---|
| `comms-status` | `commsStatus` (query) | member | `channels[]` (id, label, `accounts[]` (id, owner, owner kind, address, name, `problem`, `sending` on or why not, `sendsLastHour`), `configProblems`, `problems`, `sending` (on when any account can send; else the guardrails' problem or why no account can), effective `allowedRecipients` and `trustedSenders`, `lists` with each entry's source, `sendsPerHour`, `pendingApproval`, last received and sent, unread, `mailboxes` with unread and last received); `pendingApproval` across channels, `maxPendingApprovals`, `approvalExpiryDays`, top-level `configProblems` |
| `comms-list` | `commsList` (query) | member | `channel` (omitted: every channel), `mailbox` (`all`, the default: every account's mailbox; or a shared mailbox id, needing `channel`), `owner` (one owner's inbox: their accounts' mailboxes and the groups they handle), `folder` (`inbox`/`approval`/`untrusted`/`ignored`/`sent`/`all`), `thread`, `unread`, `limit` (default 50, max 500); metadata and a 160-character preview |
| `comms-conversations` | `commsConversations` (query) | member | `channel`, `mailbox` and `owner` as `comms-list` (every group listed once), `filter`, `search`, `limit` (default 100, max 500); one row per conversation, newest first, with counts, preview and the caller's `favorite` |
| `comms-read` | `commsRead` (mutation) | member | one message with its body; marks inbound messages read; inbound bodies wrapped in `<<<UNTRUSTED <CHANNEL> CONTENT ...>>>` markers (`<<<UNTRUSTED EMAIL CONTENT ...>>>` for email) with `untrusted: true` |
| `comms-conversation` | `commsConversation` (mutation) | member | `conversation_id`, `before` (a message id: the page older than it), `limit` (default and max 500); the conversation and a page of its messages, oldest first, with bodies (inbound ones in untrusted markers), `hasOlder`, the caller's `favorite`; marks the returned inbound messages read |
| `comms-thread` | `commsThread` (mutation) | member | `id`; the whole conversation, oldest first, with bodies (inbound ones in untrusted markers); marks its inbound messages read |
| `comms-send` | `commsSend` (mutation) | admin | `channel` (optional for a reply), `to[]`, `cc[]`, `subject`, `text`, `reply_to_id`, `conversation_id`, `from` (an account id; Sending step 2); answers with the row including `external_id`, `sent_by` and `notice` (set when held for approval) |
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

- `/comms` (nav "Communications", order 760), laid out like WhatsApp for every channel. The shell
  sidebar lists All communications (every account's mailbox on every channel, each group once),
  then one inbox per owner with an account (their avatar and name, the unread plus held count of
  their accounts' conversations and the groups they handle, from `commsStatus` per account, and a
  warning tint when one of their accounts cannot send), then each shared mailbox labelled with its
  channel ("Email · Support"). An inbox spanning several channels (All communications, an owner
  with accounts on more than one) shows channel chips (All channels, then each channel) above its
  list. The main area shows any problems of the open scope with a Settings button, then the inbox's
  chats in the middle column: a header with the mailbox menu, search (title, people, message subject, text and sender), the filter chips Open (the default:
  not closed), Closed, Unread, Favourites and Groups (Groups only where a channel has group chats) and one row per conversation,
  newest first: the picture (the channel's `Picture`, else initials or a group glyph, with the
  channel icon in All communications), the name (group subject or contact; for email, who it is
  with), the time (clock today, Yesterday, weekday, date), the last message with `You:` or
  `~Sender:` and delivery ticks, and badges for a held draft, closed, favourite and the unread count.
  The menu opens the inbox's message folders (Awaiting approval with its count,
  Untrusted, Sent, Received, Ignored; a shared mailbox's Received and All messages), the status
  filters (waiting on us, waiting on them, assigned to me, assigned to an agent, all chats; shown
  as a removable chip) and Settings. A folder replaces the chats with its messages (sender or
  recipients, subject, snippet, time, unread in bold, a trusted or untrusted shield) and a Back
  arrow. The right pane shows the open conversation: picture, name, the subject for email, whose
  mailbox it is ("Nova's inbox", a shared mailbox's name; a group's is its handler's), a
  favourite star, status (Waiting on us, Waiting on them, Closed; the stored `done` is Closed),
  assignee (not for a group: its handler answers it), the messages oldest first (chat bubbles where the channel
  has a `MessageView`, else mail cards with sender checks and an untrusted-content banner; the list
  opens at the newest message, returns there after a person's send or decision, and follows new
  messages while the reader is at the bottom), Delegate
  to agent (a job run as the conversation account's agent, which drafts one held reply) and the reply
  composer, which sends from the conversation's account signed with the person on every channel
  (email threads under the conversation's subject). While the job runs, a spinner line says who
  drafts it; once its worker session exists the line opens the job's transcript in a read-only
  dialog (`commsDelegateStatus` `sessionId`; the server registers the `comms-delegate` agent session
  rule, so every member may read a delegate session and none may drive it). A finished or failed
  run's line can be dismissed (per browser). Where the channel offers `mentionOptions` (WhatsApp:
  the conversation's members), typing `@` in the composer suggests people and inserts `@<name>`. "Close after sending" is checked by default, so
  Send is "Send and close" (`commsReply` `close`); any new inbound message reopens a closed
  conversation. A held send shows who is not allowed
  (highlighted in the recipients) with Approve, Approve and always allow, Edit and send, and Deny;
  untrusted agent messages have Trust sender and Release to agent. Shared messages carry a "never
  wakes the agent" banner and have no composer. Selection is the URL:
  `/comms/<inbox>/<folder>/<id>?channel=<id>` (`inbox` is `all` for All communications, an owner's
  id, or a shared mailbox as `<channel>.<mailbox>`; `channel` is the channel chip; every inbox lands
  on its chats, folder `conversations`). Below the `md`
  breakpoint the list and the conversation stack, with Back, and the list is the landing view. With
  no channel, the view says so and points at the Recipe Gallery.
- Favourites are per person (`comms_favorites`, user and conversation); `comms-conversations`
  returns each row's `favorite` for the caller and takes `filter` (all, open, closed, unread,
  favorites, groups, waiting_us, waiting_them, mine, delegated) and `search`.
- Each folder's and chat filter's list is its own component mounted with `key={scopeKey/folder}`: a web data
  store's `useData` subscribes once per component, so switching stores inside one component would
  keep showing the first folder.
- Settings > Communications (order 820): a warning only when something needs attention, the channels
  as a list (each row opens the channel's page, `#settings/comms/<channel>`, with the breadcrumb
  "Communications › <channel>"), the held-send queue and its limits, and opt-outs. A channel's page
  starts with its status and problems, then compact groups of facts and address lists.
  WhatsApp has an overview (status and problems, and one Numbers list of every agent's and person's
  business number with Connect, pairing inline, or Unlink) and two pages, Groups and Guardrails; the
  same number row shows on a user's page in Settings > Users (the channel's `UserPanel`,
  contributed to core's `users.detail` slot). Email lists its mailboxes in one table, shared
  mailboxes as "Receive-only mailboxes".

Quoted reply history of a received message is folded behind a quiet `···` toggle where the channel
provides `splitQuoted`; a quote written in the Box stays in the body. Display only: `comms-read` and `comms-thread` return the full body.

Both reload on the change feed's `table:comms_messages`, `table:comms_address_rules`, `table:comms_conversations`, `table:comms_optouts` and `table:comms_favorites`.

## Extension points

How another feature (the support recipe's `comms` powerup, a team's own) adds to a conversation.
The dependent registers into the dependency (`docs/core/SEAM.md` § 4.2, § 5.6): Comms never imports
a contributor, reads contributions at render, and shows nothing extra when none is present. The
contract lives in `features/comms/web/lib/commsExtensions.ts` (`COMMS_SLOTS`, the prop type).

| slot | props | where it renders |
|---|---|---|
| `comms.conversation.actions` | `{ conversation }` | controls in the conversation pane's header, beside status and assignee (a "Create ticket" button) |
| `comms.conversation.panel` | `{ conversation }` | a panel under the header, above the messages; it returns null when it has nothing to say |

`conversation` is the web `CommsConversation` (`lib/useCommsData.ts`). On the server a contributor
reads conversations through the exported readers in `core/conversations.ts` and `core/accounts.ts`
(`conversationOrRefuse`, `conversationMessages`, `conversationPage`) and `messageBodyText`; it never writes a Comms table.
Importing them makes the contributor depend on Comms (declare `dependsOn: ['comms']`).

## What a team customises

The channel powerups it adds, each channel's guardrail lists and limits, the approval limits, the
shared mailboxes, the agent's display name (`agent.name`), the trigger prompts, and the
untrusted-content wording in `server/comms/comms.controller.ts`.
