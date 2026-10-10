// The event ports: how an event source works with whatever acts on events without importing it
// ("the dependent registers into the dependency"; docs/core/SEAM.md). Each is registered once from a
// server module's onModuleInit; a CLI or test that never boots that module sees the defaults.
//
// - Interest. A source that costs something to poll asks `eventWanted(kind)` first. Automation
//   registers the answer (an enabled event trigger listens for the kind); with nothing registered,
//   nobody listens and the answer is false.
// - Delivery. A source that just recorded a batch calls `flushDeliveries()` so the batch goes out as
//   one message per target now instead of after the debounce. Automation's `alerts` powerup
//   registers the flusher; without it the call is a no-op that returns null.
// - Links. `eventLink(kind, dedupKey, fields)` is the dashboard link for an event, when a feature
//   maps that kind to a page of its own (engagement: the tactical Inbox). Null when none does.

/** What one delivery pass did. */
export interface DeliveryResult {
  delivered: number
  suppressed: number
  failed: number
  /** How many messages actually went out (at most `delivered`: batching collapses them). */
  messages: number
}

export type EventInterest = (kind: string) => Promise<boolean>
export type DeliveryFlusher = () => Promise<DeliveryResult>
export type EventLinker = (kind: string, dedupKey: string, fields: Record<string, unknown>) => string | null

let interest: { id: string; fn: EventInterest } | null = null
let flusher: { id: string; fn: DeliveryFlusher } | null = null
const linkers: { id: string; fn: EventLinker }[] = []

function single<T extends { id: string }>(current: T | null, next: T, what: string): T {
  if (current) throw new Error(`${what} registered twice ("${current.id}", then "${next.id}")`)
  return next
}

/** Register the answer to "does anything listen for this kind". One per Box. */
export function registerEventInterest(id: string, fn: EventInterest): () => void {
  const entry = single(interest, { id, fn }, 'event interest')
  interest = entry
  return () => {
    if (interest === entry) interest = null
  }
}

/** True when something acts on events of `kind`; false when nothing is registered to ask. */
export async function eventWanted(kind: string): Promise<boolean> {
  return interest ? interest.fn(kind) : false
}

/** Register the delivery flusher. One per Box. */
export function registerDeliveryFlusher(id: string, fn: DeliveryFlusher): () => void {
  const entry = single(flusher, { id, fn }, 'delivery flusher')
  flusher = entry
  return () => {
    if (flusher === entry) flusher = null
  }
}

/** Deliver everything pending now, or null when nothing delivers in this Box. */
export async function flushDeliveries(): Promise<DeliveryResult | null> {
  return flusher ? flusher.fn() : null
}

/** One line for a run summary: what the flush delivered, or that nothing delivers here. */
export function deliverySummary(result: DeliveryResult | null): string {
  if (!result) return 'no delivery in this Box'
  return `delivered ${result.delivered} in ${result.messages} message(s), suppressed ${result.suppressed}, failed ${result.failed}`
}

/** Register a dashboard link resolver for the event kinds a feature owns a page for. */
export function registerEventLinker(id: string, fn: EventLinker): () => void {
  if (linkers.some((l) => l.id === id)) throw new Error(`event linker "${id}" registered twice`)
  const entry = { id, fn }
  linkers.push(entry)
  return () => {
    const i = linkers.indexOf(entry)
    if (i >= 0) linkers.splice(i, 1)
  }
}

/** The first registered link for the event, or null. */
export function eventLink(kind: string, dedupKey: string, fields: Record<string, unknown>): string | null {
  for (const { fn } of linkers) {
    const link = fn(kind, dedupKey, fields)
    if (link) return link
  }
  return null
}
