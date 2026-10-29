// Test seam behind `holdWarehouseOpen` (testing.ts). Opening and checkpointing a DuckDB instance per
// withRead/withWrite costs 10-30ms, and test suites make thousands of calls. Held mode keeps one
// read-write instance per database file open in this process and serves reads and writes from it.
// Production never enables it: a held instance would lock the file against the duckdb CLI and the
// warehouse MCP server. This module imports nothing, so the Vitest setup files can switch it on
// without loading core modules ahead of a test file's vi.mock calls.

interface Closable {
  closeSync(): void
}

interface Entry<T extends Closable> {
  pending: Promise<T>
  instance?: T
}

let hold = false
const held = new Map<string, Entry<Closable>>()

export function holdingWarehouse(): boolean {
  return hold
}

/** Keep one instance per database file open instead of opening one per call. */
export function holdWarehouseOpen(on: boolean): void {
  if (!on) releaseWarehouse()
  hold = on
}

/** Close every held instance (before a test replaces or deletes a database file). */
export function releaseWarehouse(): void {
  for (const entry of held.values()) {
    if (entry.instance) entry.instance.closeSync()
    else void entry.pending.then((instance) => instance.closeSync(), () => {})
  }
  held.clear()
}

/** The held instance for `path`, created on first use. */
export function heldInstance<T extends Closable>(path: string, create: (path: string) => Promise<T>): Promise<T> {
  const existing = held.get(path) as Entry<T> | undefined
  if (existing) return existing.pending
  const entry: Entry<T> = { pending: create(path) }
  held.set(path, entry)
  entry.pending.then(
    (instance) => (entry.instance = instance),
    () => held.get(path) === entry && held.delete(path),
  )
  return entry.pending
}
