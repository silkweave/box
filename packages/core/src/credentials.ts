// Channel/account credentials are configured in gitignored box.local.json.
import { boxJson } from './box-config.js'
import { configRoot } from './io.js'
import { writeBoxLocal } from './box-json.js'

export type CredentialsFile = Record<string, Record<string, Record<string, string>>>

/** Reserved pseudo-account for channel-scoped keys shared by every account. Can never collide
 *  with a real accounts.json id (those are slug-constrained). */
export const CHANNEL_SCOPE = '*'

export function readCredentialsFile(): CredentialsFile {
  return boxJson().credentials
}

/** One credential value, or undefined if unset/blank - for optional keys (a per-account PAT).
 *  The account's own entry wins; the channel-scoped `*` entry is the fallback. */
export function credential(channel: string, account: string, key: string): string | undefined {
  if (key.startsWith('_')) return undefined // _-prefixed keys are doc notes, never secrets
  const ch = readCredentialsFile()[channel]
  const v = ch?.[account]?.[key] ?? ch?.[CHANNEL_SCOPE]?.[key]
  return v && v.trim() ? v.trim() : undefined
}

/**
 * Require all named keys for a channel account; throw one clear error listing any that are
 * missing. Returns the values positionally as a same-length string tuple.
 */
export function requireCredentials<const N extends readonly string[]>(
  channel: string,
  account: string,
  ...keys: N
): { [K in keyof N]: string } {
  const vals = keys.map((k) => credential(channel, account, k))
  const missing = keys.filter((_, i) => !vals[i])
  if (missing.length) {
    throw new Error(
      `missing credentials for ${channel}@${account}: ${missing.join(', ')} - ` +
        `add them to box.local.json credentials (how to configure it: docs/SETUP.md)`,
    )
  }
  return vals as { [K in keyof N]: string }
}

/**
 * Overwrite specific keys of ONE channel account, leaving every other channel, account and key in
 * the file untouched. The only writer of credentials.json in this repo, and it exists for exactly
 * one situation: a secret that ROTATES on use, where the value we hold stops working the moment it
 * is spent (a rotating refresh token). Everything else is configured by hand, on purpose.
 *
 * Three deliberate properties:
 *   • READ-MODIFY-WRITE, not a whole-file replace from a cached parse - the scheduler and a human
 *     editor can both be touching this file, and clobbering another channel's key to save a
 *     rotation would be a far worse bug than the one this fixes.
 *   • ATOMIC via write-then-rename - a crash mid-write must not leave a truncated secret store,
 *     because there is no backup and the file is gitignored.
 *   • Mode 0600 on the temp file BEFORE the rename, so the secret is never briefly world-readable.
 *
 * A blank value is refused rather than stored: "" would read back as absent and silently turn a
 * rotation into a missing-credential error one sync later, which is the confusing failure.
 */
export function writeCredentials(channel: string, account: string, updates: Record<string, string>): void {
  const entries = Object.entries(updates)
  if (entries.length === 0) return
  const bad = entries.filter(([k, v]) => k.startsWith('_') || !v || !v.trim())
  if (bad.length > 0) {
    throw new Error(
      `refusing to write credentials for ${channel}@${account}: ${bad.map(([k]) => k).join(', ')} - ` +
        'a key must be non-blank and must not be a _-prefixed doc note',
    )
  }

  writeBoxLocal(configRoot(), {
    credentials: { [channel]: { [account]: Object.fromEntries(entries.map(([key, value]) => [key, value.trim()])) } },
  })
}

/** A channel account's full key set (non-blank), e.g. to inject into a plugin subprocess env.
 *  Channel-scoped `*` keys are included, with the account's own entries winning on conflict. */
export function credentialsEnv(channel: string, account: string): Record<string, string> {
  const ch = readCredentialsFile()[channel]
  const entries = Object.entries({ ...ch?.[CHANNEL_SCOPE], ...ch?.[account] })
  return Object.fromEntries(
    entries.filter(([k, v]) => !k.startsWith('_') && v && v.trim()).map(([k, v]) => [k, v.trim()]),
  )
}
