export { SAMPLE_GROUP_NAV, SAMPLE_NAV_ITEMS } from './nav.ts'

import type { AvatarUser } from '../users/types.ts'
import type { LogLine } from '../components/LogViewer.tsx'

/**
 * Stand-in data for stories. Not exported from the package barrel: a fixture that ships to an app
 * is a fixture someone will render in production by accident.
 *
 * Two of the four users have no image on purpose, so the initials chip and its deterministic tint
 * are always on screen somewhere - that branch is the one a real directory exercises most.
 */
export const SAMPLE_USERS: AvatarUser[] = [
  { id: 'ada', first_name: 'Ada', last_name: 'Lovelace', nickname: 'Ada', image: null },
  { id: 'grace', first_name: 'Grace', last_name: 'Hopper', nickname: 'Grace', image: null },
  {
    id: 'alan',
    first_name: 'Alan',
    last_name: 'Turing',
    nickname: 'Alan',
    image: 'https://i.pravatar.cc/96?u=alan',
  },
  { id: 'katherine', first_name: 'Katherine', last_name: 'Johnson', nickname: 'Kat', image: null },
]

/** Already flattened to lines - mapping a run's progress chunks onto these is the app's job. */
export const SAMPLE_LOG: LogLine[] = [
  { text: 'github: fetching stars for silkweave' },
  { text: 'github: 18 stars, 1 new since 2026-09-07' },
  { text: 'npm: fetching downloads for 6 packages' },
  { text: 'npm: wrote 7 signal points' },
  { text: '7 points across 2 channels', tone: 'accent' },
]

/** The tags a content piece picks from - enough of them that the filter is worth using. */
export const SAMPLE_TAGS = [
  'agents',
  'announcement',
  'benchmarks',
  'developer-tools',
  'duckdb',
  'engineering',
  'launch',
  'mcp',
  'open-source',
  'typescript',
]
