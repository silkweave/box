import { appKey } from './storage.ts'
import { isBuilderPreview } from './builderPreview.ts'

/**
 * A draft Builder brief handed from the app to the Builder composer. It is only ever inserted as
 * editable text: the owner reviews it and sends the turn. Nothing here starts a session or submits.
 *
 * Outside Builder the draft travels through sessionStorage (same tab, same origin) and the page
 * navigates to Builder. Inside the Builder Preview the app posts it to the containing Builder frame,
 * which inserts it directly.
 */
export const BUILDER_BRIEF_MESSAGE = 'box:builder-brief'

const KEY = appKey('builder', 'brief')
const VERSION = 1
const MAX_AGE_MS = 60 * 60 * 1000
const MAX_LENGTH = 20_000

interface BriefEnvelope { v: number; text: string; createdAt: number }

/** Accepts only a bounded, non-empty string. */
export function validBrief(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_LENGTH ? value : null
}

/** Opens Builder with `text` waiting in its composer. */
export function openBuilderWithBrief(text: string, previewPath = '/'): void {
  if (isBuilderPreview()) {
    window.parent.postMessage({ type: BUILDER_BRIEF_MESSAGE, v: VERSION, text }, location.origin)
    return
  }
  storePendingBrief(text)
  location.assign(`/builder?preview=${encodeURIComponent(previewPath)}`)
}

export function storePendingBrief(text: string): void {
  const envelope: BriefEnvelope = { v: VERSION, text, createdAt: Date.now() }
  try { sessionStorage.setItem(KEY, JSON.stringify(envelope)) } catch { /* storage unavailable: Builder opens without a draft */ }
}

export function readPendingBrief(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const envelope = JSON.parse(raw) as Partial<BriefEnvelope>
    if (envelope.v !== VERSION || typeof envelope.createdAt !== 'number' || Date.now() - envelope.createdAt > MAX_AGE_MS) {
      sessionStorage.removeItem(KEY)
      return null
    }
    return validBrief(envelope.text)
  } catch { return null }
}

export function clearPendingBrief(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}
