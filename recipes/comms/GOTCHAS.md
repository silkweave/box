# comms gotchas

Sending failures are recorded rows (`status: failed`, with the transport's message in `error`), and
inbound fetch failures stay visible as `fetching` or `failed`. Check `comms-status` and the table
before reading code.

The feature id (`comms`, the same as the recipe id) and the channel ids (`email`, `whatsapp`) are part of runtime
registration, warehouse rows and event kinds. Keep them stable.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception or custom path in the Box's docs/GOTCHAS.md and leave current
operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **New rows must spread `newCommsRow()`.** `upsertRecord` writes every column on insert and a key
  you leave out becomes NULL; SQL column defaults do not apply. `comms_messages` has NOT NULL JSON
  and text columns, so an insert without `newCommsRow()` fails with a NOT NULL constraint error.
- **Boot creates the tables but never adds columns.** Until a Box has booted with the feature, the
  models can change freely. After the first boot, every schema change needs a new comms migration
  (`ALTER TABLE comms_messages ADD COLUMN IF NOT EXISTS ...`, which is a no-op on tables the model
  just created); editing `models.ts` alone leaves existing instances without the column.
- **The outbound caller column is `sent_by`, not `actor`.** `upsertRecord` takes an input key
  `actor` as its audit stamp and never writes it to a column of that name, so a column called
  `actor` would stay null.
- **Barrel name collisions only show up at runtime.** Every feature's core barrel is re-exported
  through `packages/core/src/generated/exports.ts`, and the comms barrel re-exports each channel
  powerup's. Two features exporting the same name pass `tsc` in many setups but make Bun fail at
  load ("ambiguous multiple bindings"), which takes the whole server down. Prefix new exports with
  the feature's or channel's vocabulary (`fetchInboundEmail`, not `fetchOne`) and check with
  `cd apps/server && bun --conditions=@silkweave/box-source -e "await import('@silkweave/box-core')"`.
- **A channel registers when its barrel loads.** `registerCommsChannel` runs at import of the
  channel's core barrel; a channel left out of `core/index.ts` is simply absent (`comms-status`
  `channels` lacks it, `comms-send` names the channels the Box has). Rows of a channel whose powerup
  was removed stay readable with their stored text body.
- **Shared mailbox messages record no event, on purpose.** A shared mailbox (finance@) must never
  wake an agent, and any event kind an agent trigger could listen for would be a way in: a trigger on
  `email.*` matches every kind under it, and a person can point an agent trigger at any recorded
  kind. So inbound channels record nothing for shared messages (no `<channel>.received`, no other
  kind); the Comms view updates through the change feed. If people want to be notified about shared
  mail later, add a kind outside the channel's prefix and have automation refuse agent triggers on
  it. `core/email/inbound/fetch.test.ts` asserts the total event count does not move.
- **Decisions key on the credential, not the transport.** `commsDecisionProblem` refuses anything
  but a `session` credential and refuses the agent. A person's own Claude Code session, holding
  their token, cannot approve either: they approve in the browser. Do not add an MCP tool or CLI
  command for decisions.
- **The hourly cap counts `occurred_at`, per channel account.** An approved send's `occurred_at` is
  its approval time, so a send held for days counts in the hour it went out; held, denied, failed and
  expired rows never count. `maxPendingApprovals`, by contrast, counts held sends across channels.
- **Agent triggers need `workerdeck` and `agentProfiles[<agent id>]`.** A `<channel>.received`
  trigger runs as the agent it names in `run_as`; trigger validation refuses it without the agent
  surface (`box.json` `workerdeck`) and a profile for that agent. The event's `fields.agent` says
  who the message is for; filter on it, nothing runs as that agent implicitly.
- **A conversation's scope is its account id, so renaming an account splits its threads.** A
  conversation id is `conversationKey(channel, scope, peer)` with scope = the account id (or
  `shared:<id>`, or `group` for a group chat). Changing an account's `id` leaves its stored rows and
  conversations under the old id, and new messages start new conversations under the new one. A
  rename needs a backed-up transition script that rewrites `account`, the scope and the ids
  together. `group` is reserved and refused as an account id.
- **Ports** are Nest **8190** / Vite **5190**. A second Box needs its own `server.port` / `server.vitePort`.

