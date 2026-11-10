// System work's entry points are few, named and listed (PERMISSIONS 11.5): every `asSystem` and
// `coreCommand` / `coreRead` call in core, the server and its scripts is in the list below, with a
// literal reason (the check itself: system-entries.testing.ts). A new entry point, a renamed one or
// a removed one fails here until the list changes in the same commit, so each is reviewed. System
// work reaches every area and core table: keep entries narrow (around the SQL that needs them,
// never around a handler, hook or callback; docs/AUTH.md).
//
// A feature lists its own entries in `features/<id>/core/system-entries.test.ts`; the last test
// here requires that file for every feature tree that has any.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeSystemEntries, scanSystemEntries, WORKSPACE_ROOT } from './system-entries.testing.js'

/** File -> its reasons, sorted; a template literal's `${...}` parts read as `*`. */
const SYSTEM_ENTRIES: Record<string, string[]> = {
  'apps/server/scripts/auth-login.ts': ['cli: auth login'],
  'apps/server/scripts/auth-replace.ts': ['cli: auth replace'],
  'apps/server/scripts/auth-reveal.ts': ['cli: auth reveal'],
  'apps/server/scripts/auth-token.ts': ['cli: auth token'],
  'apps/server/scripts/setup.ts': ['cli: setup'],
  'apps/server/src/auth/auth.controller.ts': ['auth: first-run probe'],
  // A person's Work settings, read by the agent mount, the Work tool hook and the credential recheck (permissions 5c).
  'apps/server/src/agent/work-session.ts': ['work: settings'],
  'apps/server/src/main.ts': ['boot: agent defaults', 'boot: agent principals'],
  'packages/core/src/auth/replace-agent.ts': ['replace-agent: reference scan'],
  'packages/core/src/events.ts': ['events: *'],
  'packages/core/src/ops/run-log.ts': ['run record: log'],
  'packages/core/src/ops/run.ts': ['run outcome: *'],
  'packages/core/src/ops/runs.ts': ['run record: finalize', 'run record: running'],
  'packages/core/src/signals/definitions.ts': ['signals: delete cascade', 'signals: dependency check', 'signals: id taken check', 'signals: rename cascade'],
  'packages/core/src/signals/tracker-derive.ts': ['signals: tracker watch'],
}

describeSystemEntries('core', ['packages/core/src', 'apps/server/src', 'apps/server/scripts'], SYSTEM_ENTRIES)

describe('feature system entry points', () => {
  it('are reviewed by a system-entries.test.ts beside each feature that has any', () => {
    const { entries } = scanSystemEntries(['features'])
    const features = new Set(Object.keys(entries).map((file) => file.split('/')[1]!))
    const unreviewed = [...features].filter((id) => !existsSync(join(WORKSPACE_ROOT, 'features', id, 'core', 'system-entries.test.ts')))
    expect(unreviewed).toEqual([])
  })
})
