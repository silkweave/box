# Email

A mailbox for the Box's agent: it sends and replies through Resend from its own address, keeps every message it sent and received, and, with the inbound powerup, reads incoming mail and wakes up for mail from people the team trusts.

## Highlights

- The mailbox belongs to the Box agent's account, like chat: people never connect their own email
- MCP tools to check status, list, read and send (`email-status`, `email-list`, `email-read`, `email-thread`, `email-send`), with replies threaded by `In-Reply-To` and `References`
- Guardrails on every send: a recipient allowlist (`*@domain` or exact addresses) and an hourly cap; a send to anyone else waits for a person to approve, deny, or approve and always allow it in Mail
- Shared team mailboxes (e.g. finance@): everyone reads them, agents may read them, nothing sends from them, and their mail never wakes an agent
- Inbound mail framed as untrusted content for the agent, with SPF, DKIM and DMARC results on every message
- A Mail view (each mailbox with its folders, conversations, approvals, trust and release) and a Settings page that names each missing piece and its fix
- Inbound powerup: Resend webhooks through the relay, signature-checked, fetched after the ack, and only trusted senders that pass DMARC wake the agent

## Builds on

- [Automation](../automation/RECIPE.md)

## Needs

- A Resend account with a verified sending domain, and its API key
- The Box agent account (`box.json` `agent`) with an `accounts.email` entry for it
- For inbound mail: the automation relay powerup, Resend receiving with MX records on the domain, and an agent profile for the agent in `agentProfiles`
