# Communications

The agents' communications with the outside world: one message store, one set of guardrails and one view for every channel. Each channel is a powerup that brings its own transport; the base keeps every message the agents sent and received, and decides who an agent may write to and who may wake it.

## Highlights

- Each agent can have its own account on each channel (an email mailbox, a WhatsApp number); where a channel offers it, a person can connect their own account (a business WhatsApp number), which is the team's like any other and never wakes an agent
- MCP tools across channels to check status, list, read and send (`comms-status`, `comms-list`, `comms-read`, `comms-thread`, `comms-send`), with replies threaded on their channel
- Guardrails on every send: a recipient allowlist per channel and an hourly cap; a send to anyone else waits for a person to approve, deny, or approve and always allow it in Comms
- Decisions belong to a person at a browser, never to the agent or an API token
- Inbound messages framed as untrusted content for the agent; only trusted senders wake it, and a person can trust a sender or release one message from Comms
- Shared team mailboxes (e.g. finance@): everyone reads them, agents may read them, nothing sends from them, and their messages never wake an agent
- A Comms view (All communications, one inbox per agent across its channels, shared mailboxes; conversations, folders, approvals, trust and release, Delegate to agent) and a Settings page that names each missing piece and its fix
- Channels are powerups: Email (sending through Resend), Email inbound (receiving through the webhook relay) and WhatsApp (a linked device per agent number or business number of a person, every chat stored, groups handled by one answering agent each)

## Builds on

- [Automation](../automation/RECIPE.md)

## Needs

- At least one channel powerup to be useful: without one, Comms says no channel is added yet
- At least one agent (`box.json` `agent`, or an agent file in `data/config/agents/`)
