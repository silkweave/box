// The action registry - the one place that knows every runnable action in this Box. It is not a
// hand-maintained list: it is the union of what every present feature declares in its manifest.

import { FEATURE_LIST } from '../generated/features.js'
import { CORE_ACTIONS } from './core-actions.js'
import type { ActionInfo, ActionRunOpts, ActionSpec, IngestProgress } from './types.js'

let cache: Map<string, ActionSpec> | null = null

function index(): Map<string, ActionSpec> {
  if (cache) return cache
  const map = new Map<string, ActionSpec>()
  const contributions: [string, readonly ActionSpec[]][] = [
    ['core', CORE_ACTIONS],
    ...FEATURE_LIST.map((f): [string, readonly ActionSpec[]] => [f.id, f.actions ?? []]),
  ]
  const owner = new Map<string, string>()
  for (const [id, specs] of contributions) {
    for (const spec of specs) {
      const prev = owner.get(spec.id)
      if (prev) throw new Error(`action "${spec.id}" is declared by both "${prev}" and "${id}"`)
      owner.set(spec.id, id)
      map.set(spec.id, spec)
    }
  }
  cache = map
  return map
}

/** Every runnable action, catalog view (no runner) - the dashboard grid, the scheduler, MCP. */
export function listAutomationActions(): ActionInfo[] {
  return [...index().values()].map(({ run: _run, ...info }) => info)
}

/** The full spec, or null if nothing declares the id. */
export function resolveAction(id: string): ActionSpec | null {
  return index().get(id) ?? null
}

/** Resolve an action id to a runnable generator factory, or null if nothing declares it. */
export function resolveRunner(actionId: string, opts: ActionRunOpts = {}): (() => AsyncGenerator<IngestProgress>) | null {
  const spec = resolveAction(actionId)
  return spec ? () => spec.run(opts) : null
}
