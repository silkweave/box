# Email inbound

Mail to the agent's address arrives in its Comms mailbox, shared team mailboxes receive theirs, and mail from people the team trusts wakes the agent to read it and decide whether to answer.

## Highlights

- Resend receives the mail and posts a signed `email.received` webhook to the Box's relay; the Box stays private
- Svix signatures checked on the Box, against the time the relay received the delivery, so a delivery held while the Box was offline still verifies
- The webhook is acknowledged first and the full message is fetched afterwards, with retry across restarts; a fetch that keeps failing is marked failed and shown, never dropped
- Routing on the envelope recipient (`received_for`), never on headers the sender wrote; mail for addresses no mailbox has is kept as `ignored` and never acted on
- Shared team mailboxes and the agent's public address can receive through a forward to an inbound alias, so the domain's MX stays where it is
- `trusted` only when the From address is in `trustedSenders` and DMARC passed at Resend's receiving server; shared mail is never trusted
- An `email.received` event trigger wakes the agent for trusted mail; everything else is stored and visible, and a person can trust a sender or release one message from Comms

## Needs

- Resend receiving enabled for the domain, with its MX records
- The agent surface (`box.json` `workerdeck`) and an agent profile for the agent in `agentProfiles`, for the trigger

## Requires

- [Email](../email/POWERUP.md)
- [Webhook relay](../../../automation/powerups/relay/POWERUP.md)

## How it works

Resend posts `email.received` (metadata only) to `https://<relay>/hook/resend/<hook key>`. The relay
hands it to the `resend` provider, which verifies the Svix signature and records
`resend.email.received`. The powerup's listener stores the row as `fetching` and starts a fetch of
`GET /emails/receiving/{id}` without holding the ack. Once stored, the worker routes it to the agent
mailbox, a shared mailbox or `ignored`, decides `trusted` and, for the agent mailbox only, records
`email.received`; a trigger filtered on `fields.trusted = true` wakes the agent, which reads the
message with `comms-read` and may answer with `comms-send` (still bound by the recipient allowlist
and hourly cap).
