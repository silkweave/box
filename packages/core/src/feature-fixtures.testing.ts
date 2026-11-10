// Test-only stand-ins for installed features. Core's tests (and the server's) exercise areas,
// owners, tables and actions that a feature registers; a Box that installed no recipe has none, so
// the test runner (vitest.features.ts) swaps this module in for `generated/features.ts`. It
// registers the installed features and, for each id below the Box lacks, a minimal fixture with the
// same id: the same areas, doc sections and table shapes the tests need, none of the behaviour.
// Where a Box installs the real recipe, that one is used and the fixture is not registered.

import type { CoreFeature } from './feature.js'
import { defineModel } from './warehouse/model-spec.js'
import { FEATURE_LIST as INSTALLED } from './generated/features.js'

const FIXTURES: readonly CoreFeature[] = [
  {
    id: 'crm',
    docSections: ['crm'],
    models: [
      defineModel({ table: 'crm_accounts', pk: ['id'], columns: { id: { kind: 'text' }, name: { kind: 'text', default: "''" } }, timestamps: true }),
      defineModel({
        table: 'crm_deals',
        pk: ['id'],
        columns: { id: { kind: 'text' }, account_id: { kind: 'text' }, name: { kind: 'text', default: "''" } },
        timestamps: true,
      }),
    ],
    migrations: [],
    actions: [{ id: 'crm-fixture-sync', label: 'Fixture sync', group: 'CRM', description: 'A test action owned by a feature.', run: async function* () { /* nothing to ingest */ } }],
  },
  {
    id: 'support',
    models: [defineModel({ table: 'support_tickets', pk: ['id'], columns: { id: { kind: 'text' }, title: { kind: 'text', default: "''" } }, timestamps: true })],
    migrations: [],
  },
  { id: 'automation', models: [], migrations: [] },
  { id: 'planning', docSections: ['goals', 'cycles', 'initiatives', 'tasks'], models: [], migrations: [] },
  { id: 'data-sync', models: [], migrations: [] },
  { id: 'sink', docSections: ['sink'], models: [], migrations: [] },
  { id: 'chat', models: [], migrations: [] },
  { id: 'artifacts', models: [], migrations: [] },
]

export const FEATURE_LIST: readonly CoreFeature[] = [...INSTALLED, ...FIXTURES.filter((f) => !INSTALLED.some((i) => i.id === f.id))]
export const FEATURES = FEATURE_LIST
