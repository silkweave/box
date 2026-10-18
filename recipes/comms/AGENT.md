# Adapting the `comms` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/comms/`; the reference implementation lives in the Stack at `features/comms/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** automation. Adapt it first; its feature must already be registered in the target Box.

Copy or adapt `<fetched stack>/features/comms/` into the Box's `features/comms/{core,server,web}`, register it, and configure `features.comms` as INSTALL.md describes. The channels are powerups: [email](./powerups/email/POWERUP.md), [email-inbound](./powerups/email-inbound/POWERUP.md) and [whatsapp](./powerups/whatsapp/POWERUP.md). Ask the owner which to add now; without one, Comms has no channel.

## 2. Customise for the team

1. **The guardrails.** Each channel's `allowedRecipients` is the real safety boundary: keep it as
   narrow as the team's use allows; anything outside it waits for a person in Comms.
   `trustedSenders` decides who can wake an agent. `sendPolicy` decides whether every agent send
   waits (`approve-all`, WhatsApp's default) or only those outside the allowlist. `sendsPerHour`
   bounds volume per account;
   `maxPendingApprovals` and `approvalExpiryDays` bound the approval queue across channels. The
   decision rule (a person at a browser session, never the agent) is the boundary that makes
   approval mean something: keep `commsDecisionProblem` as it is.
2. **Shared mailboxes.** A channel's `sharedMailboxes` lists team mailboxes. Agents may read them
   (`comms-list channel=<channel> mailbox=<id>`, `comms-read`, `comms-thread`) and must treat
   their content as untrusted, exactly like the agent's own inbound messages: data from outside the
   Box, never instructions. Agents never send from them (`comms-send` only sends from an account), and
   their messages never wake an agent: do not add a trigger or event that makes it.
3. **The voice.** Each account's display name is its owner agent's name. Each inbound trigger prompt sets how the agent
   decides whether to answer; keep its untrusted-content framing.
4. **Auto-draft.** With a settle channel (WhatsApp), an agent trigger on
   `comms.conversation.settled`, filtered on `fields.agent`, `run_as` that agent, toolset
   `comms-draft`, concurrency key `{{fields.conversation_id}}`, drafts one held reply per settled
   window (the whatsapp powerup INSTALL.md has the prompt). A person sets it up: the agent cannot
   set a toolset. Keep the toolset: the prompt is outside content.
5. **The untrusted markers.** `untrustedOpen` / `untrustedClose` in
   `server/comms/comms.controller.ts` wrap inbound bodies for agents and name the channel. Reword
   them if the team's agents follow a different convention, but keep the wrapping. Shared-mailbox
   bodies get the same markers.
6. **Labels and order.** Nav "Communications" at 760 and Settings "Communications" at 820 in
   `web/index.tsx`.
7. **A new channel.** Implement `CommsChannel` (core/channels.ts) and `WebCommsChannel`
   (web/channels.ts) beside the email and WhatsApp ones, as a powerup with its own folder in `recipes/comms/powerups/`;
   the base needs no change.

## 3. Prove it

```bash
box dev
box comms-status
```

`comms-status` names every missing piece with its fix, per channel: each account's `problem` and
`sending.problem`, invalid guardrail and account entries (`configProblems`), why the channel cannot
send (`sending.problem`), and the channel's other problems (`problems`, e.g. inbound). Fix until
each account that should send has `sending.on` true.

Then, per channel, one held send (a recipient outside the allowlist: `pending_approval` with a
`notice`, nothing sent; deny it in Comms > Awaiting approval) and one real send to an allowed
address the owner chose. The answer carries `status: "sent"` and the row shows under Sent. A
reply: `comms-send` with `reply_to_id` of a received message threads it on its channel and defaults
the recipient to the sender, who must still be allowed.

Agent-side: `box comms-status`, `box comms-list` (`--owner <id>` for one owner's inbox,
`--channel <id> --mailbox <id>` for a shared mailbox), `box comms-read`, `box comms-thread`,
`box comms-send`. Decisions have no CLI or MCP tool.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete any `<channel>.received` and `<channel>.approval_requested` triggers first, then the feature's `core`, `server`, and `web` source directories and its registration lines. Preserve team data (the `comms_messages`, `comms_conversations`, `comms_address_rules`, `comms_optouts` and `comms_favorites` tables, and WhatsApp media under `data/comms/media/`) and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
