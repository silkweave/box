import { useEffect, useState } from 'react'
import { registerStoreReloads } from './changeFeed.ts'
import { createDataStore, type DataStore } from './dataStore.ts'
import { trpc } from './trpc.ts'
import { getActiveUserId } from './useActiveUser.ts'

// Core's ops data layer - the action registry (every present feature's runnable actions), the
// persisted run history, and Run Now. One shared store per payload (see dataStore.ts).

export interface Action {
  id: string
  label: string
  group: string
  description: string
  plugin?: boolean
  entryPath?: string
  /** Needs per-run params (verify-engagement) - not schedulable, hidden from the Run console. */
  parameterized?: boolean
}

export type RunStatus = 'queued' | 'running' | 'success' | 'error' | 'skipped'

export interface Run {
  id: string
  schedule_id: string | null
  action_id: string
  trigger: 'schedule' | 'manual'
  triggered_by: string | null
  status: RunStatus
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  summary: string | null
  error: string | null
}

export interface RunLogLine {
  ts: string
  channel: string
  phase: string
  message: string
}

export interface RunWithLog extends Run {
  log: RunLogLine[]
}

/** Stale-while-revalidate on mount: render the cache immediately, but always refetch so a view
 *  never shows a state (e.g. a spinning run) that settled while it was unmounted. */
export function useFresh<T>(store: DataStore<T>): { data: T | null; error: string | null } {
  const { data, error } = store.useData()
  const [reloadError, setReloadError] = useState<string | null>(null)
  useEffect(() => {
    store.reload().catch((e) => setReloadError(String(e)))
  }, [store])
  return { data, error: error ?? reloadError }
}

// The runs store owns run-state liveness: while any cached run is queued/running it keeps polling
// itself, no matter which view (if any) is mounted - runs execute detached on the server, so the
// consumer that started one may be long gone by the time it settles. Every view (runs list, run
// detail, sidebar counts) draws from this one cache and stays in sync.
const RUNS_POLL_MS = 5_000
let runsPollTimer: ReturnType<typeof setTimeout> | undefined

function scheduleRunsPoll(runs: Run[]): void {
  clearTimeout(runsPollTimer)
  runsPollTimer = undefined
  if (!runs.some((r) => r.status === 'queued' || r.status === 'running')) return
  runsPollTimer = setTimeout(() => {
    runsPollTimer = undefined
    void runsStore.reload().catch(() => undefined) // reload re-arms via the fetcher; a failed poll retries on the next trigger
  }, RUNS_POLL_MS)
}

const runsStore = createDataStore<Run[]>(() =>
  trpc.opsRuns.query({}).then((d) => {
    const runs = ((d as { runs?: unknown[] }).runs ?? []) as Run[]
    scheduleRunsPoll(runs) // re-arms on every (re)fetch, no matter who triggered it
    return runs
  }),
)
const actionsStore = createDataStore<Action[]>(() =>
  trpc.opsActions.query({}).then((d) => ((d as { actions?: unknown[] }).actions ?? []) as Action[]),
)
registerStoreReloads(['table:automation_runs'], runsStore)

export const useRuns = (): { data: Run[] | null; error: string | null } => useFresh(runsStore)
export const reloadRuns = runsStore.reload
export const useActions = (): { data: Action[] | null; error: string | null } => useFresh(actionsStore)

/** One run with its stored log (a mutation because it carries an input - repo convention). */
export async function fetchRun(id: string): Promise<RunWithLog> {
  return (await trpc.opsRun.mutate({ id })) as unknown as RunWithLog
}

export interface ProgressChunk {
  channel: string
  phase: 'start' | 'fetch' | 'persist' | 'done'
  message: string
  result?: unknown
}

/**
 * Run any action now, streaming progress. Recorded in history as trigger:'manual',
 * attributed to the active user. Returns the unsubscribe handle.
 */
export function runNow(
  actionId: string,
  handlers: { onData: (p: ProgressChunk) => void; onError: (e: { message: string }) => void; onComplete?: () => void },
  opts: { scheduleId?: string; date?: string; params?: Record<string, string> } = {},
): { unsubscribe: () => void } {
  const sub = trpc.opsRunNow.subscribe(
    {
      action_id: actionId,
      schedule_id: opts.scheduleId,
      triggered_by: getActiveUserId() ?? undefined,
      date: opts.date,
      // Parameterized actions (source-sync, pod-engagement-verify) carry their args as a JSON
      // object string - the server's scalar-input convention.
      ...(opts.params ? { params: JSON.stringify(opts.params) } : {}),
    },
    {
      onData: (p) => handlers.onData(p as ProgressChunk),
      onError: handlers.onError,
      onComplete: () => {
        void runsStore.reload().catch(() => undefined)
        handlers.onComplete?.()
      },
    },
  )
  // Seed the runs cache so the new row appears and the store's active-run poll arms itself, even
  // if this subscriber unsubscribes right away (the run executes detached server-side). Twice:
  // now, and again after the server has definitely inserted the row (the immediate reload can
  // race the insert by milliseconds - then no run looks active and no poll would arm).
  void runsStore.reload().catch(() => undefined)
  setTimeout(() => void runsStore.reload().catch(() => undefined), 2_500)
  return sub
}
