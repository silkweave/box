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
//   holdWarehouseOpen(on) keep one DuckDB instance per database file open (the setup files turn it
//                         on); a test that replaces or deletes the file, or checks the per-call
//                         open path, turns it off
//   releaseWarehouse()    close the held instances; switching the instance directory does it too
import { resetInstanceDir as resetDir, setInstanceDir as setDir } from './io.js'
import { releaseWarehouse } from './warehouse/hold.js'

export { holdWarehouseOpen, releaseWarehouse } from './warehouse/hold.js'

export function setInstanceDir(dir: string): void {
  releaseWarehouse()
  setDir(dir)
}

export function resetInstanceDir(): void {
  releaseWarehouse()
  resetDir()
}
