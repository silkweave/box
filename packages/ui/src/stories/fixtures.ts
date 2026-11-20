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
    // An inline picture: stories fetch nothing at runtime, and the rendered gate's shots stay stable.
    image: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><rect width='96' height='96' fill='%23d9c7a7'/><circle cx='48' cy='38' r='18' fill='%237a5c3e'/><rect x='18' y='62' width='60' height='40' rx='30' fill='%237a5c3e'/></svg>",
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

/** The tags an item picks from - enough of them that the filter is worth using. */
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
