// The signal hooks port - how features take part in core's signal operations without core
// importing them. Planning re-points its goals when a signal is renamed; automation re-points
// trigger filters; CRM and content contribute their derives. Each registers once from its server module's onModuleInit
// ("the dependent registers into the dependency"; docs/core/SEAM.md § 4.2). A CLI or test that never
// boots those modules simply sees core's signals alone, which is the point.

import type { SignalRow } from './write.js'

/** One object that uses a signal, as a feature reports it (the `references` hook). */
export interface SignalReference {
  /** What it is, singular and lowercase: `goal`, `task`, `trigger`. */
  kind: string
  /** Its id in the owning feature. */
  id: string
  /** What a person calls it (a goal's title, a trigger's name). */
  label: string
  /** How it uses the signal: `goal measure`, `milestone measure`, `trigger filter`. */
  via: string
  /** Where to open it, an app URL (`/goals/pipeline-q4`), or null when it has no page. */
  href: string | null
}

export interface SignalHooks {
  /** The registering feature, for error messages. */
  id: string
  /** Extra live rows appended to a channel's derive - keyed by dashboard channel. Needed because
   *  a channel derive REPLACES the channel's live rows, so anything else that lives on that
   *  channel must ride along or be wiped. */
  channelRows?: Record<string, () => Promise<SignalRow[]>>
  /** A standalone derive step `warehouse-derive` runs after the in-process channels. Returns rows. */
  derive?: () => Promise<number>
  /** A signal id was renamed - re-point every reference you hold. Runs inside renameSignal. */
  onRename?: (oldId: string, newId: string, actor?: string) => Promise<void>
  /** Your objects that use this signal, labelled (the signal's "used by" list and the delete report). */
  references?: (signalId: string) => Promise<SignalReference[]>
}

const hooks: SignalHooks[] = []

/** Register once per feature. Returns the unregister. */
export function registerSignalHooks(h: SignalHooks): () => void {
  if (hooks.some((x) => x.id === h.id)) throw new Error(`signal hooks "${h.id}" registered twice`)
  hooks.push(h)
  return () => {
    const i = hooks.indexOf(h)
    if (i >= 0) hooks.splice(i, 1)
  }
}

export function signalHooks(): readonly SignalHooks[] {
  return hooks
}

/** Every contributed row for one channel, from every registered feature. */
export async function contributedChannelRows(channel: string): Promise<SignalRow[]> {
  const out: SignalRow[] = []
  for (const h of hooks) {
    const fn = h.channelRows?.[channel]
    if (fn) out.push(...(await fn()))
  }
  return out
}

/** Every object that uses a signal, from every registered feature, in registration order. */
export async function signalReferences(signalId: string): Promise<SignalReference[]> {
  const out: SignalReference[] = []
  for (const h of hooks) out.push(...((await h.references?.(signalId)) ?? []))
  return out
}
