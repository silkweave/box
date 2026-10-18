// Browser identities: users.id → the Shuttle AGENT whose persistent, human-logged-in storage
// belongs to that person (`browsers.users` in box.json). Agents are names, not endpoints - a
// session is opened per job and its CDP endpoint is minted per session (browser/cdp.ts) - and
// they are read at call time.

import { boxJson } from '../box-config.js'

/** users.id → Shuttle agent id (the agent holding that person's logins). */
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

/** The Shuttle agent holding a user's own logins, or null when none is declared. */
export function browserIdentity(userId: string): string | null {
  return readBrowsersFile()[userId] ?? null
}
