// Core's own tables - present in every Box regardless of which features are installed. Feature
// tables live in each feature's models.ts and reach schema.ts through the feature manifest.

import type { ModelSpec } from './model.js'
import { USER_ROLES, USER_STATUSES } from '../users/types.js'
import { RUN_STATUSES, RUN_TRIGGERS } from '../ops/types.js'

/** The people directory - every principal. docs/AUTH.md. */
export const USERS: ModelSpec = {
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
    // A fresh warehouse gets both from CREATE TABLE; an existing one from core:001/002, which are
    // then no-ops here. See docs/core/AUTH.md § 4.
    role: { kind: 'text', default: "'member'", enum: USER_ROLES },
    tailscale_login: { kind: 'text', nullable: true },
    email: { kind: 'text', nullable: true },
    channels: { kind: 'json', default: "'{}'" },
    token_ciphertext: { kind: 'text', nullable: true },
    token_issued_at: { kind: 'timestamp', nullable: true },
    token_last_used_at: { kind: 'timestamp', nullable: true },
    token_revoked_at: { kind: 'timestamp', nullable: true },
    // Single-use watermark for sign-in links (auth/link.ts). Holds the `iat`, in epoch
    // MILLISECONDS, of the most recently consumed grant: a grant is usable only if its own `iat` is
    // strictly newer. One column instead of a row per link, and it needs no sweep.
    //
    // A BIGINT and not a TIMESTAMP, which is not a style choice. The record layer normalizes every
    // timestamp through `toNaiveUtc`, which truncates to whole seconds - so an ordinary profile
    // edit would rewrite a watermark of 10:00:00.500 as 10:00:00 and re-arm the very link that had
    // just been consumed. An integer round-trips exactly.
    link_watermark: { kind: 'bigint', nullable: true },
  },
  timestamps: true,
  audit: true,
}


/** Cross-run cursors for pollers (e.g. the GitHub notifications conditional poll). */
export const KV_STATE: ModelSpec = {
  table: 'kv_state',
  pk: ['key'],
  columns: {
    key: { kind: 'text' },
    value: { kind: 'json' },
    updated_at: { kind: 'timestamp', default: 'now()' },
  },
}


/** One row per executed (or skipped) op, written by the ops funnel (ops/run.ts). */
export const AUTOMATION_RUNS: ModelSpec = {
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
    status: { kind: 'text', default: "'queued'", enum: RUN_STATUSES },
    started_at: { kind: 'timestamp', default: 'now()' },
    finished_at: { kind: 'timestamp', nullable: true },
    summary: { kind: 'text', nullable: true },
    error: { kind: 'text', nullable: true },
    log: { kind: 'json', default: "'[]'" },
  },
}


/** The events data layer - every normalized event lands here BEFORE any subscriber reacts (events.ts). */
export const EVENTS: ModelSpec = {
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
  },
}


export const CORE_MODELS: readonly ModelSpec[] = [USERS, KV_STATE, EVENTS, AUTOMATION_RUNS]
