# Adapting the `support` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it
gets into a Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/support/`; the reference implementation is fetched from the recipe registry as `features/support/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md) and
[GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with
`box recipe fetch support`.

**Builds on:** core only. The powerups each name what they require: [crm](./powerups/crm/POWERUP.md)
(the CRM recipe) and [help-center](./powerups/help-center/POWERUP.md) (the public Help Center; its contact form
needs the automation recipe's relay powerup). Ask the owner which to add now; each can be added later.

## 2. Customise for the team

1. **Types and channels.** `SUPPORT_TICKET_TYPES` and `SUPPORT_CHANNELS` in `core/types.ts` are code
   enums because views and rules switch on them (the board's Type and Channel columns are these
   values). Adding a value is a code change plus a migration only if existing rows change;
   removing one needs a migration that maps old rows first. Keep `bug`.
2. **Who the requester is.** The base keeps requesters in `support_requesters`, with the
   organization as free text, because many teams hear from people at organizations they do not
   track. A team with the CRM recipe adds the `crm` powerup: the requester is then a CRM contact
   and the organization is the contact's account, so people are kept once, in the CRM. Ask the
   owner before adding it to a Box that already has tickets; `support-crm-adopt` moves them.
3. **Persona or role of the requester.** Not in the base: one team's personas (teacher, parent,
   student; admin, end user) are not another's. Add a column with a migration and a picker if the
   team groups tickets by persona; keep it off requesters' personal data.
4. **Working days.** `workingDays`, `holidays` and `lateAfterDays` in `features.support`. Refresh
   `holidays` each year; the ticket age is wrong the day a missing holiday falls.
5. **The skill.** `features/support/skills/support/SKILL.md` tells agents how to log a ticket from a
   summary. Adjust the language the team writes summaries in and what counts as a bug. Keep the rules that matter: find the requester before creating one, and pass a
   `source_ref` for anything that could be logged twice.
6. **Labels and order.** Nav "Support Tickets" at 650 and Settings "Support" at 825 in
   `web/index.tsx`.
7. **Presets.** The built-in presets (`TICKETS_DEFAULT_PRESETS` in `web/lib/ticketsView.ts`) are a
   seed: written to the team's list the first time anybody opens Support Tickets, then the team's
   to edit in the view bar. Change the seed only for presets every Box of this team should start
   with.

## 3. Prove it

INSTALL.md "Validation" is the proof for the base; each powerup's INSTALL.md has its own Verify.
Exercise the agent path once in a fresh agent session (tools are listed when a session starts):
ask the agent to log a ticket from a short call summary and check that it found the existing
requester instead of creating a second one.

## 4. Adapt or remove

- **Removing a powerup** follows its INSTALL.md "Remove". Its tables stay.
- **Removing the recipe**: remove `features/support/`, its registration lines and the skill link,
  and `support` from the `recipes` ledger. The `support_*` tables stay in the warehouse until the
  owner deliberately drops them after a backup.
- **Importing an old help desk**: write a one-off script under `_docs/scripts/` that calls
  `logSupportTicket` with `source: "import"` and the old row id as `source_ref`, so it can be re-run.
  Never insert rows with SQL: the requester rules would be skipped.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md).
