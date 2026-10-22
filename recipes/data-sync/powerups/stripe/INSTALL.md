# Stripe data source powerup: install

Adds the `stripe` provider to the Box's data sources and connects one Stripe account. Read
[POWERUP.md](POWERUP.md) first. Do as much as possible yourself; stop only for the owner-only steps.

## Detect

`box providers-list` includes `stripe` when the provider is registered. `box data-sources` lists
existing sources; a `stripe` source whose `credentials.STRIPE_API_KEY` is `false` needs its key, not
a new install.

## Requires

- The Data Sync recipe, adapted and validated.

## Owner decisions

Ask these together:

1. **Which Stripe account**, and whether to start in test mode (a `rk_test_` key) or live.
2. **Currencies**: nothing to choose. Amounts are reported in USD; activity in any other currency
   converts at the ECB rate of its day (docs/SIGNALS.md "Currencies").
3. **History window**: days rebuilt on every sync (default 90, up to 1095).
4. **Which measures to bind** as signals: gross volume, net volume, refunds, MRR, active
   subscriptions.

## Owner-only steps

1. **Create a restricted key** in the Stripe Dashboard (Developers > API keys > Create restricted
   key) with **Read** on Balance (balance transactions) and Subscriptions (Billing), and nothing
   else. With the CRM `stripe` powerup add **Read** on Invoices and Charges. The owner pastes it
   into `box.local.json` themselves (step 3); never into the transcript.

## Steps

1. **Source.** `box recipe fetch data-sync --version <the version in the recipes ledger of box.json>`, then copy `features/data-sync/core/stripe/`
   (`index.ts`, `provider.ts` and its test) into the Box's `features/data-sync/core/stripe/`.
2. **Register** it in `features/data-sync/core/platforms.ts`:
   `import { stripe } from './stripe/index.js'` and `stripe` in the `installedPlatforms()` list. Its
   `register` adds the provider to core's registry at boot. Restart the server.
3. **Create the source** in Settings > Data sources: provider Stripe, an id such as `stripe`
   (the id is also the credentials account) and the history. It is born disabled. The
   owner adds the key:
   ```json
   { "credentials": { "stripe": { "<source id>": { "STRIPE_API_KEY": "rk_live_..." } } } }
   ```
4. **Bind signals.** Create a signal per chosen measure from the source's measure list (the signal
   dialog prefills label, interval and accumulation). Set the unit to `USD` if wanted.
5. **Record** the powerup, with the fetched version and sha256, in the `recipes` ledger of `box.json`, the session in
   `_docs/INTEGRATION.md`. No key goes in either.

## Verify

1. Run `source-sync` with `source_id=<source id>` (Settings > Automation > Actions, or
   `box run-now --action_id source-sync --params '{"source_id":"<id>"}'`). The log names the balance
   transactions and subscriptions it read and the points written; the source row shows
   `last_sync_status: success`.
2. Compare the latest MRR and yesterday's gross volume with the Stripe Dashboard (Billing >
   Overview, Payments). MRR can differ where a plan changed inside the window (POWERUP.md).
3. Enable the source, so the scheduled `sources-sync` includes it.
4. After these checks and the validation chain pass, add `stripe` to `recipes.data-sync.powerups`
   in `box.json`.

## Remove

Disable or delete the source in Settings > Data sources (bound signals keep their points and stop
refreshing), remove its key from `box.local.json`, delete `features/data-sync/core/stripe/` and its
import and entry in `platforms.ts`, and remove `stripe` from `recipes.data-sync.powerups`. Revoke the
restricted key in Stripe.
