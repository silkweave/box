// The signed-in person's own sidebar arrangement (core users/sidebar.ts), the store behind the
// sidebar's Customize mode. The server holds it, so it follows the person across browsers; this
// browser keeps a copy only so the first paint already has the person's order instead of jumping
// from the default once the request answers.

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { SidebarCustomization, SidebarLayout } from '@silkweave/box-ui'
import { appKey } from './storage.ts'
import { trpc } from './trpc.ts'

const KEY = appKey('sidebar', 'layout')

function readLocal(): SidebarLayout | null {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as SidebarLayout) : null
    return v && Array.isArray(v.sections) && Array.isArray(v.groups) && Array.isArray(v.hidden) ? v : null
  } catch {
    return null
  }
}

let layout: SidebarLayout | null = typeof localStorage === 'undefined' ? null : readLocal()
let loading: Promise<void> | null = null
let loaded = false
const listeners = new Set<() => void>()

function put(next: SidebarLayout | null): void {
  layout = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // A full or blocked storage only costs the first-paint copy.
  }
  listeners.forEach((l) => l())
}

function load(): void {
  if (loaded || loading) return
  loading = trpc.usersSidebar
    .query({})
    .then((r) => {
      loaded = true
      put(r.layout)
    })
    .catch(() => {})
    .finally(() => {
      loading = null
    })
}

function save(next: SidebarLayout | null): void {
  put(next)
  void trpc.usersSidebarSave.mutate({ layout: next ? JSON.stringify(next) : undefined }).catch(() => {
    // Refused or offline: show what the server holds rather than a layout that was not kept.
    loaded = false
    load()
  })
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The sidebar's customization seam for the AppShell's group nav. */
export function useSidebarCustomization(): SidebarCustomization {
  const current = useSyncExternalStore(subscribe, () => layout, () => null)
  useEffect(load, [])
  return useMemo(() => ({ layout: current, onChange: save }), [current])
}
