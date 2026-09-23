// The live-refresh feed: one `changesFeed` tRPC subscription (SSE) per tab, streaming invalidation
// hints from the server's change bus - `table:<name>` for warehouse writes (web UI, MCP agents,
// REST, cron ingests), `docs:<section>` / `config:<file>` for tenant file edits (local Claude
// sessions, editors), `warehouse` for external DuckDB writers. Store modules self-register the
// scopes they depend on; a matching event reloads the store (debounced, and only if it has ever
// loaded - a page you never visited costs nothing). So agent-made changes appear in an open
// dashboard within moments, without polling.
//
// Resync: the server prefixes the stream with a `hello` event carrying its boot id. There is no
// event replay - any hello after the first (SSE reconnect, server restart) means events may have
// been missed, so every loaded store reloads.

import { trpc } from './trpc.ts'
import { whilePageActive } from './pageLifecycle.ts'

interface ChangeEvent {
  seq: number
  ts: string
  scope: string
  detail: string | null
}

interface Registration {
  scopes: string[]
  fire: (ev: ChangeEvent) => void
}

const DEBOUNCE_MS = 300
const RETRY_MS = 5_000

const registry: Registration[] = []

const matches = (registered: string, ev: ChangeEvent): boolean =>
  registered === ev.scope ||
  // A generic external-writer event invalidates every table-scoped registration.
  (ev.scope === 'warehouse' && registered.startsWith('table:'))

/** Register a data store: a matching change event reloads it (debounced; no-op until first load).
 *  Structurally typed to the two members it uses, so any DataStore<T> fits. */
export function registerStoreReloads(scopes: string[], store: { peek(): unknown; reload(): Promise<unknown> }): void {
  let timer: number | undefined
  registry.push({
    scopes,
    fire: () => {
      if (store.peek() === null) return
      if (timer !== undefined) clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = undefined
        void store.reload().catch(() => undefined)
      }, DEBOUNCE_MS)
    },
  })
}

/**
 * Component-level escape hatch for state that doesn't live in a global data store (e.g.
 * useInboxState, per-doc editors): call `cb` on every matching event, debounced. Returns the
 * unsubscribe function - pair it with the effect teardown.
 */
export function subscribeChanges(scopes: string[], cb: (ev: ChangeEvent) => void): () => void {
  let timer: number | undefined
  const reg: Registration = {
    scopes,
    fire: (ev) => {
      if (timer !== undefined) clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = undefined
        cb(ev)
      }, DEBOUNCE_MS)
    },
  }
  registry.push(reg)
  return () => {
    const i = registry.indexOf(reg)
    if (i >= 0) registry.splice(i, 1)
    if (timer !== undefined) clearTimeout(timer)
  }
}

const dispatch = (ev: ChangeEvent): void => {
  for (const reg of registry) {
    if (reg.scopes.some((s) => matches(s, ev))) reg.fire(ev)
  }
}

const reloadAll = (): void => {
  const ev: ChangeEvent = { seq: 0, ts: new Date().toISOString(), scope: 'hello', detail: null }
  for (const reg of registry) reg.fire(ev)
}

let started = false
let sawHello = false
let active = false
let activeSub: { unsubscribe(): void } | undefined
let retry: number | undefined

function reconnect(): void {
  if (!active || retry !== undefined) return
  retry = window.setTimeout(() => { retry = undefined; connect() }, RETRY_MS)
}

function connect(): void {
  if (!active) return
  const sub = trpc.changesFeed.subscribe(
    {},
    {
      onData: (raw) => {
        if (activeSub !== sub) return
        const ev = raw as ChangeEvent
        if (ev.scope === 'ping') return
        if (ev.scope === 'hello') {
          // Reconnect or server restart after the first hello: events may have been missed.
          if (sawHello) reloadAll()
          sawHello = true
          return
        }
        dispatch(ev)
      },
      // The SSE link reconnects transient drops itself; these fire on fatal errors (auth expiry,
      // server gone during a deploy) - back off and resubscribe from scratch.
      onError: () => {
        if (activeSub !== sub) return
        activeSub = undefined
        sub.unsubscribe()
        reconnect()
      },
      onComplete: () => {
        if (activeSub !== sub) return
        activeSub = undefined
        reconnect()
      },
    },
  )
  activeSub = sub
}

/** Start the feed (idempotent). Called from the auth gate once a session is established. */
export function startChangeFeed(): void {
  if (started) return
  started = true
  whilePageActive(() => {
    active = true
    connect()
    return () => {
      active = false
      const sub = activeSub
      activeSub = undefined
      sub?.unsubscribe()
      if (retry !== undefined) clearTimeout(retry)
      retry = undefined
    }
  })
}
