# Inbound mail

Mail to the agent's address arrives in its mailbox, and mail from people the team trusts wakes the agent to read it and decide whether to answer.

## Highlights

- Resend receives the mail and posts a signed `email.received` webhook to the Box's relay; the Box stays private
- Svix signatures checked on the Box, against the time the relay received the delivery, so a delivery held while the Box was offline still verifies
- The webhook is acknowledged first and the full message is fetched afterwards, with retry across restarts; a fetch that keeps failing is marked failed and shown, never dropped
- Mail for addresses no mailbox has is kept as `ignored` and never acted on
- Shared team mailboxes receive through a forward to an inbound alias, routed on the envelope recipient (`received_for`), never trusted, and never wake the agent
- People can trust a sender, or release one untrusted message to the agent, from Mail
- `trusted` only when the From address is in `trustedSenders` and DMARC passed at Resend's receiving server
- An `email.received` event trigger wakes the agent for trusted mail; everything else is stored and visible, never acted on

## Needs

- The email recipe, adapted and validated
- The automation relay powerup, connected (`recipes/automation/powerups/relay`)
- Resend receiving enabled for the domain, with its MX records
- The agent surface (`box.json` `workerdeck`) and an agent profile for the agent in `agentProfiles`, for the trigger

## How it works

Resend posts `email.received` (metadata only) to `https://<relay>/hook/resend/<hook key>`. The relay
hands it to the `resend` provider, which verifies the Svix signature and records
`resend.email.received`. The email server's listener stores the row as `fetching` and starts a
fetch of `GET /emails/receiving/{id}` without holding the ack. Once stored, the worker decides
`trusted` and records `email.received`; a trigger filtered on `fields.trusted = true` wakes the
agent, which reads the message with `email-read` and may answer with `email-send` (still bound by
the recipient allowlist and hourly cap).
