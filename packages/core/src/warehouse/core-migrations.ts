// Core's own migration ledger. Features own theirs (`<feature>:<name>`); these are keyed
// `core:<name>` and run before every feature's, because core's tables are the ones features
// reference. Append-only: never edit or reorder an entry that has shipped.
//
// The 28 migrations this inherited were deleted at the split (each feature's ledger restarts at its own 001),
// so this list started empty. The first entries arrived with docs/core/AUTH.md on 2026-09-13.

import { systemUserId } from '../box-config.js'
import type { Migration } from './schema.js'

export const CORE_MIGRATIONS: readonly Migration[] = [
  {
    // One ALTER per migration: DuckDB is happiest with a single table-altering statement per
    // transaction (see the note at the top of schema.ts).
    name: '001-users-role',
    statements: [
      // NOT NULL is deliberately absent: DuckDB answers "Adding columns with constraints not yet
      // supported" to an ALTER that carries one, so an upgraded Box gets a NULLABLE role column
      // where a fresh one (built by CREATE TABLE from the ModelSpec) gets NOT NULL. The two agree
      // in behaviour because every read narrows through `roleOf()`, which maps anything that is
      // not exactly 'admin' - NULL included - to 'member'. Found 2026-09-13 by the populated-table
      // test in auth/roles.test.ts; `schema:check` cannot see it, because it only ever applies
      // migrations to tables that already have the column from CREATE.
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR DEFAULT 'member'`,
      // Everyone who exists on an upgrading Box could already do everything - that WAS the
      // documented contract, since roles were removed on 2026-09-10 - so keep it true for the
      // humans and false for the machine account. Zero rows on a fresh Box, where the column
      // comes from CREATE TABLE instead.
      //
      // Why everyone rather than nobody: a Box that upgrades and finds nobody can open Settings ->
      // Users is a lockout (recoverable only with `pnpm auth:token <id> --admin` on the host),
      // while a Box where everyone keeps yesterday's powers is no worse than yesterday and
      // strictly better on the axis that matters - the agent stops being an admin.
      // Frozen shipped SQL: the old agent ID must not follow config or its checksum would change.
      `UPDATE users SET role = 'admin' WHERE id <> 'abi'`,
    ],
  },
  {
    name: '002-users-tailscale-login',
    statements: [`ALTER TABLE users ADD COLUMN IF NOT EXISTS tailscale_login VARCHAR`],
  },
  {
    // The single-use watermark for sign-in links (2026-09-15). NULL means "this user has never
    // consumed one", which is the correct state for every existing row: it makes their first link
    // usable rather than locking them out on upgrade.
    name: '003-users-link-watermark',
    statements: [`ALTER TABLE users ADD COLUMN IF NOT EXISTS link_watermark BIGINT`],
  },
  {
    // Triggers (2026-10-06): a run records the automation trigger that started it. Runs recorded
    // before triggers carry their schedule id, and every imported schedule kept its id as the
    // trigger id, so the backfill links old history to the trigger that replaced the schedule.
    name: '004-runs-trigger-id',
    statements: [
      `ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS trigger_id VARCHAR`,
      `UPDATE automation_runs SET trigger_id = schedule_id WHERE trigger_id IS NULL AND schedule_id IS NOT NULL`,
    ],
  },
  {
    name: '005-runs-event-id',
    statements: [`ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS event_id VARCHAR`],
  },
  {
    // Default agent profile (2026-10-08): the profile a person's runs prefer, chosen in Settings >
    // Profile or the Users detail; for the agent principal the only one it uses. NULL keeps the
    // previous rule (Claude first among the mapped engines), so existing rows need no backfill.
    name: '006-users-agent-profile',
    statements: [`ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_profile VARCHAR`],
  },
  {
    // Multiple agents (2026-10-11): `kind` is the durable record that a row is an agent, so a
    // deleted agent file never turns an agent into a "human" with a working token. Nullable for
    // the reason in 001 (DuckDB adds no constraint by ALTER); reads narrow anything but 'agent'
    // to 'human'. The backfill marks the locked system id only: every other existing row stays
    // human, and converting one is a deliberate transition script. The id is read in `run`, not
    // baked into the SQL, so the checksum does not follow config (the 001 lesson); agentIdentity
    // is bound by the identity lock before any migration runs.
    name: '007-users-kind',
    statements: [`ALTER TABLE users ADD COLUMN IF NOT EXISTS kind VARCHAR DEFAULT 'human'`],
    run: async (conn) => {
      await conn.run(`UPDATE users SET kind = 'agent' WHERE id = ?`, [systemUserId()])
    },
  },
  {
    // Phone identity (2026-10-13): a person's number in E.164, so a channel that sees numbers
    // (WhatsApp) can tell a team member from a client. Nullable, no backfill.
    name: '008-users-phone',
    statements: [`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR`],
  },
  {
    // Work permissions (2026-10-14): what a member's Work session may touch, as a JSON object
    // (work-access.ts). Nullable, no backfill: NULL reads as the defaults, which are exactly the
    // capabilities every member had before minus the checkout, so no row needs a value.
    name: '009-users-work',
    statements: [`ALTER TABLE users ADD COLUMN IF NOT EXISTS work JSON`],
  },
]
