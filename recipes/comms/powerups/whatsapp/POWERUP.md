# WhatsApp

The WhatsApp channel: each agent can have its own WhatsApp number, linked as a device, and each
person can link their own business number. The Box stores every chat of a connected number, under
the Comms guardrails. Every group is one conversation for the Box, handled by at most one of our
agents.

Connect only business WhatsApp numbers: the business's own, or a person's number used only for
business, with nothing sensitive on it. Everything on a connected number is stored and every member
of the Box reads it.

## Highlights

- One number per agent, optional. Connect pairs it from Settings > Communications > WhatsApp (or
  the agent's page in Settings > Users) with a QR code or an 8-character code. The number WhatsApp
  links becomes the account's address; nothing goes in `box.json` `accounts`. An admin pairs an
  agent's number
- A person can link their own business number too, only that person at a browser (Settings >
  Communications > WhatsApp, or their page in Settings > Users). An admin or that person can unlink
  it. The pairing code is shown only to whoever may pair
- A connected number stores every chat: every group and every direct chat, live and the recent
  history WhatsApp sends right after linking (when chosen at pairing, up to `historyDays`). Nothing
  is dropped, and there is no per-chat pick
- A group is one conversation for the Box whichever of our numbers stores it. It is handled when an
  agent is its handler, set on the Groups page in Settings ("Handled by", among our agents whose
  numbers are in the group). A group without a handler is stored for the team and wakes nobody
- Every mailbox is the team's: any member reads it. A person's own number never wakes an agent;
  any person may send from it in Comms, and an agent's draft from it always waits for a person
- Roles per message: `us` (our numbers), `team` (a Box user's phone, including a person's own
  number writing in a group) and `client`. A group wakes only its handling agent, from trusted
  senders; a team member's message wakes it only when it mentions the handler. A direct chat on an
  agent's number wakes that agent (trusted senders only)
- Every agent send waits for a person by default (`sendPolicy: approve-all`); people reply from
  Comms directly, never held, with `sent_by` recording who. A person may send to any chat from any
  account
- Chat bubbles with sender names, mentions shown as names, media (downloaded on arrival, kept for
  `mediaRetentionDays`, fetched again on open), delivery ticks, group pictures and members
- Stop words (`STOP`, `UNSUBSCRIBE`) in a direct chat opt the sender out on any number, a person's
  own included; nobody messages them again. In a group they opt nobody out
- "Load older" on a group: a background job that asks a connected phone in the group for its
  messages of the last `historyDays`, page by page, stored read and waking nobody. Progress and the
  last result show on the Groups page and survive a restart
- Settings > Communications > WhatsApp is an overview (status with problems, and one Numbers list
  of every agent's and person's business number with Connect and Unlink) and two pages: Groups
  (every group with its handler, CRM account and Load older state; search, filter All, Handled or
  Not handled, sort by activity or name) and Guardrails (sending policy and caps, stop words,
  allowed recipients, waking rules and trusted senders, history and media retention)
- Settings names each missing piece: connections off, an agent without a number, a logged-out
  device, invalid entries

## Needs

- `background.whatsapp: true` on exactly one Box: the one that holds the linked devices
- A phone with WhatsApp for each number to link, preferably a secondary business number per
  agent; a person linking their own business number accepts WhatsApp's ban risk for it

## How it works

The server holds one Baileys socket per linked account (the account id is its owner's id), each
registered as that account's transport. Its session (Baileys credentials and Signal keys) is one
SQLite file, `data/comms/whatsapp/<owner>/session.db`, beside `link.json` (the linked number and
its LID). Sessions are never backed up: a restored Box pairs again, so two Boxes never run one
session. Inbound messages are stored in `comms_messages` with row id `wa:<chat>:<WhatsApp id>`; the
copy every other connection of ours in a group receives is a duplicate and skipped. A group's
authorship is the same whichever connection stores it: what an agent's number wrote is that
account's outbound message, what a person's own number wrote is a team member's message. One
function decides who a message wakes (a group: its handler; a direct chat: the agent whose number
holds it; a person's own number: nobody). `comms-send` with `channel: "whatsapp"` (or a reply)
sends one message to one chat through the connection of the account it goes out from. See the
recipe [SPEC.md](../../SPEC.md) ("Group handler", "People's own accounts") and
[GOTCHAS.md](../../GOTCHAS.md) ("WhatsApp channel").

Older messages load per group (tRPC `commsWhatsappBackfill`, any person at a browser) from a
connected phone in the group, by default the handler's, else the first connected number in it,
anchored on the group's oldest stored message. Jobs run one at a time per phone; their state is
kept in `data/comms/whatsapp/history.json`, and a job a restart interrupted reads as stopped. The
handler is changed with `commsWhatsappHandler` (nullable).

WhatsApp links devices through an unofficial library (Baileys); WhatsApp may ban numbers that
automate. Use secondary numbers, keep sends low and approval on. On a person's own number the risk
is theirs: the Box sends from it only what a person wrote or approved.
