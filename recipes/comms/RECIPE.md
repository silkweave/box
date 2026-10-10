# Communications

The Box agent's communications with the outside world: one message store, one set of guardrails and one view for every channel. Each channel is a powerup that brings its own transport; the base keeps every message the agent sent and received, and decides who the agent may write to and who may wake it.

## Highlights

- Every channel account belongs to the Box agent, like chat: people never connect their own accounts
- MCP tools across channels to check status, list, read and send (`comms-status`, `comms-list`, `comms-read`, `comms-thread`, `comms-send`), with replies threaded on their channel
- Guardrails on every send: a recipient allowlist per channel and an hourly cap; a send to anyone else waits for a person to approve, deny, or approve and always allow it in Comms
- Decisions belong to a person at a browser, never to the agent or an API token
- Inbound messages framed as untrusted content for the agent; only trusted senders wake it, and a person can trust a sender or release one message from Comms
- Shared team mailboxes (e.g. finance@): everyone reads them, agents may read them, nothing sends from them, and their messages never wake an agent
- A Comms view (each channel's mailboxes with their folders, conversations, approvals, trust and release) and a Settings page that names each missing piece and its fix
- Channels are powerups: Email (sending through Resend) and Email inbound (receiving through the webhook relay); further channels, such as WhatsApp, come as powerups

## Builds on

- [Automation](../automation/RECIPE.md)

## Needs

- At least one channel powerup to be useful: without one, Comms says no channel is added yet
- The Box agent account (`box.json` `agent`)
