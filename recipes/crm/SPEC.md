# `crm` - accounts, deals, contacts, meetings, revenue, activities

The pipeline, worked one company at a time. An **account** is a company, and its `status` carries
the RELATIONSHIP, so Lead, Customer and Churned are three values of one column rather than three
tables. A **deal** is one attempt to sell to an account - a pilot, a renewal, an upsell, a second
try after a loss - with its own stage, value, odds and close date, so the pipeline board is a board
of deals and closing one never rewrites another's history (split out of the account on 2026-09-28;
until then the account was the deal). Around them sit the **contacts** (the humans at that company), the **meetings** (future appointments with an outcome),
the **revenue events** (invoices and payments, at the grain of the invoice) and the **activities**
(messages exchanged, append-only). Two write paths run side by side: a human one that physically
cannot express a provider-owned column, and a machine one (`import.ts`, `upsertImportedMeeting`,
`upsertImportedRevenueEvent`, `upsertCrmActivity`) that re-asserts provider columns on every run and
never overwrites a human's judgement. Rows the machine cannot attribute are written anyway and land
in the **assign queue**, because a row written nowhere visible is a row lost.

- **dependsOn**: nothing. Everything it shares comes from core, all on the WEB side:
  `BoardKanban` from `@silkweave/box-ui/board`, core's saved views (`ViewBar` / `ViewBarSpec` from
  `apps/web/src/presets/ViewBar.tsx`, `createViewStore` / `ViewStore` from
  `apps/web/src/presets/boardView.ts`, `presetIcon` from `apps/web/src/presets/presetIcons.tsx`;
  `docs/SIGNALS.md`, "Saved views") and `useDataSources`
  (`apps/web/src/signals/lib/useSourcesData.ts`, which labels a contact's origin on the detail
  page). Nothing in `features/crm/core` or `features/crm/server` imports another feature. The
  `stripe` powerup reads the key of a Stripe data source, which the Data Sync `stripe` powerup
  provides.
- **Depended on by**: nothing in the Stack today. A feature that builds on the CRM plugs in through
  its extension points (**Extension points** below) without the CRM importing it. Since `relay` was removed on 2026-09-13, `relay` was the
  predecessor's webhook glue and the only caller of its outreach-tool sync; both went in the same
  commit. **The template ships no sync at all** - the machine write path above is the door a team's
  own sync calls into (see `AGENT.md` § 2, item 6).

## Tables