## Email channel

- **Email: the allowlist decides approval, and an invalid entry turns sending off.** Only exact
  addresses and `*@domain` are valid (`@domain` is an alias). `*@example.com` does not match
  `sub.example.com`. A typo such as `*example.com` is reported in `configProblems` rather than
  matching too much.
- **Email: one mailbox per agent, and no default.** An `accounts.email` entry's `user` must be an
  active agent; one owned by a person or a retired agent still receives but never sends or wakes
  anyone. Each agent has at most one account. With several accounts, an inbound email belongs to
  the first one addressed, and a person's new send must name `from`.
- **Email: the Resend key is per account, with a channel fallback.** `credentials.email.<account id>`
  wins over `credentials.email["*"]`. Settings > Communications and tRPC `commsEmailStatus` `keyPath` name
  where it goes.
- **Email: Resend replaces a custom Message-ID.** Observed 2026-10-08: a send carrying `Message-ID:
  <<row id>@<domain>>` was delivered with an SES id (`<...@<region>.amazonses.com>`), which is what
  `GET /emails/{id}` reports. So no Message-ID header is sent: a sent row starts with `message_id`
  null and is backfilled from `GET /emails/{id}` (attempts 3 s, 15 s and 60 s after the send, then on
  the maintenance pass), at most 10 attempts. The id may be missing right after the send, until
  SES accepts the message. A row that never gets one stays `sent` with a note in `error`. Until a
  row has its id, a reply to it does not join its thread; an agent reply to such a row goes out
  without threading headers and logs a warning.
- **Email: backfill and retry timers are armed by `background.*`.** The Message-ID maintenance pass
  runs with `background.automation`, the inbound fetch pass (which also backfills, since inbound
  threading needs it) with `background.relay`. With both off, only the per-send follow-up attempts
  run.
- **Email inbound: routing reads the envelope, never the headers.** `received_for` decides whenever
  it is present; To/Cc are a fallback only without it. A forward to `finance@in.example.com` whose To
  also names the agent stays in the shared mailbox; reading To first would let any sender pull
  shared mail onto the agent's trust and wake path.
- **Email inbound: Resend sends every `email.received` to every enabled webhook.** Receiving is per
  Resend account, not per domain or Box, so two Boxes whose webhooks sit on one Resend account (a
  development Box and the team Box, each behind its own relay) both fetch and store every inbound
  message, and both may wake their agent. Keep one enabled `email.received` webhook per Resend
  account, or give each Box its own Resend account; disable the others in the Resend dashboard.
- **Email inbound: forwarded mail fails SPF and often DMARC.** A Workspace forward to the Resend
  inbound alias re-sends from Google, so shared mail commonly shows `spf: fail` and `dmarc: fail`.
  Harmless (shared mail is never trusted); Comms shows its badges neutrally.
- **Email inbound: SPF can fail on genuine mail; trust keys on DMARC.** Observed 2026-10-08: a
  Gmail-hosted reply arrived with `spf: fail`, `dkim: pass`, `dmarc: pass`. DMARC passes through DKIM
  alignment, which is why `trusted` reads `dmarc` only and never `spf`.

## WhatsApp channel

- **WhatsApp: the settle window times arrival, not WhatsApp's timestamp.** `messageTimestamp` has
  whole seconds and the sender's clock; the window reads each live row's `seq` (arrival in
  microseconds). Its timers live in the server process; a restart re-arms windows from the last
  hour and settles overdue ones once. Typing extends a window only where the connection asked for
  presence (`presenceSubscribe`, sent for a chat once a message there woke an agent) and never past
  the cap.
- **WhatsApp: an answer stops a window, not a draft already running.** A reply or a team member's
  message before the window closes records no settled event. A draft job that already started
  still writes its held draft; a person rejects it in Comms.

- **WhatsApp: a QR pairing leaves `creds.registered` false.** Observed 2026-10-13 on Baileys
  7.0.0-rc14: only the pairing-code flow sets `registered`; every successful pairing writes
  `creds.account` (the signed device identity). A session counts as paired when either is set.
  Checking `registered` alone makes a QR-linked Box come up "unlinked" after a restart.
