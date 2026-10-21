# WhatsApp

The WhatsApp channel: each agent can have its own WhatsApp number, linked as a device. The Box
handles the groups the team picks and direct chats with team members, under the Comms guardrails.
Every group is one conversation for the Box, answered by exactly one of our agents. A person can
link their own number too: the Box keeps only the chats they pick, privately, so agents can read
them and draft replies that go out when that person approves.

## Highlights

- One number per agent, optional. Connect pairs it from Settings > Communications > WhatsApp (or
  the agent's page in Settings > Users) with a QR code or an 8-character code. The number WhatsApp
  links becomes the account's address; nothing goes in `box.json` `accounts`
- Only managed chats exist for the Box: groups ticked in Settings > Communications > WhatsApp >
  Groups, and direct chats with a team member (a Box user's phone). Everything else is dropped
  before it is stored
- A group is stored once, whichever of our numbers received it, and has one handler: the only
  agent that answers in it, set on the Groups page in Settings
- Roles per message: `us` (our numbers, including what a person types on a linked phone), `team`
  (a Box user's phone) and `client`. Only a client message, or a team member mentioning the handler,
  waits on us
- Every agent send waits for a person by default (`sendPolicy: approve-all`); people reply from
  Comms directly, never held, with `sent_by` recording who. Sends go only to managed chats
- Chat bubbles with sender names, mentions shown as names, media (downloaded on arrival, kept for
  `mediaRetentionDays`, fetched again on open), delivery ticks, group pictures and members
- Stop words (`STOP`, `UNSUBSCRIBE`) in a direct chat opt the sender out; nobody messages them
  again. In a group they opt nobody out: people manage groups in Settings
- Settings names each missing piece: connections off, an agent without a number, a logged-out
  device, invalid entries
- People's own numbers (Settings > Communications > WhatsApp, My WhatsApp): a person connects
  their own number and picks the chats the Box keeps (a group it is in, a recent chat, or a number).
  Nothing else of the number is stored. Those chats are a private mailbox (recipe SPEC.md, "Private
  mailboxes"): teammates do not see them, they never wake an agent, agents read them and draft from
  them, and only the person approves what goes out. Their own number writes as that team member
  wherever an agent's number sees it. A managed group and a chat with one of our numbers cannot be
  picked: those are the team's. The group list searches by name or teammate, sorts by recent
  activity and names the teammates in each group. "Load older" on a kept group asks the phone for
  its messages of the last `historyDays`, page by page, stored read and waking nobody

## Needs

- `background.whatsapp: true` on exactly one Box: the one that holds the linked devices
- A phone with WhatsApp for each number to link, preferably a secondary number per agent; a person
  linking their own number accepts WhatsApp's ban risk for it

## How it works

The server holds one Baileys socket per linked account (the account id is its owner's id), each
registered as that account's transport. Its session (Baileys credentials and Signal keys) is one
SQLite file, `data/comms/whatsapp/<agent>/session.db`, beside `link.json` (the linked number and
its LID). Sessions are never backed up: a restored Box pairs again, so two Boxes never run one
session. Inbound messages from managed chats are stored in `comms_messages` with row id
`wa:<chat>:<WhatsApp id>`; the copy every other connection of ours in the group receives is a
duplicate and skipped. `comms-send` with `channel: "whatsapp"` (or a reply) sends one message to
one chat through the connection of the account it goes out from. See the recipe
[SPEC.md](../../SPEC.md) ("Group handler") and [GOTCHAS.md](../../GOTCHAS.md) ("WhatsApp channel").

A person's picks are `personal_chat` address rules (`<account>/<chat>`), changed only by that person
(tRPC `commsWhatsappPersonalChats`, `commsWhatsappPersonalChat`). A group on a person's account is
their own conversation (scope: their account), never the team's group conversation, and has no
handler or CRM account. The Box's group list, handlers and members come from agents' numbers only.

WhatsApp links devices through an unofficial library (Baileys); WhatsApp may ban numbers that
automate. Use secondary numbers, keep sends low and approval on. On a person's own number the risk
is theirs: the Box sends from it only what they wrote or approved.