Seven, all prefixed `crm_`. The prefix is load-bearing: it is what keeps "no `crm_*` table is ever
publicly reachable" a greppable, scannable claim. Every table carries `timestamps: true` and
`audit: true`, so the record layer manages `created_at` / `updated_at` and `created_by` /
`updated_by` (from the call's `actor`) on top of the declared columns.

| table | pk | what it holds |
|---|---|---|
| `crm_accounts` | `id` (a slug, `acme-uk`) | one company. `status` (the relationship), `owner`, `source`, `referral_partner`, `mrr_usd` (what the customer pays per month today as the operator knows it, **not** a finance number), `waiting_on`, `next_action(_at)`, `last_contacted_at`, subscription window, `website`, `tags`, `notes`, pause window, the renewal-risk triple, the three external links (`stripe_customer_id`, `supabase_space_id`, `whatsapp_group_jid`), an `external` JSON bag and the derived `name_key` |
| `crm_deals` | `id` (a slug, unique across accounts) | one attempt to sell to an account: `account_id`, `name`, `stage`, `owner` (falls back to the account's for display), `mrr_usd` (what it would be worth per month - an estimate, typed rather than derived, see **What a team customises**), `close_probability`, `expected_close_at`, `closed_at` and `loss_stage` (stamped on the stage move), `loss_reason`, `notes`, and a reserved `external` bag |
| `crm_deal_stage_changes` | `id` (`<deal id>:<uuidv7>`, so ids sort in write order) | one stage row of one deal, append-only (a creation row with from = to, then one move per change): `deal_id`, `account_id`, `from_stage`, `to_stage`, `owner` (whose pipeline moved: the deal's owner at the time, else its account's), `changed_at`; `created_by` is who made the move. What pipeline analytics read |
| `crm_contacts` | `id` (the source's lead id verbatim, or a slug) | one human at exactly one account: `account_id`, `name`, `headline`, `email`, `phone`, `linkedin_url`, `role`, `is_primary` (int 0/1, at most one per account), `external_stage`, `tags`, `notes`, the derived `linkedin_key`, `last_activity_at` |
| `crm_meetings` | `id` (idempotency IS the pk; machine rows are namespaced, e.g. `gcal:<event>`) | one sales conversation with a lifecycle: `account_id`/`contact_id` (nullable - null means the assign queue), `kind`, `scheduled_at`, `duration_min`, `outcome`, `rescheduled_count`, `source`, `meet_code`, `attendee_email`, `title`, `matched_by`, `notes`, `external` (organizer, attendees, transcript path, `rescheduled_from[]`) |
| `crm_revenue_events` | `id` (namespaced, `hubspot:inv:...` / `stripe:inv:...`) | one money event at invoice grain: `account_id` (nullable = queue), `provider`, `kind`, `status`, `amount` + `currency` + `amount_usd` (frozen at `issued_at`'s rate) + `collected_usd` (struck once, at `paid_at`'s rate) + `fx_rate`/`fx_rate_month`, `issued_at`/`due_at`/`paid_at`/`refunded_at`, `period_months` and the **stored** coverage window `covers_from`/`covers_to`, `payer_email`, the external invoice/payment/subscription ids, `invoice_number`, `superseded_by`, `description`, `matched_by`, `notes` |
| `crm_activities` | `id` (`<provider>:msg:<message id>` for synced rows, `manual:<uuid>` for hand-logged ones) | one message exchanged with a contact: `account_id` (denormalized from the contact on purpose), `contact_id`, `channel`, `direction`, `occurred_at`, `body`, `subject`, `thread_id`/`thread_index`, `message_type`, `interaction_type`, `author_name`, `campaign_id`/`campaign_name`, `external` |

**Deleting an account CASCADES to its deals**, and **deleting a parent CASCADES to its activities** (2026-09-14), and it is the other half of the
"a synced row cannot be hand-deleted" refusal: `readCrmActivities` only ever queries by
`account_id`, so a row left behind by a parent delete is INVISIBLE, and the per-row delete refuses
synced rows, so it is also PERMANENT - with no backfill able to re-create it either. Both
`deleteCrmContact` and `deleteCrmAccount` therefore drop them by raw DELETE inside the same write,
and both reports carry `activities_deleted` plus a warning naming the count; the account report
also carries `deals_deleted`.

**Deal stage moves carry three rules** (`deals.ts`): the move into `won` or `lost` stamps
`closed_at` today unless one is passed, and re-opening clears it; the move to `lost` remembers the
stage it left as `loss_stage`; and a win promotes a `lead` (or a `lost` / `churned` account being
won back) to `customer`. That promotion is the only automatic account-status move, and it only ever
moves an account INTO the paying base.

**Every stage change is recorded** (`crm_deal_stage_changes`). Creating a deal writes a creation
row (`from_stage` = `to_stage` = its first stage), so a deal created straight into `confirmed` or
`won` still dates its entry into that stage. Each later `upsertCrmDeal` that changes a deal's stage
appends a move: deal, account, from and to stage, the owner, `changed_at` and the audit
`created_by`. A move never has from = to (`isCreationRow`), so move counts and the deal history
skip creation rows ("Created as <stage>"). A write that keeps the stage records nothing. Deals that
predate creation rows get one from migration `crm:001-stage-change-creation-backfill`, dated
`closed_at` for won or lost deals, else `created_at`. Deleting a deal deletes its rows (a deal
deleted as a mistake must not count as pipeline work), and deleting an account deletes its deals'
rows. The table and column names are fixed, so a Box that already carries this history keeps it.
**New MRR signed is a derived signal** (`new-mrr.ts`, registered as the CRM signal `derive` in
`crm.module.ts`, run by `warehouse-derive`). `crm.new_mrr_signed` on the `crm` channel totals, per
team week (Monday start, box.json `timeZone`), the `mrr_usd` of each deal in the week of its first
entry into `confirmed`, or into `won` (dated by `closed_at`) when it never passed `confirmed`. Every
week from the first signed one to the current one gets a point, zeros included.
**Deals entering a stage is an in-Box measure** (`core/measures.ts`, registered with
`registerMeasure` in `crm.module.ts`; docs/SIGNALS.md, "In-Box measures"). `crm.deals_entered
{ stage, owner? }` counts, per team day, the stage-history rows whose `to_stage` is the stage
(creation rows included, so a deal created in the stage counts), optionally only one owner's. A
signal or a planning goal binds it with `measure_key` and `measure_params`; deal writes and deletes
refresh the bound signals, and `warehouse-derive` recomputes them.

A new table needs no migration: `ensureSchema()` creates it from its `ModelSpec` on the next boot.

**Baseline DDL: none.** The tables are created from the `ModelSpec`s by `ensureSchema()`; the one
migration (`001-stage-change-creation-backfill`) is data only, and there is no bootstrap SQL, no index declaration and no DDL
foreign key (the warehouse has none anywhere; `account_id` integrity is enforced in the domain, in
`upsertCrmContact` / `upsertCrmMeeting`).

## Files on disk

`data/docs/crm/<account-id>.md` - the account's prose, one file per account, path a pure
function of the (already slug-shaped) id and re-checked to stay inside the base dir. The format is
two ATX sections: a `## Next move` block that must be the first content line after any frontmatter,
and `## Notes` (or any later level-1/2 heading) for the rest. Headings, rather than an HTML comment
delimiter, because TipTap measurably drops comments on round trip (`docs.ts` records the
measurement, 2026-08-26). `crm_accounts.next_action` and `crm_accounts.notes` are **derived caches**
of that file, refreshed on every doc write so the kanban card and the table sort have something
queryable. The next move belongs to the ACCOUNT, not to a deal: it is about the company, and a board
card shows its account's next move.

Nothing else. A sync a team writes keeps its own configuration under `data/config/` and
its secrets in core's `box.local.json credentials`, the way every other integration does.

## Four rules with reasons behind them

Salvaged on 2026-09-13 from the pre-split `docs/CONTENT.md`, which is gone. Each was learned the
expensive way.

**Primary contact is a FLAG on the contact (`is_primary`), never a pointer on the account.** A
pointer dangles on every contact delete and needs a fixup nobody remembers to write; a flag dies
with the row it describes. Three invariants, all in `state.ts`: the first contact of an account
becomes primary automatically, promoting one demotes every sibling in a single statement, and
deleting or re-parenting the primary promotes the oldest remaining contact and says so in the
delete report. An account with people and no primary is a silent broken state nothing surfaces,
which is why the promotion is automatic rather than a prompt.

**`status: 'archived'` is the honest "remove"; delete is for mistakes.** The rows never leave, which
is what makes "never re-import someone a human archived" true by construction: an archived account's
contacts still match and still refresh, they just emit no events and are hidden by default. A delete
cascades to the contacts, and any contact still active upstream comes back attached to a BRAND NEW
account with a re-seeded status, so owner, MRR, next action and notes are gone for good. The
account's markdown file is left on disk by a delete, the way planning docs are, so the prose is
recoverable even though the row is not.

**Do not pick a markdown delimiter for a WYSIWYG doc without round-tripping it through the actual
editor first.** The first attempt at the account doc used an HTML-comment sentinel, chosen because
`docSummary` already skips comments. Driving the real TipTap editor showed the comment is parsed and
DROPPED: one keystroke deleted the delimiter and the whole doc collapsed into notes with
`next_action` silently wiped. A probe of six candidates settled it: ATX headings, bold lines and
blockquotes survive byte-identical; `<!-- comment -->` and `[//]: # (ref)` are eaten. Parsing is
position-anchored (only a leading opener counts, so a `## Next move` typed inside the notes cannot
re-partition the file) and anything unrecognisable degrades to "no next action, all of it is notes"
without dropping a byte. The two headings are rendered as static chrome OUTSIDE both editors:
structure the editor never contains is structure the user cannot delete or mangle.

**When a deal has a shape, the shape wins over a typed MRR.** The foundation ships no shape -
product, plan, quantity and price are one team's commercial vocabulary, not the CRM's (a product
decision, 2026-09-14) - and stores the deal's `mrr_usd` as typed. The rule to carry over when a team adds one
(`AGENT.md` § "Adding a deal shape"): `mrr_usd` becomes DERIVED and a passed value is ignored, and
the UI shows MRR read-only exactly when something derives it, because an editable box would accept
a value the server discards and the edit would silently revert. Clear the plan and the box comes
back.

## Personal data

**This feature holds real people's data. Say it out loud before installing it.**

| table | categories |
|---|---|
| `crm_contacts` | full name, job headline, **email address**, **phone number**, LinkedIn profile URL, free-text notes about the person |
| `crm_activities` | the **body of real messages** (LinkedIn DMs, InMail subjects, hand-logged calls, emails and letters), who sent them, when, and under which campaign |
| `crm_meetings` | `attendee_email` kept **raw** (it is the matcher's input, and an unmatched row must stay re-matchable once a contact later gains an email), meeting titles, notes, organizer and attendee list in `external` |
| `crm_revenue_events` | `payer_email` raw, invoice numbers and amounts |
| `crm_accounts` | company-level, but `referral_partner` is a named human ("Sam at Acme"), `notes` is free text, and the docs on disk are prose about people |

Access is internal users only: `@Controller('crm')` carries a bare `@UseGuards(AuthGuard)`, so
collaborators are denied by the guard's deny-by-default, and over MCP the transport demands a
user-role bearer. Agents reading `crm-accounts` get real names - those must never reach a
public-facing draft.

**Removing the feature does NOT drop the tables** (`docs/core/SEAM.md` § 3.4: the data is the tenant's,
and `rm -rf` of code must never be the thing that destroys it). After an uninstall the `crm_*`
tables and every row in them are still in the warehouse, and the markdown docs are still under
`docs/crm/`. Purging them is a **separate, deliberate step** a human takes with intent - not a side
effect of removing a directory.

## Procedures and tools

`CrmController` (`@Controller('crm')`, class-level `@UseGuards(AuthGuard)`). Twenty-three
procedures, twenty-two of them also MCP tools.

| tRPC | MCP | what |
|---|---|---|
| `crmAccounts` (query) | `crm-accounts` | every account with its contacts and deals nested; no server-side filtering - one payload behind one live store |
| `crmAccountUpsert` (mutation) | `crm-account-upsert` | create or partially update a company; Box-owned columns only. Refuses a `stripe_customer_id` / link already held by another account |
| `crmAccountDelete` (mutation) | `crm-account-delete` | remove a company and report what went with it - its deals, its contacts AND their activities (`deals_deleted`, `contacts_deleted`, `activities_deleted`) |
| `crmDeals` (mutation) | `crm-deals` | every deal, or one account's, flat - the agent's and a report's read |
| `crmDealUpsert` (mutation) | `crm-deal-upsert` | create or partially update a deal; `account_id` required on create. Stamps `closed_at` / `loss_stage` on the stage move; a win promotes a lead account |
| `crmDealDelete` (mutation) | `crm-deal-delete` | remove one deal and its stage history; warns when it was closed, because closed deals are the win rate |
| `crmDealStageChanges` (mutation) | `crm-deal-stage-changes` | stage moves, oldest first: one deal's (`deal_id`), one account's (`account_id`), and/or a range of team days (`from`, `to`, inclusive, on box.json `timeZone`) |
| `crmDealMoves` (mutation) | `crm-deal-moves` | moves per owner between two team days (`from`, `to`, inclusive): `moved` (into any stage but won) and `won`; unowned moves are not counted |
| `crmContactUpsert` (mutation) | `crm-contact-upsert` | create or partially update a person; `account_id` required on create, re-parents on update; first contact becomes primary |
| `crmContactDelete` (mutation) | `crm-contact-delete` | remove a person and their activities (`activities_deleted`) and report: will the source re-send them, who was promoted to primary, is the account now uncallable |
| `crmActivities` (mutation) | `crm-activities` | every message with an account across all its contacts, oldest first |
| `crmActivityLog` (mutation) | `crm-activity-log` | the human write path - a call, an untracked email, a letter. Keyed `manual:<uuid>`; editing a synced row is refused |
| `crmActivityDelete` (mutation) | `crm-activity-delete` | hand-logged rows only (a synced message would just come back) |
| `crmMeetings` (mutation) | `crm-meetings` | a filtered list of meetings, newest first; filtering is SQL |
| `crmMeetingUpsert` (mutation) | `crm-meeting-upsert` | the human write path; on a `calendar`/`transcript` row it cannot express a provider-owned column at all |
| `crmMeetingDelete` (mutation) | `crm-meeting-delete` | a human undoing a mistake; warns when the row will be re-created by the next calendar run |
| `crmRevenueEvents` (mutation) | `crm-revenue-events` | a filtered list of money events; superseded rows hidden once, here, rather than deduplicated by every consumer |
| `crmRevenueEventUpsert` (mutation) | `crm-revenue-event-upsert` | the human write path; `kind` and the coverage window are the two fields it exists for |
| `crmRevenueEventDelete` (mutation) | `crm-revenue-event-delete` | same shape as the meeting delete |
| `crmAssignQueue` (mutation) | `crm-assign-queue` | everything a sync could not decide, both tables in one call |
| `crmDoc` (mutation) | `crm-doc-read` | one account's markdown doc from disk (empty if none yet) |
| `crmDocSave` (mutation) | `crm-doc-save` | write the doc, and re-derive the row's `next_action` / `notes` caches |
| `crmDocRegionsSave` (mutation) | - | the dashboard's autosave target, deliberately NOT an MCP tool: the panel owns two regions, an agent wants the whole markdown and keeps `crm-doc-save` |

Most reads are mutations on purpose: they carry an input body, and an input-less query is the only
query shape that reflects cleanly (the same call `planning`'s doc read makes).

The two machine writers - `upsertImportedMeeting` and `upsertImportedRevenueEvent`, plus
`upsertImportedAccount` / `upsertImportedContact` / `upsertCrmActivity` - are **not** exposed as MCP
tools. Nothing a model or a human types can reach them; they are library functions the syncs call.

## Actions

The base recipe declares none. The `stripe` powerup (`powerups/stripe`) adds `crm-stripe-sync`
(group `CRM`, not parameterized, schedulable): every Stripe invoice into `crm_revenue_events`
through `upsertImportedRevenueEvent`, configured by `features.crm.stripe` in `box.json`. Any other
sync a team writes against `import.ts` decides then whether it is an action (scheduled) or
event-driven.

## UI

- **Routes**: `/crm` (`CrmRoot`) is the one load and error state over the shared accounts payload,
  with three children, each a shell group of its own: the pathless `accounts` layout (`CrmLayout`,
  shell group `crm`) holding `/` (`CrmAccountsTable`), `queue` (`CrmAssignQueue`) and `$id`
  (`CrmAccountDetailView`); `deals` (`CrmDealsLayout`, `crm-deals`) holding `CrmDealsView`; and
  `contacts` (`CrmContactsLayout`, `crm-contacts`) holding `CrmContactsView`. The static segments
  outrank `$id`, so an account slugged `queue`, `deals` or `contacts` is shadowed. A contact has no
  page of its own; it is worked on its account's page.
- **Nav**: three entries in order band **600**: Accounts (`crm`, `Building2`, 600), Deals
  (`crm-deals`, `KanbanSquare`, 601) and Contacts (`crm-contacts`, `Contact`, 602).
- **Settings / shell / onSession**: none. `defineWebFeature` passes `routes` and `nav` only. The
  CRM owns four slots and two registries others fill (**Extension points** below); it contributes
  to none.
  The top-bar cluster on the accounts table is filled per-view with `TopBarActions` from
  `@silkweave/box-ui`, which is the shell extension seam rather than a manifest field.
- **Inside the layout**: a sidebar that is NAVIGATION, not a filter - the saved views (from core's
  view store) above, then the ten most recently opened accounts (per-browser `localStorage`; where
  you have been is not team state), plus an assign-queue entry badged with its count. Deals and
  Contacts carry only their saved views (`CrmPresetLayout`). Filtering lives in exactly one place,
  each page's view bar. The archived eye is one CRM-wide toggle: it hides archived accounts and the
  deals and people at them.
- **Three view models, three preset modules** (`presetModules: ['crm', 'crm-deals',
  'crm-contacts']`), each its own store, mounted only on its own page so none writes its preset
  into another page's URL. Deals and Contacts land on their first built-in (Pipeline, Everyone).
- **The accounts index** (`crmView.ts`) is a full-width grid with one row per account and
  totallable columns (the leading open deal, the weighted pipeline, MRR). Its filters are typed
  fields (`CRM_FILTER_SCHEMA`): deal stage, account status, source, tags and needs attention are
  options, owner a person (Me, No owner, people), the next action a date (forward windows or a
  range; churned, lost and archived accounts are never overdue) and MRR a number (`> 0` paying,
  `= 0` billing nothing by decision, Empty never set). Its `stage` filter reads "has a deal at this
  stage". Each view pins Owner and Account status to the bar by default. Saved views stored before deals existed are repaired on read
  (`normalizeCrmFilters`).
- **Deals** (`dealsView.ts`) is every deal with its account, as a stage board (`CrmKanban` over the
  UI library's `BoardKanban`, one card per deal, dragged between stages) or a list (stage and
  owner edited in place, value, odds, weighted, expected close, the account's next action). On the
  board the `stage` filter is the column list, with none picked the working stages
  (`PIPELINE_STAGES`); on the list none picked means every deal. The owner filter reads the deal's
  owner, falling back to its account's. Beside stage and owner the deal's MRR is a number field and
  its expected close a date field (won and lost deals are never overdue); the account's status,
  source, next action and tags filter too. Owner and Stage are pinned by default, Owner and Expected
  close on Closing soon. **New deal** starts one at an existing account. A card or
  row opens the account, where the deal is worked.
- **Contacts** (`contactsView.ts`) is every person at every account as a list (role, email, phone,
  LinkedIn, last activity, the account's status and owner), filtered by role, primary flag (a
  boolean: Primary or Not primary), how they can be reached (all of the picked ways), account status
  and owner (a person field), with Owner and Role pinned by default. A row opens the account; people are added there.
- **The detail page** is a summary strip (owner, MRR, open pipeline, last contact) above unboxed
  sections that fold shut by their heading - deals, contacts, conversation, meetings, money,
  relationship, retention and a record section folded by default - with the markdown doc beside
  it (lazy - `CrmAccountDocLazy`, because TipTap is large). The doc opens with the **Next move**
  block: the move itself, a size up in a tinted box, then its due date, whose turn it is and the
  last contact, then shortcuts that open Conversation with its log form or Deals with a new deal
  started. The fold state is one global per-browser preference (`CardCollapse`). A deal row with
  stage moves shows them folded to one line (how many, and the last); opened, each move with its
  day and who made it.
- **Live reload**: `useCrmData` registers `table:crm_accounts`, `table:crm_contacts` and
  `table:crm_deals`;
  `useCrmEvents` subscribes to `table:crm_meetings`, `table:crm_revenue_events`,
  `table:crm_activities` and `table:crm_deal_stage_changes`. Meetings, revenue, activities and
  stage moves are fetched PER ACCOUNT and not folded
  into the accounts payload, which is already ~294KB.

## Extension points

How another feature (the `support` recipe, a team's own) adds to the CRM. The dependent
registers into the dependency (`docs/core/SEAM.md` § 4.2, § 5.6): the CRM never imports a
contributor, reads contributions lazily at render, and shows nothing extra when none is present.
The contract lives in `features/crm/web/lib/crmExtensions.ts` (names, prop types, `CRM_SLOTS`);
`components/CrmSlots.tsx` hosts the slots.

**Slots** (core's web slots: list components under the name in `defineWebFeature({ slots })`):

| slot | props | where it renders |
|---|---|---|
| `crm.account.card` | `{ account }` | a folding section on the account page, after Money, one per component. Attach `crmCard = { id, title, applies? }` to the component: `id` (`<feature>-<name>`) keys its fold state, `title` heads it, `applies(account)` leaves it out for accounts it has nothing to say about |
| `crm.account.actions` | `{ account }` | controls beside the account's name on its page (a "Log support ticket" button) |
| `crm.touch.actions` | `{ activity }` | controls under one touch in the Conversation section, synced and hand-logged alike (a "Make a ticket" link) |
| `crm.overview.alerts` | `{ accounts }` (every account, unfiltered) | banners above the accounts index; each decides whether it has anything to say and returns null otherwise |

**Registries** (call when the contributor's web module loads, for example from its `index.tsx`;
each returns its unregister, and registering the same key again replaces it):

- `registerCrmColumn({ key, label, width, hint?, numeric?, Cell, useData?, sortValue?, sortLabel?,
  sortDir? })` offers a column on the accounts table. `key` is `ext:<feature>-<name>` and is what a
  saved view stores. `Cell` renders `{ account }` from the feature's own store; `useData` is a hook
  the table calls on every render so the column re-renders when that data moves; `sortValue`
  (read synchronously, null sorts last) also puts it in the sort menu. Optional like every column:
  people add it from the column picker.
- `registerCrmAttention({ key, label, matches })` adds a reason an account needs attention, beside
  the CRM's own (next action overdue, at risk). It becomes an option in the view bar's **Needs
  attention** filter, which matches an account with any picked reason. The option **Any reason**
  covers every reason, registered ones included; the seeded Needs attention view uses it, so a
  reason added later shows there without editing the view. `matches` reads the feature's store
  synchronously; pair it with a column's `useData` or a slot that loads the same store.

A saved view that names an `ext:` column, sort or reason whose feature is gone drops it on read.
Importing `registerCrmColumn` from `features/crm/web/lib/crmExtensions.ts` makes the contributor
depend on the CRM (declare `dependsOn: ['crm']`); a slot contribution alone needs no import.

## Settings

**None.** `defineServerFeature({ id: 'crm', module: CrmModule })` declares only its id and module,
and the feature reads no environment variables. Keep it that way when adding a sync: what a sync
needs is configuration under `features.crm` in `box.json` (or a file under `data/config/`) for its
map of stages and spaces, and its API key in `box.local.json credentials` read through core's
`credential()`. Unconfigured should mean the sync does nothing, never that the feature fails to load.

## What a team customises

Everything below is a plain list in `features/crm/core/types.ts` unless noted. Editing
an enum needs no migration until a Box has shipped rows with the old values; after that, a migration
in `migrations.ts` rewrites them.

- **The pipeline itself** - `CRM_DEAL_STAGES`:
  `stale -> meeting_requested -> meeting_booked -> demo -> proposal -> confirmed -> won`, with
  `revisit` as a dated siding and `lost` as the other exit. Two derived sets ride on it:
  `CRM_OPEN_DEAL_STAGES` (what is forecast) and `CRM_CLOSED_DEAL_STAGES` (what stamps `closed_at`).
  This is the single most team-specific thing in the feature.
- **The relationship** - `CRM_ACCOUNT_STATUSES`: `lead -> customer -> onboarding`, with
  `at_risk` / `churned` / `lost` / `archived` as the exits, and `CRM_PAYING_STATUSES` beside it.
- **Where deals come from** - `CRM_ACCOUNT_SOURCES` (`direct`, `inbound`, `outbound`, `referral`,
  `partner`, `existing`, `unknown`).
- **What you sell** - deliberately NOT in the foundation. No product, plan or price vocabulary
  ships and a deal's `mrr_usd` is typed by hand (a product decision, 2026-09-14: the deal shape is an
  optional spec a team implements on top of the CRM, on demand). `AGENT.md` § "Adding a deal
  shape" is that spec - the two axes, the derivation, and every file an enum column touches.
- **The people vocabularies** - `CRM_CONTACT_ROLES` (`decision_maker`, `buyer`, `user`, `other`),
  `CRM_WAITING_ON` (`me` / `them`), `CRM_ACTION_CHANNELS`, `CRM_ACTIVITY_CHANNELS` (with
  `CRM_ACTIVITY_CHANNEL_LABEL`) and `CRM_ACTIVITY_DIRECTIONS`.
- **Meetings and money** - `CRM_MEETING_KINDS` / `_OUTCOMES` / `_SOURCES` / `_MATCHED_BY`,
  `CRM_REVENUE_PROVIDERS` (`hubspot`, `stripe`, `manual`), `_KINDS`, `_STATUSES`, `_MATCHED_BY`, and
  `CRM_RENEWAL_RISKS`.
- **Column ownership** - `CRM_ACCOUNT_BOX_COLUMNS`, `CRM_ACCOUNT_FUTURE_PROVIDER_COLUMNS`,
  `CRM_CONTACT_PROVIDER_COLUMNS` / `_BOX_COLUMNS`, `CRM_MEETING_PROVIDER_COLUMNS` / `_BOX_COLUMNS`,
  `CRM_REVENUE_PROVIDER_COLUMNS` / `_BOX_COLUMNS`. Moving a column between the two lists is how a
  team decides whether a sync or a human owns it.
- **The matching rules** (`identity.ts` + `state.ts`). The five-rung ladder, strongest first:
  1. `contact` - a contact already carries this provider's external key (the steady state);
  2. `linkedin` - `linkedinKey()` on the profile URL matches;
  3. `company_urn` - an account carries the provider's stable company id (`external.company_urn`);
  4. `name` - `companyNameKey()` agrees ("Northwind Pte Ltd." = "Northwind");
  5. `domain` - `websiteDomain()` / `emailDomain()` agree.
  Rungs 1-3 are exact; 4 and 5 are judgements, which is why the rung is recorded on the row. No
  match returns null and the caller **creates** an account - a duplicate is visible and mergeable, a
  wrong merge silently blends two companies. The tunables: `LEGAL_SUFFIXES` (longest-first,
  Singapore-flavoured today: `pte ltd`, `sdn bhd`, ...), `LETTER_FOLDS`, and the `FREE_MAIL` set
  that stops a gmail address being read as a company domain.
- **The import's stage vocabulary** - `CRM_IMPORT_STAGES` (the upstream `external_stage` values
  that mean "still active at the source, will re-import"; the delete reports read it) and
  `CRM_ACCOUNT_STATUS_SEED` (what status a sync-created account is born with - `lead` for every
  key; nothing reads it today; whether a sync should also open a deal is the team's call). Both are placeholders inherited from the predecessor's outreach tool - a team wiring a
  sync replaces them with the stages its source actually reports, and keeps a stage like
  "Interested" deliberately OUT of the CRM by simply not mapping it.
- **Labels and order** - the nav labels and order band in `features/crm/web/index.tsx`; the
  accounts grid's offered columns, widths, hints and aggregates in `lib/crmView.ts` (`CRM_COLUMNS`,
  the closed-status set, the filter fields in `crmBarSpec`); the Deals page's in `lib/dealsView.ts`
  (`DEAL_COLUMNS`, `PIPELINE_STAGES` - the board's default columns - and its built-in presets);
  the Contacts page's in `lib/contactsView.ts`;
  the display labels in `crm-types.ts` (`CRM_DEAL_STAGE_LABEL`, `CRM_ACCOUNT_SOURCE_LABEL`, `CRM_MEETING_KIND_LABEL`,
  `CRM_REVENUE_STATUS_LABEL`, ...).
