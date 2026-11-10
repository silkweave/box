// Who may see a change event (W8 R3, PERMISSIONS 8.1): the change feed is invalidation hints only,
// but a scope and its detail still say where activity happens (a docs event names the file). Each
// subscriber gets only the scopes of areas it reads:
//
//   - `table:<name>`: a feature's table goes to readers of that feature. Core's tables whose rows
//     carry their own areas (signals, points, snapshots, events, runs) go to readers of the areas
//     the writer recorded on the change (`ChangeEvent.areas`: a row table to readers of any of
//     them, an event to readers of all), without the detail (a run id) unless the reader is an
//     admin; such a change without areas goes to admins only. The directory (users, roles, fx
//     rates) goes to every principal. Data sources go to signals readers; any other table to
//     admins.
//   - `docs:<section>`: readers of the feature declaring the section (manifest `docSections`).
//   - `config:<file>`: admins.
//   - `<feature>:<topic>` (e.g. `crm:deals`): readers of that feature.
//   - `hello`, `ping` and `policy` (the feed's own; `policy` tells the client to refetch its access)
//     always pass. Anything else goes to admins.

import type { ChangeEvent } from './changes.js'
import { FEATURE_LIST } from './generated/features.js'
import { canAccess, canReachArea, canReachAreas, hasAdminAuthority } from './request-context.js'

const ROW_AREA_TABLES = new Set(['signals', 'signal_points', 'snapshots', 'automation_runs'])
const DIRECTORY_TABLES = new Set(['users', 'roles', 'fx_rates'])
const ALWAYS = new Set(['hello', 'ping', 'policy'])

/**
 * The area a scope belongs to: a feature or core area, `*` for every principal, `admin` for admins,
 * `rows` for a shared core table whose change carries the rows' areas.
 */
export function changeScopeArea(scope: string): string {
  if (ALWAYS.has(scope)) return '*'
  const at = scope.indexOf(':')
  const kind = at < 0 ? scope : scope.slice(0, at)
  const name = at < 0 ? '' : scope.slice(at + 1)
  if (kind === 'table') {
    if (ROW_AREA_TABLES.has(name) || name === 'events') return 'rows'
    if (DIRECTORY_TABLES.has(name)) return '*'
    if (name === 'data_sources') return 'signals'
    return FEATURE_LIST.find((f) => f.models.some((m) => m.table === name))?.id ?? 'admin'
  }
  if (kind === 'docs') return FEATURE_LIST.find((f) => f.docSections?.includes(name))?.id ?? 'admin'
  if (kind === 'config') return 'admin'
  return FEATURE_LIST.some((f) => f.id === kind) ? kind : 'admin'
}

/** The change as the current scope may see it (areas never, a shared row's detail to admins only), or null. */
export function visibleChange(ev: ChangeEvent): ChangeEvent | null {
  const { areas, ...out } = ev
  const area = changeScopeArea(ev.scope)
  if (area === '*') return out
  if (area === 'admin') return hasAdminAuthority() ? out : null
  if (area !== 'rows') return canAccess(area, 'read') ? out : null
  if (hasAdminAuthority()) return out
  if (!areas?.length) return null
  const seen = ev.scope === 'table:events' ? canReachAreas(areas, 'read') : areas.some((a) => canReachArea(a, 'read'))
  return seen ? { ...out, detail: null } : null
}
