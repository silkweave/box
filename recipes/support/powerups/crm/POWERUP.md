# CRM link

Tickets that belong to a customer: the requester is a CRM contact, so a ticket's organization is the contact's account. Log a ticket straight from a CRM touch or an account, and see an account's support history on its CRM page.

## Highlights

- The requester is a CRM contact: one autocomplete searches the CRM's people, and a new requester becomes a contact under the company typed (found by name, or created)
- "Log support ticket" on a CRM touch and in an account's actions, one ticket per touch; both open the New ticket dialog prefilled
- A Support tab on the CRM account page: open tickets, late ones, open bug reports and the full history, counted through the account's contacts
- An "Open support tickets" column for the CRM accounts grid and a "Late support tickets" attention reason

## Needs

- Nothing outside the Box: the CRM recipe's accounts, contacts and touches

## Requires

- [CRM](../../../crm/RECIPE.md)

## How it works

The powerup adds `crm` to the support feature's `dependsOn` and imports CRM's exported readers and
registration functions. It replaces the base requester directory with the CRM's contacts
(`core/crm/directory.ts`): `support_tickets.requester_id` holds a `crm_contacts` id, and the ticket's
organization is the contact's account name, so the base tables stay the same as in a Box without CRM
and `support_requesters` is not read. A requester named by details is found by email, then phone,
among the contacts; otherwise a contact is created under `requester_account_id` when given, else the
account its organization names (found case-insensitively by name), else, when
`features.support.crm.fallbackAccount` names an account, that one (the organization they named goes
into the contact's notes as `Organization: <name>`), else a new account with source `inbound`, named
after the organization or the person. The fallback suits a team whose CRM holds only some of the
organizations its requesters come from: a support request never creates a CRM account then. The requester tools `support-requester-upsert`,
`support-requester-merge` and `support-requester-delete` refuse; edit contacts with the CRM tools.

It owns one link table, `support_ticket_crm` (ticket to the touch it came from; the touch is
unique). A ticket made from a touch takes the touch's contact as requester when it names none. It
contributes to CRM's extension points: `crm.account.card` (the Support tab, with a Log support
ticket button), `crm.account.actions` (Log support ticket: the New ticket dialog, a new requester
going under that account), `crm.touch.actions` (Log support ticket from the touch: requester is the
touch's contact, with the touch id, channel, subject and summary; or Open ticket when the touch
already has one), `crm.overview.alerts` (accounts with late tickets), `registerCrmColumn` (Open
support tickets, with the late count; sorts most first) and `registerCrmAttention` (Late support
tickets, in the CRM's Needs attention). Account counts come through the requester's contact. The
ticket page has no CRM panel: the requester panel links to the contact's account in the CRM.
`support-status` reports a problem while tickets name requesters outside the CRM.
