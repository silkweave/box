# reminders gotchas

Reminder files/data are team-owned state. A recurrence or owner change needs a new migration and a backup before applying it.

The feature id (`reminders`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **`state.ts` has no SQL, and should not gain any.** The record layer owns the naive-UTC ↔ ISO-Z
  convention, the audit stamp and the `table:reminders` change-feed emit. A hand-written `INSERT`
  here would silently drop all three, and the dashboard would stop updating itself.
- **`done_at` is the status.** Do not add a `status` enum beside it. Two columns for one fact
  disagree the first time one of them is set.
- **`due_at` is required on create and merged on update.** `upsertRecord` keeps the previous value
  for any column the input omits, so a partial update that forgets `due_at` is correct, not a bug.
- `index.tsx` sits on the web feature-registry import cycle. Never read a registry binding at module
  scope there, and load the app in a browser after touching it (`AGENTS.md`).
