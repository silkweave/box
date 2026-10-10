# CRM

A lightweight CRM worked one company at a time. The account carries the relationship (lead, customer, churned); each deal carries one attempt to sell, with its own stage, value and odds. Deals, contacts, meetings, revenue and conversations sit together on each account page, with the next move pinned beside them.

## Highlights

- A totalling accounts grid and a pipeline kanban of deals over the same saved views
- Contacts, meetings with outcomes, invoice-level revenue events and an activity stream per account
- Stripe invoices (Stripe powerup): every invoice imported into the revenue ledger, attributed to its account, with its coverage window
- A markdown doc for each account, headed by the next move and its due date
- An assign queue for imported rows that could not be matched to an account
- A machine write path for the team's own sync that never overwrites human judgement

## Builds on

Core only. The Stripe powerup needs a Stripe data source from the [Data Sync](../data-sync/RECIPE.md) `stripe` powerup.
