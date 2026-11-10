// Core's own tables - present in every Box regardless of which features are installed. Feature
// tables live in each feature's models.ts and reach schema.ts through the feature manifest.

import { defineModel, type ModelSpec } from './model-spec.js'
import type { ModelDb } from './model-db.js'
import { USER_KINDS, USER_STATUSES } from '../users/types.js'
import { RUN_STATUSES, RUN_TRIGGERS } from '../ops/types.js'
import { SIGNAL_MODELS } from '../signals/models.js'
import { FX_RATES } from '../fx/rates.js'
import { ACCESS_LEVELS } from '../auth/levels.js'

/** The people directory - every principal. docs/AUTH.md. */
export const USERS = defineModel({
  table: 'users',
  pk: ['id'],
  columns: {
    id: { kind: 'text' },
    first_name: { kind: 'text', default: "''" },
    last_name: { kind: 'text', default: "''" },
    nickname: { kind: 'text', default: "''" },
    image: { kind: 'text', nullable: true },
    sort: { kind: 'int', default: '0' },
    color: { kind: 'text', nullable: true },
    status: { kind: 'text', default: "'active'", enum: USER_STATUSES },
    // A built-in (`admin`, `member`) or a custom role id (auth/roles.ts); checked on assignment, not
    // by an enum, because custom roles are rows.
    role: { kind: 'text', default: "'member'", policy: true },
    tailscale_login: { kind: 'text', nullable: true },
    email: { kind: 'text', nullable: true },
    // E.164; unique (users_phone_key), admin-only to change (users/state.ts).
    phone: { kind: 'text', nullable: true },
    channels: { kind: 'json', default: "'{}'" },
    token_ciphertext: { kind: 'text', nullable: true },
    token_issued_at: { kind: 'timestamp', nullable: true },
    token_last_used_at: { kind: 'timestamp', nullable: true },
    token_revoked_at: { kind: 'timestamp', nullable: true },
    // Single-use watermark for sign-in links (auth/link.ts). Holds the `iat`, in epoch
    // MILLISECONDS, of the most recently consumed grant: a grant is usable only if its own `iat` is
    // strictly newer. One column instead of a row per link, and it needs no sweep.
    //
    // A BIGINT and not a timestamp: it compares exactly with the grant's `iat`, and no timestamp
    // conversion can ever move it backwards and re-arm a consumed link.
    link_watermark: { kind: 'bigint', nullable: true },
    // The default agent profile (e.g. `toby:claude`), one of the person's agentProfiles; null keeps
    // the deployment rule. agent-defaults.ts.
    agent_profile: { kind: 'text', nullable: true },
    // Work capabilities (work-access.ts WorkAccess), admin-set; NULL reads as the defaults.
    work: { kind: 'json', nullable: true },
    // The person's own sidebar layout (users/sidebar.ts); NULL is the Box's default. Never part of
    // the public User: only its owner reads it.
    sidebar: { kind: 'json', nullable: true },
    // 'human' | 'agent': the durable record that a row is an agent (agents.ts).
    kind: { kind: 'text', default: "'human'", enum: USER_KINDS },
  },
  timestamps: true,
  audit: true,
})


/**
 * Custom roles (auth/roles.ts, docs/AUTH.md "Roles and areas"): a level per named area and a
 * default for the rest. The built-ins `admin` and `member` are never rows. Created by the baseline.
 */
export const ROLES = defineModel({
  table: 'roles',
  pk: ['id'],
  columns: {
    id: { kind: 'text' },
    label: { kind: 'text' },
    description: { kind: 'text', default: "''" },
    default_level: { kind: 'text', default: "'none'", enum: ACCESS_LEVELS },
    areas: { kind: 'json', default: "'{}'" },
  },
  timestamps: true,
  audit: true,
})

/** Cross-run cursors for pollers (e.g. the GitHub notifications conditional poll). */
export const KV_STATE = defineModel({
  table: 'kv_state',
  pk: ['key'],
  columns: {
    key: { kind: 'text' },
    value: { kind: 'json' },
    updated_at: { kind: 'timestamp', default: 'now()' },
  },
})


/** One row per executed (or skipped) op, written by the ops funnel (ops/run.ts). */
export const AUTOMATION_RUNS = defineModel({
  table: 'automation_runs',
  pk: ['id'],
  columns: {
    id: { kind: 'text' },
    /** Legacy: the config schedule a run belonged to, before schedules became triggers. */
    schedule_id: { kind: 'text', nullable: true },
    action_id: { kind: 'text' },
    trigger: { kind: 'text', enum: RUN_TRIGGERS },
    /** The automation trigger that started the run (null for a bare manual or agent run). */
    trigger_id: { kind: 'text', nullable: true },
    /** The event (events.id) that fired an event trigger. */
    event_id: { kind: 'text', nullable: true },
    triggered_by: { kind: 'text', nullable: true },
    /** An agent job's principal (the trigger's `run_as`): its runs are readable by those who cover
     *  it (PERMISSIONS 8.1). Null for action runs. */
    acts_as: { kind: 'text', nullable: true },
    status: { kind: 'text', default: "'queued'", enum: RUN_STATUSES },
    started_at: { kind: 'timestamp', default: 'now()' },
    finished_at: { kind: 'timestamp', nullable: true },
    summary: { kind: 'text', nullable: true },
    error: { kind: 'text', nullable: true },
    log: { kind: 'json', default: "'[]'" },
    /** The owning area: the action's owner (`ops` for core actions), `automation` for agent runs,
     *  `admin` when nothing classifies it (PERMISSIONS 8.1, 8.3). RLS and the accessors use it. */
    area: { kind: 'text', check: "area <> ''" },
  },
})


/** The events data layer - every normalized event lands here BEFORE any subscriber reacts (events.ts). */
export const EVENTS = defineModel({
  table: 'events',
  pk: ['kind', 'dedup_key'],
  columns: {
    id: { kind: 'text' },
    kind: { kind: 'text' },
    dedup_key: { kind: 'text' },
    source: { kind: 'text', default: "''" },
    actor: { kind: 'text', default: "''" },
    subject: { kind: 'text', default: "''" },
    url: { kind: 'text', default: "''" },
    fields: { kind: 'json', default: "'{}'" },
    event_at: { kind: 'timestamp', nullable: true },
    received_at: { kind: 'timestamp', default: 'now()' },
    /** Every area a reader needs (PERMISSIONS 8.3): set by the producer from the data, never empty,
     *  no blank member; `admin` when nothing classifies it. */
    areas: { kind: 'text[]', check: "cardinality(areas) > 0 and array_position(areas, '') is null and array_position(areas, null) is null" },
  },
})


const CORE_TABLES = [USERS, ROLES, KV_STATE, EVENTS, AUTOMATION_RUNS, ...SIGNAL_MODELS, FX_RATES] as const

export const CORE_MODELS: readonly ModelSpec[] = CORE_TABLES

/** Core's Kysely database type (the tables of CORE_MODELS), for `coreDb<CoreDb>()` (core-db.ts). */
export type CoreDb = ModelDb<typeof CORE_TABLES>
