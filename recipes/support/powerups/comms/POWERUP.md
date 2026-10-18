# Comms conversations

Turn a WhatsApp chat or an email thread in Communications into a support ticket in one step, with the ticket and the conversation linked both ways.

## Highlights

- "Create ticket" on a Comms conversation: a dialog prefilled with the quoted messages, the requester found by their address or number
- A ticket badge on the conversation, and the conversation's excerpt and link on the ticket
- An agent tool that summarizes a conversation into a ticket, idempotent per message
- "Open conversation" on the ticket, to reply in Comms under its guardrails

## Needs

- Nothing outside the Box: the Communications recipe with at least one channel (email or WhatsApp)

## Requires

- [Communications](../../../comms/RECIPE.md)

## How it works

The powerup adds `comms` to the support feature's `dependsOn` and reads conversations through
Comms' exported readers; it never writes a Comms table. It owns `support_ticket_conversations`
(ticket to conversation, channel and the anchor message). A ticket made from a conversation has
`source: comms` and the anchor message id as `source_ref`, so the same message cannot become two
tickets, while a long chat can become several tickets over time. The requester is found or created
from the conversation's peer: an email address, or a WhatsApp number (normalized like every phone).
With the `crm` powerup present, a new requester becomes a contact of the conversation's CRM account.

It contributes to two Comms slots, `comms.conversation.actions` (Create ticket, or the linked
tickets) and `comms.conversation.panel` (the open tickets of this conversation), and to Support's
own `support.ticket.panel` (the excerpt and Open conversation). Message text reaches agents inside
the untrusted-content markers, exactly as Comms frames it.
