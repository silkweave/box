# comms gotchas

Sending failures are recorded rows (`status: failed`, with the transport's message in `error`), and
inbound fetch failures stay visible as `fetching` or `failed`. Check `comms-status` and the table
before reading code.

The feature id (`comms`, the same as the recipe id) and the channel ids (`email`) are part of runtime
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
- **Agent triggers need `workerdeck` and `agentProfiles[<agent.id>]`.** A `<channel>.received`
  trigger runs as the agent; trigger validation refuses it without the agent surface (`box.json`
  `workerdeck`) and a profile for the agent.
- **Ports** are Nest **8190** / Vite **5190**. A second Box needs its own `server.port` / `server.vitePort`.

## Email channel

- **Email: the allowlist decides approval, and an invalid entry turns sending off.** Only exact
  addresses and `*@domain` are valid (`@domain` is an alias). `*@example.com` does not match
  `sub.example.com`. A typo such as `*example.com` is reported in `configProblems` rather than
  matching too much.
- **Email: the mailbox is the agent's.** An `accounts.email` entry whose `user` is not `agent.id` is
  refused. With several email accounts, exactly one must be `"default": true`.
- **Email: the Resend key is per account, with a channel fallback.** `credentials.email.<account id>`
  wins over `credentials.email["*"]`. Settings > Comms and tRPC `commsEmailStatus` `keyPath` name
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
