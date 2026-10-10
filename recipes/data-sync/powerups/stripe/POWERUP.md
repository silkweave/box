# Stripe data source

Revenue signals from the team's Stripe account: a `stripe` provider for data sources, so gross volume, net volume, refunds, MRR and active subscriptions become signals with history on the boards.

## Highlights

- One data source per Stripe account, created in Settings > Data sources, with its own restricted read-only key
- Five measures: gross volume, net volume and refunds per day (from balance transactions), MRR and active subscriptions per day (rebuilt from subscriptions)
- Every sync rebuilds a configurable window (default 90 days, up to three years), so the first sync is also the backfill
- Reports in USD; activity in any other currency converts at the ECB rate of its own day, named in the run log, with the rates kept in the audit snapshot
- Bound signals only: an unbound measure is never fetched

## Needs

- The Data Sync recipe
- A Stripe account and an owner who can create a restricted API key

## How it works

The provider lives at `features/data-sync/core/stripe/provider.ts`. The platform descriptor in
`features/data-sync/core/stripe/index.ts` has no actions and no derivers; its `register` calls core's
`registerProvider(stripeProvider)` at boot, and its entry in `features/data-sync/core/platforms.ts`
is what installs it. Like every provider it is a pure fetcher: it reads the source's
`history_days`, calls Stripe with the key from
`box.local.json credentials -> stripe -> <source id> -> STRIPE_API_KEY`, and returns daily points;
core's data source sync writes them into the bound signals and keeps a trimmed audit snapshot (ids,
amounts and dates, no customer details). Data sources are core: see
[docs/SIGNALS.md](../../../../docs/SIGNALS.md).

MRR counts `active` and `past_due` subscriptions after their discounts, normalised to a month, and
excludes trials. It is rebuilt for every day of the window from each subscription's start, trial
end and end dates at its current price, so MRR before a plan change reads at the new price. A
one-time coupon does not lower MRR.

Invoice-level revenue in the CRM is the CRM recipe's `stripe` powerup, which reads the same key.
