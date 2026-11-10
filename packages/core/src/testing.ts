// `@silkweave/box-core/testing` - the seams a test or a build-time tool may pull, and nothing an
// adopted app should. Deliberately NOT re-exported from the public index (index.ts): the index is
// core's versioned surface, and an accessor that re-points a running Box at another directory is
// a footgun there, not an API.
//
//   setInstanceDir(dir)   point this process at a throwaway instance directory before it reads one
//   resetInstanceDir()    back to <checkout>/data
//
// This is how typegen (apps/server/scripts/typegen.ts) boots the real AppModule against an empty
// temp dir on every `bun install`, and how every test that touches disk stays off the live
// warehouse. There is no environment variable for it (`BOX_DATA_DIR` was removed 2026-09-18): a
// setter cannot leak in from a shell, and it holds the same ordering guarantee, because every
// instance read in this codebase happens inside a function, never at import.
//
// The database seams (PHASE1.md choice 11): `useTestDatabase(inject('boxDb'))` points the process
// executor at a fresh clone of the run's migrated template (the setup files do it per test file),
// and `setFramelessScopeForTests` makes code with no context frame run as system work, so test
// bodies can call core functions directly. Denial tests set their frames explicitly
// (`withoutContext`, `runInRequest` + `fillRequest`).
import { resetInstanceDir as resetDir, setInstanceDir as setDir } from './io.js'

import type { TemplateInfo, TestDatabase } from './warehouse/pg/testing.js'

export { setFramelessScopeForTests } from './frameless.js'
export type { TemplateInfo, TestDatabase } from './warehouse/pg/testing.js'

/** A fresh clone of the run's template with the process executor pointed at it. Loaded lazily, so
 *  importing this seam does not load the feature registry before a test file mocks it. */
export async function useTestDatabase(info: TemplateInfo): Promise<TestDatabase> {
  return (await import('./warehouse/pg/testing.js')).useTestDatabase(info)
}

export function setInstanceDir(dir: string): void {
  setDir(dir)
}

export function resetInstanceDir(): void {
  resetDir()
}
