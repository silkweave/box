# Email

The Email channel: the agent sends and replies through Resend from its own address, under the Comms guardrails, and its mail shows in Comms with every conversation threaded.

## Highlights

- The mailbox is the Box agent's email account, From `Name <address>` with the agent's name; people never connect their own email
- Sending is a plain `fetch` to Resend's API with retry and an idempotency key, so a retry after a lost response cannot send twice
- Allowed recipients and trusted senders as exact addresses or `*@domain`; anything outside the allowlist waits for a person in Comms
- Replies threaded by `In-Reply-To` and `References`, with Resend's Message-ID backfilled onto every sent message
- Shared team mailboxes (e.g. finance@) configured here, received through the Email inbound powerup
- Quoted reply history folded away in the conversation view; SPF, DKIM and DMARC badges on received mail
- Settings > Comms names each missing piece: the account, the Resend key and where it goes, invalid entries

## Needs

- A Resend account with a verified sending domain, and its API key
- An `accounts.email` entry for the Box agent (`box.json` `agent`)

## How it works

`comms-send` with `channel: "email"` (or a `reply_to_id` of an email) composes the row: recipients
as bare addresses, the subject (a reply defaults to `Re: <subject>`), and threading from the
parent's stored Message-ID. Within the guardrails, the channel posts it to Resend as the agent's
account and stores Resend's id as `external_id`. Resend replaces any custom Message-ID, so none is
sent; the real one is read back from `GET /emails/{id}` and becomes the row's `message_id` (and, for
a root send, its `thread_id`), so replies to it thread. Received mail arrives with the
[Email inbound](../email-inbound/POWERUP.md) powerup.
