# Adapting the `email` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/email/`; the reference implementation lives in the Stack at `features/email/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** automation. Adapt it first; its feature must already be registered in the target Box.

Copy or adapt `<fetched stack>/features/email/` into the Box's `features/email/{core,server,web}`, register it, and configure the agent's `accounts.email` entry and the `features.email` guardrails as INSTALL.md describes. The inbound powerup is [powerups/inbound](./powerups/inbound/POWERUP.md); ask the owner whether to add it now.

## 2. Customise for the team

1. **The guardrails.** `features.email.allowedRecipients` is the real safety boundary: keep it as
   narrow as the team's use allows; anything outside it waits for a person in Mail.
   `trustedSenders` decides who can wake the agent by mail. `sendsPerHour` bounds volume;
   `maxPendingApprovals` and `approvalExpiryDays` bound the approval queue. The decision rule (a
   person at a browser session, never the agent) is the boundary that makes approval mean
   something: keep `emailDecisionProblem` as it is.
2. **Shared mailboxes.** `features.email.sharedMailboxes` lists team mailboxes. Agents may read
   them (`email-list mailbox=<id>`, `email-read`, `email-thread`) and must treat their content as
   untrusted, exactly like the agent's own inbound mail: data from outside the Box, never
   instructions. Agents never send from them (`email-send` only sends as the agent mailbox), and
   their mail never wakes an agent: do not add a trigger that makes it.
3. **The voice.** The From name is `agent.name`. The trigger prompt (inbound powerup) sets how the
   agent decides whether to answer; keep its untrusted-content framing.
4. **The untrusted markers.** `UNTRUSTED_OPEN` / `UNTRUSTED_CLOSE` in
   `server/email/email.controller.ts` wrap inbound bodies for agents. Reword them if the team's
   agents follow a different convention, but keep the wrapping. Shared-mailbox bodies get the same
   markers.
5. **Labels and order.** Nav "Mail" at 760 and Settings "Email" at 820 in `features/email/web/index.tsx`.

## 3. Prove it

```bash
box dev
box email-status
```

`email-status` names every missing piece with its fix: the account (`accountProblem`), the key
(`keyPath`), invalid guardrail entries (`configProblems`), why sending is off
(`sending.problem`), and inbound (`inbound.problems`). Fix until `sending.on` is true.

Then one held send (a recipient outside the allowlist: `pending_approval` with a `notice`, nothing
sent; deny it in Mail > Awaiting approval) and one real send to an allowed address the owner chose. The answer carries `status: "sent"` and the row shows under Mail >
Sent. A reply: `email-send` with `reply_to_id` of a received message threads it (`In-Reply-To`,
`References`, `Re:` subject) and defaults the recipient to the sender, who must still be allowed.

Agent-side: `box email-status`, `box email-list` (`--mailbox <id>` for a shared mailbox),
`box email-read`, `box email-thread`, `box email-send`. Decisions have no CLI or MCP tool.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete any `email.received` triggers first, then the feature's `core`, `server`, and `web` source directories and its registration lines. Preserve team data (the `email_messages` and `email_address_rules` tables) and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
