# engagement gotchas

Pods configuration and draft skills are team workflow customizations. Preserve local routing and review rules before adapting source.

The feature id (`engagement`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **A poll that records nothing may simply be unwanted.** The GitHub and traction polls skip
  while no enabled event trigger listens for `github.notification` / `traction.spike` (core's
  `eventWanted`); without Automation nothing listens, so they always skip.
- **Polls flush delivery at the end.** Each calls core's `flushDeliveries()`, so a batch goes out
  at once; without Automation's Alerts powerup that is a no-op and the summary says "no delivery in
  this Box".
- **No `pods.json`, no cards.** A channel absent from `channels` expects nothing, so the piece
  produces no card at all, silently. Same for a paused/archived pod and for a piece older than
  `windowDays`.
- **Cards are derived, engagements are stored.** The only way to change the queue is to write a
  `pod_engagements` row (or move the piece/member/config). A `draft` row is the exception: it does
  NOT clear the card, it hangs the member's pre-written comment on it.
- **A draft must never downgrade a verified row.** `podsEngagementDraft` refuses when a `verified`
  engagement already exists, and an empty draft only ever deletes a `draft` row. If you add a
  write path, keep both guards - the rows carry karma and evidence.
- **Ambiguity is `unknown`, never `confirmed`.** A false positive corrupts the karma ledger
  permanently; a false negative costs one more click. Any new strategy inherits that rule.
- **The browser strategies need a real, logged-in session** on a machine running chromatrix. An
  unreachable browser is an `unknown` verdict with a message, not an exception - do not "fix" that
  by throwing.
- **Two identities on one screen.** The topbar karma badge is principal-scoped
  (`podsSelfKarma`); the engage-queue follows the ACTIVE user from the top-right menu. They
  legitimately disagree while impersonating.
- **`PodsSelfController` takes identity from the request principal only.** Never accept a
  participant id from the client on a `self/*` route.
- **Inbox item ids are the contract.** `inbox-map.ts` must keep minting the same ids as the
  snapshot path in `build.ts`, or one engagement becomes two items with two state rows and an
  alert card's deep link lands on nothing.
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope there, and load the app in a browser after touching it (`AGENTS.md`).
- After a controller change, boot once (or `bun run typegen`) so `appRouter.d.ts` is rewritten, or
  the web typecheck is stale against the 23 procedures.
