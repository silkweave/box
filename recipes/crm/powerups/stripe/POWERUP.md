# Stripe invoices

Every Stripe invoice in the CRM revenue ledger: paid, open, voided and refunded, attributed to its account, with the period it pays for.

## Highlights

- One `stripe:inv:<id>` revenue event per invoice, re-asserted on every run and never duplicated
- Attribution by the account's Stripe customer id, then the payer's contact email, then the email domain; anything else waits in the assign queue
- The coverage window comes from the invoice's subscription line, so renewals walk correctly in the MRR reports
- Full refunds become `refunded` with the refund date; uncollectible invoices read as voided
- Human corrections (account, kind, coverage, notes) survive every re-run
- Non-USD invoices convert at the ECB rate of the day they were issued (and paid), from core's rate service; an invoice with no rate is skipped and named, never converted at 1.0

## Needs

- The CRM recipe
- The Data Sync `stripe` powerup ([recipes/data-sync/powerups/stripe](../../../data-sync/powerups/stripe/POWERUP.md)): a Stripe data source whose key also has read access to Invoices and Charges

## How it works

The `crm-stripe-sync` action (`features/crm/core/stripe-sync.ts`) reads `features.crm.stripe` from
`box.json`, takes the key of the named Stripe data source (`box.local.json credentials -> stripe ->
<source id> -> STRIPE_API_KEY`), lists every invoice and writes each
through the CRM's machine path (`upsertImportedRevenueEvent`). That path owns the rules: provider
columns are re-asserted, Box seeds are written once, the FX rate is frozen at first sight and
`collected_usd` is struck once at the paid day's rate.

```json
"features": { "crm": { "stripe": {
  "source": "stripe",
  "since": "2025-01-01"
} } }
```

`source` is required; `since` (YYYY-MM-DD) limits the import. USD rates come from core's ECB rate
service (docs/SIGNALS.md "Currencies"); there is nothing to configure.

`kind` is never inferred: every new row is `recurring`, and a one-off invoice without a subscription
waits in the assign queue for a human to say so.