- **WhatsApp: never refuse every history sync type.** The bootstrap, push-name and non-blocking
  syncs right after linking carry the LID-to-phone mappings and contact names; Baileys warns
  ("DISABLING ALL SYNC") when `shouldSyncHistoryMessage` refuses all of them. The Box accepts those,
  takes RECENT only when the owner chose a history import and never FULL; history messages are
  stored only with that choice. A device linked while all syncs were refused needs a re-pair to
  get the mappings.
- **WhatsApp: older messages come from the phone, one page at a time.** "Load older" sends
  `fetchMessageHistory` anchored on the chat's oldest stored message; the phone answers with an
  ON_DEMAND history sync that the connection hands to the waiting request, never to the pairing
  import. It needs one stored message in the chat to anchor on and the phone online; a page that
  does not come within 45 seconds ends the run, and WhatsApp decides how far back the phone answers.
  Groups only: a direct chat's JID on the phone may be its LID, which the anchor cannot name.
- **WhatsApp: group JIDs in settings are taken as they are.** `allowedRecipients` and
  `trustedSenders` accept `<digits>@g.us` and `<digits>@lid` unchanged; number formatting (spaces,
  dots, dashes) is stripped from phone entries only. Managed groups are not configuration: they are
  picked in Settings and kept in the warehouse.
- **WhatsApp: only managed chats exist for the Box.** A group is handled once it is ticked in
  Settings > Communications > WhatsApp > Groups; a direct chat only when a Box user carries the
  number as their phone. Everything else (client direct messages, other groups, a chat WhatsApp
  names only by LID) is dropped, not held: its messages are never stored, so managing the chat
  later does not bring them back. The WhatsApp settings count what was dropped since boot.
- **WhatsApp: a person's own number keeps only what they pick, and is private.** Nothing of it is
  stored until its owner picks a chat; a chat dropped before the pick does not come back. Its
  messages are hidden from other people everywhere (lists, counts, media, pictures), never wake an
  agent, and an agent's send from it waits for its owner alone. Two people who both linked their
  numbers and pick their chat with each other: each message is stored once, in whichever mailbox
  stored it first, so a chat with one of our numbers cannot be picked at all.
- **WhatsApp: the linked number's own messages are outbound.** When the agent's number is a
  person's phone, what that person types on the phone or in a group lands in Sent (`sentFrom:
  phone`), not the Inbox. A group message from another of our numbers is that account's outbound
  message too, whichever of our connections stores it first.
- **WhatsApp: mentions are `@<number>` on the wire.** WhatsApp puts the mentioned person's number
  (or LID, `@227947621400745`) in the text and their JID in the message context's `mentionedJid`;
  the phone shows the contact's name only because it resolves the JID itself. Comms stores the
  readable form (`@Nova` in `body_text`, who each is in `meta.mentions`) and turns `@<name>` of a
  conversation member back into a WhatsApp mention when sending. A mention of our own number arrives
  as our LID, which the LID mapping may not hold: the connection's own `sock.user.lid` resolves it.
- **WhatsApp: a mention of one of our numbers can arrive as its LID**, which another connection's
  LID mapping may not hold: each connection writes its own LID to `link.json` on open, and every
  connection resolves our LIDs from those records, so a stored mention reads the same whichever
  connection stored it. A number paired before this was recorded gains its LID on its next connect.
- **WhatsApp: a group message reaches every connection of ours in the group.** It is stored once:
  the row id is `wa:<chat>:<WhatsApp id>` and a WhatsApp id already stored (by any connection, in
  any form of its chat) is a duplicate. The connections share one process, so ingest is
  serialized per WhatsApp id; two servers on one Box would race.
- **WhatsApp: sessions and media are not in backups.** `data/comms/whatsapp/<agent>/` (the device
  session and `link.json`) is never copied, so a restored Box pairs each number again and two
  Boxes never run one session. Media files under `data/comms/media/whatsapp/` are not backed up
  either: the rows keep each item's metadata, and opening one downloads it again from WhatsApp
  while WhatsApp still holds it.
- **WhatsApp: one Box arms the connections.** `background.whatsapp` belongs in `box.local.json` of
  the Box that holds the linked devices. A second Box with the same session would fight over the
  device; a development Box pairs its own numbers or stays off.
