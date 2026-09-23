# Adapting the `crm` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is - in particular the
**Personal data** section, which is the reason this one deserves a deliberate decision rather than a
reflex. This file is how it gets into a Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/crm/`; the reference implementation lives in the Stack at `features/crm/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** data. Adapt those recipes first; their features must already be registered in the target Box. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/crm/` into the Box's `features/crm/{core,server,web}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

No shipped migrations currently. A future schema change must be a new migration. Back up data before applying any migration, stage its runner and registration first, and verify migration completion and boot compatibility on a disposable restored instance before continuing.

## 2. Customise for the team

In descending order of how wrong the defaults will be:

1. **The pipeline** - `CRM_ACCOUNT_STATUSES` in `features/crm/core/types.ts`. The
   shipped ladder is
   `stale -> meeting_requested -> meeting_booked -> demo -> proposal -> confirmed -> customer ->
   onboarding` with `at_risk` / `churned` / `lost` / `archived` as exits. Keep
   `CRM_PAYING_STATUSES` and `CRM_PIPELINE_STATUSES` in step, and check `CLOSED`/`PIPELINE_COLUMNS`
   in `features/crm/web/lib/crmView.ts` - the kanban's default columns are derived there.
2. **The deal shape** - none ships. `mrr_usd` is typed by hand; product, plan, quantity and price
   are one team's commercial vocabulary and deliberately not the foundation's (a product decision,
   2026-09-14). If this team wants MRR derived from what it sells, follow
   [Adding a deal shape](#adding-a-deal-shape-products-plans-pricing) below - second on this list
   because a wrong price table is a wrong pipeline weight on every card.
3. **The rest of the vocabularies** - sources, contact roles, meeting kinds/outcomes/sources,
   revenue providers/kinds/statuses, renewal risks, activity channels. Enum edits need no migration
   until the Box has shipped rows carrying the old values; after that, add a migration in
   `migrations.ts` that rewrites them.
4. **Who owns which column** - the `*_BOX_COLUMNS` / `*_PROVIDER_COLUMNS` lists. Moving a column
   between them is the decision "may a sync overwrite this?", and the input DTOs in
   `features/crm/server/crm/crm.controller.ts` are shaped to match, so a tool call can
   never fight a sync.
5. **The matching rules** - `identity.ts`. `LEGAL_SUFFIXES` is longest-first and currently
   Singapore/UK-flavoured (`pte ltd`, `sdn bhd`, `pty ltd`); add the forms this team's customers
   actually register under, and keep the longest-first ordering or `northwind pte ltd` collapses to
   `northwind pte`. `FREE_MAIL` is what stops a gmail address being read as a company domain.
   `matching.test.ts` pins all five rungs - change the rules, change the test.
6. **A sync**, if this team has an outreach or billing source to mirror. The template ships none -
   the predecessor's went with `relay` on 2026-09-13. Write it against the machine path, which is
   the only door that can write a provider-owned column: `upsertImportedAccount` /
   `upsertImportedContact` (`import.ts`), `upsertCrmActivity`, `upsertImportedMeeting` and
   `upsertImportedRevenueEvent`; resolve accounts through `findAccountForImport` and record the
   rung it returns; write the company's stable id to `external.company_urn` so rung 3 can find it
   next time. Keep the configuration in `<BOX_DATA_DIR>/config/<source>.json` - a `data_source_id`,
   an `actor` (a real `users.id`: a sync acting for a person stamps the person, and the record layer
   REFUSES an unknown one on every audited write, so a typo here is a failed sync, not a silent
   one), and a stage map keyed on the source's **stage id**, never its name - and the key in
   `box.local.json credentials`. Set `CRM_IMPORT_STAGES` to the stages your source reports as still
   active. No file should mean "not configured", never an error.
7. **Labels and order** - the nav label and order band (600) in
   `features/crm/web/index.tsx`; the offered grid columns, their widths, hints and footer
   aggregates in `lib/crmView.ts`; the display label maps in `crm-types.ts`.

There is no `env` to set and no seed to run.

## 3. Prove it

```bash
box dev
```

- `http://localhost:8190/crm` - the accounts board. Empty is fine on a fresh Box. **New account**
  writes a row; the sidebar shows the saved views and (once you open one) recent accounts; the
  layout toggle swaps the grid for the pipeline kanban and a card drags between status columns.
- `http://localhost:8190/crm/<account-id>` - the detail page: fields, contacts, the markdown doc
  (type in **Next move**, then check `<BOX_DATA_DIR>/docs/crm/<account-id>.md` on disk - the heading
  and the prose are really there, and the row's `next_action` now matches), the conversation stream,
  the meetings panel and the money panel.
- `http://localhost:8190/crm/queue` - the assign queue. Empty until a sync writes an unattributed
  row, a past meeting is still `scheduled`, or a paid recurring row has no coverage window.

Agent-side, the same surface is MCP:

```bash
bun run cli crm-accounts
bun run cli crm-account-upsert   # create or patch a company
bun run cli crm-contact-upsert   # a person at it
bun run cli crm-meetings         # filtered, newest first
bun run cli crm-revenue-events
bun run cli crm-assign-queue     # everything a sync could not decide
bun run cli crm-doc-read / crm-doc-save
bun run cli crm-activities / crm-activity-log / crm-activity-delete
```

Seventeen tools in total (every procedure except `crmDocRegionsSave`, which is the dashboard's
region autosave and deliberately has no MCP name). Remember what comes back: `crm-accounts` returns
real people's names and emails. They must never land in a public-facing draft.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Adding a deal shape (products, plans, pricing)

The foundation stores `crm_accounts.mrr_usd` as a number somebody typed. It carries no product,
plan, quantity or price column and no price list: those are one team's commercial vocabulary, and
the template shipped one company's - two product lines, eight plan names, a USD list - until
2026-09-14, when it was decided that the CRM ships the foundation and the deal shape is an optional
spec a team implements on top of it, on demand. This section is that spec. The running example is a
hypothetical team selling two product lines, `platform` and `managed`, on a few billing terms.

### Two axes, on purpose

**Product is WHAT they buy; plan is HOW they are billed.** Keep them as two columns. Fold them into
one (`platform_monthly`, `managed_annual`, ...) and the list multiplies with every new term, a plan
comes to mean a billing term for one product and a package tier for the other, and "the managed
tier, billed quarterly" becomes inexpressible without minting a new value. Two axes means every
plan belongs to exactly one product (the price table says which) and the term is a property of the
plan. A plan from the other product's list on an account is always a mistake and a silent one - it
would derive a plausible number off the wrong price list - so the write path refuses it.

### Why derive MRR instead of typing it

`mrr_usd` exists so the pipeline can be sorted and weighed. Once a deal has a shape, the shape IS
the number: `quantity x unit price / months in the term`. Deriving it in one place, on write, is
what stops three roundings of one price landing in one column - in the predecessor's book the same
price entered by hand three times sat as 332, 332.3 and 332.33, which no report can group on. The
rules that follow:

- **Derived wins over a passed `mrr_usd`, by design.** When the shape can imply a number, whatever
  was typed alongside is ignored, and the UI shows MRR read-only exactly then - an editable box
  would accept a value the server discards, so the edit would silently revert.
- **When the shape cannot imply a number** - no plan, or a custom plan with no price set - the
  derivation returns null and the typed `mrr_usd` survives untouched. That is what keeps every row
  predating the shape exactly as it was.
- **A discount is derived, never stored**: `1 - unit_price / list_price`. Storing it is a second
  copy of the price waiting to drift.
- **Round to cents once, at the end**: `Math.round((quantity * unit) / months * 100) / 100`, with
  `quantity ?? 1` and `unit ?? listUsd`. A `listUsd: null` plan (custom pricing) must carry an
  explicit unit price or derive nothing.

### The checklist

An enum column crosses six places. This is the list, in the order that keeps the tree
type-checking between steps; `box verify` catches a miss in the first four, the last two only
show in a browser.

1. **The core vocabulary** - `features/crm/core/types.ts`. The unions and their
   arrays (`CrmAccountProduct` / `CRM_ACCOUNT_PRODUCTS`, `CrmAccountPlan` / `CRM_ACCOUNT_PLANS`),
   a `CRM_PLAN_PRICING: Record<CrmAccountPlan, { product; months; listUsd: number | null }>`
   table, and `deriveMrrUsd()` / `planDiscountPct()` as pure functions over
   `{ quantity, plan, unit_price_usd }`. Add the fields to `CrmAccount` and `CrmAccountInput`, and
   the column names to BOTH `CRM_ACCOUNT_BOX_COLUMNS` and `CRM_ACCOUNT_FUTURE_PROVIDER_COLUMNS` - a
   billing provider knows quantity, interval and price, and declaring that now is what stops a
   hand-maintained shape being silently overwritten the day it connects.
2. **The ModelSpec** - `models.ts`, `CRM_ACCOUNTS.columns`:
   `product: { kind: 'text', default: "'platform'", enum: CRM_ACCOUNT_PRODUCTS }`,
   `plan: { kind: 'text', nullable: true, enum: CRM_ACCOUNT_PLANS }`,
   `quantity: { kind: 'int', nullable: true }`, `unit_price_usd: { kind: 'float', nullable: true }`.
   The `enum` is the app-level CHECK constraint, and it is checked on the values a WRITE passes,
   never on read and never on what is already stored: a row carrying a value the list no longer
   names reads back fine, and `upsertCrmAccount` - which re-sends every column it resolves - refuses
   it on that row's next edit until the value is fixed, while the narrow doc-cache upsert in
   `saveCrmDoc` does not (which is why it is narrow). A fresh Box gets the columns from the
   baseline; **a Box that already has `crm_accounts` does not** - the baseline is `CREATE TABLE IF
   NOT EXISTS` - so also append the feature's first migration to `manifest.ts`
   (`{ name: '001-deal-shape', statements: ['ALTER TABLE crm_accounts ADD COLUMN IF NOT EXISTS product TEXT DEFAULT \'platform\'', ...] }`,
   one ALTER per column). Two DuckDB facts shape that statement, both measured on 2026-09-14: `IF
   NOT EXISTS` is honoured, so the same ALTER is safe to re-run; and `ADD COLUMN` refuses a
   constraint ("Adding columns with constraints not yet supported"), so write `DEFAULT` without
   `NOT NULL` - the NOT NULL in the ModelSpec holds on fresh Boxes, and on older ones the record
   layer writes every column explicitly anyway, so a null never lands. `bun run schema:check` (a
   diagnostic; run it yourself, `verify` does not) proves the migration applies fresh, on reboot,
   and onto a Box that enabled `crm` later, and warns if it touches a table outside `crm_*`.
3. **The resolve-before-write block** - `state.ts`, `upsertCrmAccount`, at the comment that names
   itself as the seam. Resolve each new column the way the pause window is resolved
   (`input.x !== undefined ? input.x : (prev?.x ?? default)`), refuse a plan whose product is not
   the account's, then
   `const mrr = deriveMrrUsd({ quantity, plan, unit_price_usd }) ?? (input.mrr_usd !== undefined ? input.mrr_usd : (prev?.mrr_usd ?? null))`,
   and write the new columns in the `upsertRecord` call. Refuse a negative quantity beside the
   negative-MRR guard.
4. **The controller DTOs** - `features/crm/server/crm/crm.controller.ts`. On
   `CrmAccountDto` an `@ApiProperty({ enum: CRM_ACCOUNT_PLANS })` per enum column; on
   `UpsertCrmAccountDto` an `@ApiProperty` plus `@IsOptional() @IsIn(CRM_ACCOUNT_PLANS)` per enum
   column, `@IsInt()` / `@IsNumber()` for the numbers. The description is what an agent reads over
   MCP, so say there that setting a plan makes `mrr_usd` derived and a passed value is ignored.
   `bun run typegen` (part of `verify`) then rewrites `apps/web/src/generated/appRouter.d.ts`.
5. **The web mirror** - `features/crm/web/crm-types.ts` is hand-written on purpose
   (`apps/web` does not depend on `@silkweave/box-core`): the same unions and arrays, a
   `CRM_ACCOUNT_PRODUCT_LABEL` / `CRM_ACCOUNT_PLAN_LABEL` map for the selects, the price table
   again, a `plansForProduct()` filter, and copies of `deriveMrrUsd` / `planDiscountPct` so the
   detail page can explain the number it shows. Add the fields to `CrmAccount` there and to
   `CrmAccountUpsert` in `lib/useCrmData.ts`.
6. **The UI control** - `views/CrmAccountDetailView.tsx`, the Deal card. A product select; a plan
   select over `plansForProduct(account.product)` with a sentinel item for "no plan" (the select
   needs a real value, null does not travel), where switching product clears a plan that no longer
   belongs because the server would refuse it; quantity and unit-price inline edits (the placeholder
   shows the list price); and the MRR field switching to a read-only figure with a "derived" badge,
   the discount, and the arithmetic spelled out whenever `deriveMrrUsd(account)` is non-null.
   Optionally a column and footer aggregate in `lib/crmView.ts` (`CRM_COLUMNS`).

Then the test. `accounts.test.ts` already pins what the seam does without a shape (a typed
`mrr_usd` survives every unrelated write, to the cent); add three pins beside it: a plan plus a
quantity stores the derived `mrr_usd` and ignores a passed one; a row with no plan keeps its typed
value across a later, unrelated write; and a plan from the other product's list is refused. The
third is what makes the two axes safe.

### If the list should be data rather than code

The recipe above compiles the vocabulary in, which is right for a list that changes when the
pricing page does. If this team's list changes more often than that - a new tier every quarter, a
partner rate per region - copy the planning feature's precedent instead: `box.json features.planning.initiativeKinds`,
read by `features/planning/core/kinds.ts`. Its header states the argument in full; the
short version is that the built-ins survive as a SEED rather than a floor (a `seeded` flag, so a
deleted entry stays deleted instead of being helpfully restored by the next read), ids are
immutable because they are stored on rows, and the ModelSpec's `enum` becomes a THUNK
(`enum: () => planIds()`) so the write-time gate reads whatever the team's list says at write time
rather than what it said at import time. The price table then lives in the same file, the UI reads
it through a query instead of a compiled map, and a stored row can name a plan the file no longer
lists - which reads back fine and is refused on that account's next edit - so copy planning's
delete guard too and refuse to remove a plan an account still carries.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
