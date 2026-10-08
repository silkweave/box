# email gotchas

Sending failures are recorded rows (`status: failed`, with Resend's message in `error`), and inbound
fetch failures stay visible as `fetching` or `failed`. Check `email-status` and the table before
reading code.

The feature id (`email`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception or custom path in the Box's docs/GOTCHAS.md and leave current
operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **New rows must spread `newEmailRow()`.** `upsertRecord` writes every column on insert and a key
  you leave out becomes NULL; SQL column defaults do not apply. `email_messages` has NOT NULL JSON
  and text columns, so an insert without `newEmailRow()` fails with a NOT NULL constraint error.
- **Boot creates the table but never adds columns.** Until a Box has booted with the feature, the
  model can change freely. After the first boot, every schema change needs a new email migration
  (`ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS ...`, which is a no-op on tables the model
  just created); editing `models.ts` alone leaves existing instances without the column.
- **Barrel name collisions only show up at runtime.** Every feature's core barrel is re-exported
  through `packages/core/src/generated/exports.ts`. Two features exporting the same name pass
  `tsc` in many setups but make Bun fail at load ("ambiguous multiple bindings"), which takes the
  whole server down. Prefix new exports with the feature's vocabulary (`fetchInboundEmail`, not
  `fetchOne`) and check with
  `cd apps/server && bun --conditions=@silkweave/box-source -e "await import('@silkweave/box-core')"`.
- **Shared mailbox mail records no event, on purpose.** A shared mailbox (finance@) must never wake
  an agent, and any event kind an agent trigger could listen for would be a way in: a trigger on
  `email.*` matches every kind under it, and a person can point an agent trigger at any recorded
  kind. So the fetch worker records nothing for shared mail (no `email.received`, no other kind);
  the Mail view updates through the change feed. If people want to be notified about shared mail
  later, add a kind outside the `email.` prefix and have automation refuse agent triggers on it.
  `inbound-fetch.test.ts` asserts the total event count does not move.
- **Inbound routing reads the envelope, never the headers.** `received_for` decides whenever it is
  present; To/Cc are a fallback only without it. A forward to `finance@in.example.com` whose To also
  names the agent stays in the shared mailbox; reading To first would let any sender pull shared
  mail onto the agent's trust and wake path.
- **Resend sends every `email.received` to every enabled webhook.** Receiving is per Resend
  account, not per domain or Box, so two Boxes whose webhooks sit on one Resend account (a
  development Box and the team Box, each behind its own relay) both fetch and store every inbound
  message, and both may wake their agent. Keep one enabled `email.received` webhook per Resend
  account, or give each Box its own Resend account; disable the others in the Resend dashboard.
- **Forwarded mail fails SPF and often DMARC.** A Workspace forward to the Resend inbound alias
  re-sends from Google, so shared mail commonly shows `spf: fail` and `dmarc: fail`. Harmless (shared
  mail is never trusted); the Mail view shows its badges neutrally.
- **Decisions key on the credential, not the transport.** `emailDecisionProblem` refuses anything
  but a `session` credential and refuses the agent. A person's own Claude Code session, holding
  their token, cannot approve either: they approve in the browser. Do not add an MCP tool or CLI
  command for decisions.
- **The hourly cap counts `occurred_at`.** An approved send's `occurred_at` is its approval time, so
  a send held for days counts in the hour it went out; held, denied and expired rows never count.
- **The allowlist decides approval, and an invalid entry turns sending off.** Only exact addresses and
  `*@domain` are valid (`@domain` is an alias). `*@example.com` does not match
  `sub.example.com`. A typo such as `*example.com` is reported in `configProblems` rather than
  matching too much.
- **The mailbox is the agent's.** An `accounts.email` entry whose `user` is not `agent.id` is
  refused. With several email accounts, exactly one must be `"default": true`.
- **The Resend key is per account, with a channel fallback.** `credentials.email.<account id>`
  wins over `credentials.email["*"]`. `email-status` `keyPath` names both.
- **Resend replaces a custom Message-ID.** Observed 2026-10-08: a send carrying `Message-ID:
  <<row id>@<domain>>` was delivered with an SES id (`<...@<region>.amazonses.com>`), which is what
  `GET /emails/{id}` reports. So no Message-ID header is sent: a sent row starts with `message_id`
  null and is backfilled from `GET /emails/{id}` (attempts 3 s, 15 s and 60 s after the send, then on
  the maintenance pass), at most 10 attempts. The id may be missing right after the send, until
  SES accepts the message. A row that never gets one stays `sent` with a note in `error`. Until a
  row has its id, a reply to it does not join its thread; an agent reply to such a row goes out
  without threading headers and logs a warning.
- **SPF can fail on genuine mail; trust keys on DMARC.** Observed 2026-10-08: a Gmail-hosted reply
  arrived with `spf: fail`, `dkim: pass`, `dmarc: pass`. DMARC passes through DKIM alignment, which
  is why `trusted` reads `dmarc` only and never `spf`.
- **The outbound caller column is `sent_by`, not `actor`.** `upsertRecord` takes an input key
  `actor` as its audit stamp and never writes it to a column of that name, so a column called
  `actor` stays null. Migration `email:001-sent-by` adds `sent_by` to tables created before the
  rename; the old column is left unused.
- **Backfill and retry timers are armed by `background.*`.** The Message-ID maintenance pass runs
  with `background.automation`, the inbound fetch pass (which also backfills, since inbound
  threading needs it) with `background.relay`. With both off, only the per-send follow-up
  attempts run.
- **Agent triggers need `workerdeck` and `agentProfiles[<agent.id>]`.** The `email.received` trigger
  runs as the agent; trigger validation refuses it without the agent surface (`box.json`
  `workerdeck`) and a profile for the agent.
- **Ports** are Nest **8190** / Vite **5190**. A second Box needs its own `server.port` / `server.vitePort`.
