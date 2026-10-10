// Browser identities: users.id → the chromatrix IDENTITY whose persistent, human-logged-in headed
// Chrome belongs to that person (`browsers.users` in box.json). Identities are names, not
// endpoints - a tab is leased per job and its CDP URL is minted per lease (browser/cdp.ts) - and
// they are read at call time.

import { boxJson } from '../box-config.js'

/** users.id → chromatrix identity (the name that person's headed Chrome is registered under). */
export type BrowsersFile = Record<string, string>


/** The configured browser identities. Entries that are not non-empty strings are ignored. */
export function readBrowsersFile(): BrowsersFile {
  const raw = (boxJson().browsers.users as Record<string, unknown> | undefined) ?? {}
  const out: BrowsersFile = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('_') && typeof value === 'string' && value.trim()) out[key] = value.trim()
  }
  return out
}

/** The chromatrix identity backing a user's own headed Chrome, or null when none is declared. */
export function browserIdentity(userId: string): string | null {
  return readBrowsersFile()[userId] ?? null
}
