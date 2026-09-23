# crm gotchas

CRM vocabulary and matching rules are team-facing customizations. Preserve local statuses, ownership rules, and personal-data decisions while adapting source.

The feature id (`crm`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **Two write paths, and the human one is the narrow one.** `upsertCrmAccount` /
  `upsertCrmContact` / `upsertCrmMeeting` / `upsertCrmRevenueEvent` cannot express a provider-owned
  or structural column at all. A sync uses `import.ts`, `upsertImportedMeeting`,
  `upsertImportedRevenueEvent`, `upsertCrmActivity` - library functions with no MCP tool. If you
  need a sync to write something, widen the machine path, never the tool DTO.
- **`crm_accounts.mrr_usd` is not a finance number.** It is the operator's hand-maintained pipeline
  weight. Do not sum it into anything presented as revenue; `crm_revenue_events` is the sales-side
  money view, and the books live elsewhere.
- **Coverage windows are stored, not derived.** `covers_from` / `covers_to` exist because computing
  them from `paid_at + period_months` manufactures fake churn and fake new business on every late
  renewal. Likewise `amount_usd` is frozen at `issued_at`'s rate and `collected_usd` is a second
  column at `paid_at`'s rate - never rewrite the first when a row is paid. A refund is a status
  change plus `refunded_at`, never a negative row.
- **No machine may write `no_show`.** `scheduled` on a past meeting is an open question, not a
  state, and the assign queue is the only place it can be closed. A sync writing `scheduled` never
  overwrites `held`.
- **An account id is also a filename.** `accountSlug()` is tighter than core's `assertValidId` -
  `^[a-z0-9][a-z0-9-]*$` - because `docs/crm/<id>.md` must be a legal path. Generate ids through it,
  or the doc route 400s on an account nobody can open.
- **The doc format is position-anchored.** `## Next move` counts only as the first content line
  after any frontmatter; anything unrecognizable degrades to "no next action, all of it is notes"
  and never truncates the user's prose. Do not swap the ATX headings for an HTML comment - it was
  measured, and TipTap drops comments on round trip.
- **The editor chunk is lazy.** Import `CrmAccountDocLazy`, never `CrmAccountDoc` directly, or the
  accounts board pulls TipTap in with it.
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope, and load the app in a browser after touching it - `box verify` has no runtime step
  (`AGENTS.md`).
- **Dev ports are 8190 / 5190.** `:8090` is the predecessor engine, still running beside this
  template's development Box; a Box on that port collides with it or, worse, gets mistaken for it.
- **Export `LC_ALL=en_US.UTF-8` before grepping this feature.** `identity.ts` contains non-ASCII
  escapes and several files carry non-ASCII bullets; macOS grep silently skips any file with a
  non-ASCII byte.
- **After a controller change, boot once (or `bun run typegen`)** so `appRouter.d.ts` is rewritten, or
  the web typecheck is stale.
