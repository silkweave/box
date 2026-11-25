import { appKey } from './storage.ts'
import { isBuilderPreview } from './builderPreview.ts'

/**
 * A Builder brief handed from the app to Builder. Builder shows it as a card above the composer
 * (what will be done, the choices, the steps) and the owner sends it, edits it as text or discards
 * it. Nothing here starts a session or submits a turn: the full prompt is sent only by the owner.
 *
 * Outside Builder the brief travels through sessionStorage (same tab, same origin) and the page
 * navigates to Builder. Inside the Builder Preview the app posts it to the containing Builder frame.
 */
export const BUILDER_BRIEF_MESSAGE = 'box:builder-brief'

const KEY = appKey('builder', 'brief')
const VERSION = 2
const MAX_AGE_MS = 60 * 60 * 1000
const MAX_LENGTH = 20_000
const MAX_CARD_TEXT = 400
const MAX_CARD_ITEMS = 12

/** What the owner reads before sending: a title, a line of context, named groups and the steps. */
export interface BriefCard {
  title: string
  summary?: string
  /** Named lists, such as "Builds on" or "Powerups to choose from". */
  groups?: { label: string; items: string[] }[]
  /** What the agent will do, in order. */
  steps?: string[]
}

export interface BuilderBrief {
  /** The full prompt the agent receives. */
  text: string
  card?: BriefCard
}

interface BriefEnvelope { v: number; brief: BuilderBrief; createdAt: number }

const cardText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, MAX_CARD_TEXT) : null
const cardList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(cardText).filter((item): item is string => item !== null).slice(0, MAX_CARD_ITEMS) : []

function validCard(value: unknown): BriefCard | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const title = cardText(raw['title'])
  if (!title) return undefined
  const summary = cardText(raw['summary'])
  const groups = Array.isArray(raw['groups'])
    ? raw['groups'].flatMap((group: unknown) => {
        const g = group as Record<string, unknown> | null
        const label = cardText(g?.['label'])
        const items = cardList(g?.['items'])
        return label && items.length ? [{ label, items }] : []
      }).slice(0, 4)
    : []
  const steps = cardList(raw['steps'])
  return { title, ...(summary ? { summary } : {}), ...(groups.length ? { groups } : {}), ...(steps.length ? { steps } : {}) }
}

/** Accepts a bounded, non-empty prompt, as a plain string or a brief with a card. */
export function validBrief(value: unknown): BuilderBrief | null {
  const raw = typeof value === 'string' ? { text: value } : value && typeof value === 'object' ? value as Record<string, unknown> : null
  const text = raw?.['text']
  if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_LENGTH) return null
  const card = validCard(raw?.['card'])
  return card ? { text, card } : { text }
}

/** Opens Builder with `brief` waiting as a card for the owner to send. */
export function openBuilderWithBrief(brief: string | BuilderBrief, previewPath = '/'): void {
  const value = typeof brief === 'string' ? { text: brief } : brief
  if (isBuilderPreview()) {
    window.parent.postMessage({ type: BUILDER_BRIEF_MESSAGE, v: VERSION, brief: value }, location.origin)
    return
  }
  storePendingBrief(value)
  location.assign(`/builder?preview=${encodeURIComponent(previewPath)}`)
}

export function storePendingBrief(brief: BuilderBrief): void {
  const envelope: BriefEnvelope = { v: VERSION, brief, createdAt: Date.now() }
  try { sessionStorage.setItem(KEY, JSON.stringify(envelope)) } catch { /* storage unavailable: Builder opens without a brief */ }
}

export function readPendingBrief(): BuilderBrief | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const envelope = JSON.parse(raw) as Partial<BriefEnvelope>
    if (envelope.v !== VERSION || typeof envelope.createdAt !== 'number' || Date.now() - envelope.createdAt > MAX_AGE_MS) {
      sessionStorage.removeItem(KEY)
      return null
    }
    return validBrief(envelope.brief)
  } catch { return null }
}

export function clearPendingBrief(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}

/** The brief's message from the Preview frame, or null when it is not a valid one. */
export function briefFromMessage(data: unknown): BuilderBrief | null {
  const message = data as { type?: unknown; v?: unknown; brief?: unknown } | null
  return message?.type === BUILDER_BRIEF_MESSAGE && message.v === VERSION ? validBrief(message.brief) : null
}
