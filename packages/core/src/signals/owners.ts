// Signal ownership - most signals belong to a person (github.* is one account holder's). The mapping
// lives in the `signals.owners` settings (box.json, edited from Settings > Signal owners into
// box.local.json) rather than on the points, which derivers replace. Resolution happens at READ
// time (signalsData), so edits take effect instantly - no re-derive, no restart.
//
// Resolution order for a signal:
//   1. signal override (an explicit key, which may be null = deliberately unowned/brand-level)
//   2. the channel default
//   3. the channel's account binding (account-scoped channels: 'github@bob' → accounts.json → 'bob')
//   4. null (unowned)

import { writeBoxLocal } from '../box-json.js'
import { boxJson } from '../box-config.js'
import { configRoot } from '../io.js'
import { channelAccountUser } from '../accounts.js'

export interface SignalOwnersFile {
  /** Channel → users.id default (e.g. github → alice covers every github.* signal). */
  channels: Record<string, string>
  /** signal_id → users.id override; an explicit null marks a signal deliberately unowned. */
  signals: Record<string, string | null>
}


/** The signal-owner settings; none configured means "nothing is owned". */
export function readSignalOwnersFile(): SignalOwnersFile {
  const raw = (boxJson().signals.owners as Partial<SignalOwnersFile> | undefined) ?? {}
  const strings = (value: unknown): Record<string, string> => value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}
  const signals = raw.signals && typeof raw.signals === 'object' ? Object.fromEntries(Object.entries(raw.signals).filter(([, value]) => value === null || typeof value === 'string')) : {}
  return { channels: strings(raw.channels), signals }
}

/** Write the signal-owner settings to box.local.json (sorted keys - diff-friendly). */
export function writeSignalOwnersFile(file: SignalOwnersFile): void {
  const sort = <V>(o: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
  const before = readSignalOwnersFile()
  // A false signal entry removes an inherited override; null means explicitly unowned.
  const cleared = (keys: object, value: null | false) => Object.fromEntries(Object.keys(keys).map(key => [key, value]))
  const out = { channels: { ...cleared(before.channels, null), ...sort(file.channels) }, signals: { ...cleared(before.signals, false), ...sort(file.signals) } }
  writeBoxLocal(configRoot(), { signals: { owners: out } })
}

/** The owning users.id for one signal, or null (see resolution order above). */
export function resolveSignalOwner(file: SignalOwnersFile, channel: string, signalId: string): string | null {
  if (signalId in file.signals) return file.signals[signalId]
  // Account-scoped channels resolve through the account binding - ownership falls out of the
  // account (the `accounts` settings), no per-channel default needed.
  return file.channels[channel] ?? channelAccountUser(channel)
}
