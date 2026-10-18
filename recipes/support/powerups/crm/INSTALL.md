# CRM link powerup: install

Links tickets to CRM accounts, contacts and touches. Read [POWERUP.md](POWERUP.md), the recipe
[SPEC.md](../../SPEC.md) and the CRM recipe's SPEC.md ("extension points") first. Do as much as
possible yourself; there are no owner-only steps.

## Detect

`box support-status` lists `crm` under `powerups` when the code is registered. A table
`support_ticket_crm` in the warehouse means it was added before. `box.json`
`recipes.support.powerups` lists `crm` once it was verified.

## Requires

- The Support recipe, adapted and validated.
- The CRM recipe, adapted and validated, at a revision that provides the extension points
  `crm.account.card`, `crm.account.actions`, `crm.touch.actions`, `crm.overview.alerts`,
  `registerCrmColumn` and `registerCrmAttention`.

## Owner decisions

1. **Moving existing requesters.** Whether to move the tickets of existing support requesters
   to CRM contacts now (the agent proposes the matches; the owner confirms them). Until they move,
   `support-status` reports the tickets that name requesters outside the CRM.

## Owner-only steps

None.

## Steps

1. **Source.** Copy/adapt `core/crm/`, `server/crm/` and `web/crm/` from
   `<fetched stack>/features/support/`. Register them: `export * from './crm/index.js'` in
   `core/index.ts`, the model and `dependsOn: ['crm']` in `core/manifest.ts`, `SupportCrmModule`
   in `server/support/support.module.ts` (it sets the requester directory), and the slot contributions and column and attention
   registrations in `web/index.tsx` (the column and attention reason register in the feature's
   `onSession`, once a session exists, and unregister when it ends).
2. **Restart** (`box app restart`); the link table is created on boot.
3. **Move existing requesters**, if the owner chose it: `box support-crm-adopt --dry_run` lists
   each support requester a ticket names, matched to a contact by email, then phone, or to be
   created under the account its organization names; after the owner confirms, run it without
   `dry_run`. It moves those tickets to the contacts.
4. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md` and the session in
   `_docs/INTEGRATION.md`.

## Tools

`support-ticket-log` and `support-ticket-update` accept `crm_activity_id` (the touch; one ticket per
touch), and `requester_id` is a CRM contact id; `requester_account_id` and `requester_organization`
place a new requester's contact. `support-requesters` answers `directory: 'crm'`.
`support-account-tickets` (`account_id`, `status`) lists the tickets of an account's contacts;
`support-crm-adopt` (admin, `dry_run`) moves tickets whose requester is a support requester to a CRM
contact, matching by email or phone or creating one.

## Verify

1. `bun run schema:check` passes the enabled-later pass with CRM and Support.
2. On a CRM touch, "Log support ticket" opens the New ticket dialog with the touch's contact as
   requester and the touch's channel, subject and summary; saving it and clicking the action again
   opens the same ticket. On an account, the action opens the dialog with a new requester going
   under that account.
3. The account's Support tab lists the ticket; the accounts grid's column picker offers Open
   support tickets; a ticket older than `lateAfterDays` puts the account in Needs attention.
4. A ticket's page shows the requester's company as the organization and links to the account in
   the CRM; a new requester typed with a company that exists becomes a contact of that account.
5. After these checks and the validation chain pass, add `crm` to `recipes.support.powerups`.

## Remove

Remove the registration lines and the `crm/` folders, and `crm` from `recipes.support.powerups`.
The link table stays. Tickets keep their `requester_id`, which names a CRM contact; without the
powerup the base directory does not read it, so tell the owner before removing it from a Box with
tickets.
