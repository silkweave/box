# Stripe invoices powerup: install

Imports Stripe invoices into `crm_revenue_events`. Read [POWERUP.md](POWERUP.md) and the CRM
[GOTCHAS.md](../../GOTCHAS.md) first. Do as much as possible yourself; stop only for the owner-only
steps.

## Detect

`crm-stripe-sync` in Settings > Automation > Actions exists when the action is
registered. Revenue events with ids starting `stripe:inv:` mean a previous import ran.

## Requires

- The CRM recipe, adapted and validated.
- The Data Sync `stripe` powerup (`recipes/data-sync/powerups/stripe`), verified, with a Stripe
  data source (Settings > Data sources).

## Owner decisions

1. **Which Stripe data source** supplies the key (its id goes in `features.crm.stripe.source`).
2. **Start date** (`since`), or all invoices.
3. **HubSpot cutover**, when invoices also arrive from HubSpot: which era supersedes the other.

## Owner-only steps

1. **Extend the restricted key** with **Read** on Invoices and Charges (Stripe Dashboard,
   Developers > API keys, edit the key).
2. **Stripe customer ids on accounts**: the strongest match. The owner (or the agent, with
   consent) sets `stripe_customer_id` on each customer account (`crm-account-upsert`).

## Steps

1. **Source.** `box stack fetch --ref <sha>`, then copy `features/crm/core/stripe-sync.ts` (and its
   test) into the Box. Add `export * from './stripe-sync.js'` to `features/crm/core/index.ts` and
   the `crm-stripe-sync` action to `features/crm/core/manifest.ts`. Add `'customer_id'` to
   `CrmRevenueMatchedBy` and `CRM_REVENUE_MATCHED_BY` in `core/types.ts` and `web/crm-types.ts`
   (an app-level enum; no migration).
2. **Configure** `features.crm.stripe` in `box.json` (POWERUP.md).
3. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md`, the session in
   `_docs/INTEGRATION.md`.

## Verify

1. Back up the warehouse (`box warehouse-backup`) before the first run.
2. Run `crm-stripe-sync` (`box run-now --action_id crm-stripe-sync`). The summary counts new, updated and unchanged rows, the assign-queue
   size and anything skipped. A second run reports every row unchanged.
3. Spot-check three invoices against the Stripe Dashboard: amount, status, paid date, coverage.
4. Work the assign queue; set `stripe_customer_id` on accounts so the next import matches them.
5. Optionally schedule it daily (a time trigger on `crm-stripe-sync`).
6. After these checks and the validation chain pass, add `stripe` to `recipes.crm.powerups`.

## Remove

Remove the trigger, the action and `features.crm.stripe`. Imported rows stay; delete them only
deliberately (`provider = 'stripe'`), since they may carry human corrections.
