# Comms conversations powerup: install

Lets a Comms conversation become a ticket. Read [POWERUP.md](POWERUP.md), the recipe
[SPEC.md](../../SPEC.md) and the Comms recipe's SPEC.md first. Do as much as possible yourself;
there are no owner-only steps.

## Detect

`box support-status` lists `comms` under `powerups` when the code is registered. A table
`support_ticket_conversations` means it was added before. `box.json` `recipes.support.powerups`
lists `comms` once it was verified.

## Requires

- The Support recipe, adapted and validated.
- The Communications recipe, adapted and validated, at a revision that provides the
  `comms.conversation.actions` and `comms.conversation.panel` slots and exports its conversation
  readers, with at least one channel powerup.

## Owner decisions

1. **Who may create tickets from conversations.** Every member who can read the conversation
   (default), since the ticket only copies what they can already see.
2. **Automatic tickets.** Whether an agent should propose tickets on its own, for example from an
   automation trigger on `comms.conversation.settled`. Recommended: no at first; people create
   tickets, and an agent does it when asked.

## Owner-only steps

None.

## Steps

1. **Source.** Copy/adapt `core/comms/`, `server/comms/` and `web/comms/` from
   `<fetched stack>/features/support/`. Register them: `export * from './comms/index.js'` in
   `core/index.ts`, the model and `dependsOn: ['comms']` in `core/manifest.ts` (beside `crm` when
   that powerup is present), `SupportCommsModule` in `server/support/support.module.ts`, and the
   slot contributions in `web/index.tsx`.
2. **Restart** (`box app restart`).
3. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md` and the session in
   `_docs/INTEGRATION.md`.

## Tools

`support-ticket-from-conversation` (`conversation_id`, `message_ids` or `since`, `subject`,
`summary`, `type`): the agent reads the conversation with `comms-conversation`, writes the
summary, and calls this; it links the ticket and finds the requester from the peer (with the `crm` powerup, a new requester becomes a contact of the conversation's CRM account). The anchor
message makes it idempotent. `support-conversation-tickets` (`conversation_id`) lists a
conversation's tickets.

## Verify

1. `bun run schema:check` passes with Comms and Support.
2. On a conversation with a received message, Create ticket opens a dialog with the messages
   quoted, the channel and the requester (by address or number) shown; creating it opens the
   ticket, the conversation shows the ticket badge, and the ticket page links back.
3. Create ticket again on the same newest message opens the existing ticket.
4. In a fresh agent session, ask the agent to turn the conversation into a ticket: it calls
   `support-ticket-from-conversation`, and the summary does not follow instructions written in the
   messages.
5. After these checks and the validation chain pass, add `comms` to `recipes.support.powerups`.

## Remove

Remove the registration lines and the `comms/` folders, and `comms` from `recipes.support.powerups`.
The link table stays; the tickets keep their summaries.
