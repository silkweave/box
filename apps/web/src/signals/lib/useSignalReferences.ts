import { useEffect, useState } from 'react'
import { trpc } from '../../lib/trpc.ts'

// Where a signal is used (core `signal-references`): the goals, milestones and trigger filters that
// name it, each labelled, with how it uses the signal and a link. Read when a signal's detail or its
// dialog opens, not cached: a goal bound elsewhere should show the next time.

export interface SignalReference {
  kind: string
  id: string
  label: string
  via: string
  href: string | null
}

export function useSignalReferences(signalId: string | null): { references: SignalReference[] | null; error: string | null } {
  const [state, setState] = useState<{ id: string | null; references: SignalReference[] | null; error: string | null }>({ id: null, references: null, error: null })
  useEffect(() => {
    if (!signalId) return
    let live = true
    trpc.signalsReferences
      .query({ id: signalId })
      .then((r) => live && setState({ id: signalId, references: (r as { references: SignalReference[] }).references, error: null }))
      .catch((e: unknown) => live && setState({ id: signalId, references: null, error: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
  }, [signalId])
  return state.id === signalId ? { references: state.references, error: state.error } : { references: null, error: null }
}
