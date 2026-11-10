// The owning area stored on a shared core row (PERMISSIONS 8.1 to 8.3): `signals.area`,
// `snapshots.area`, `automation_runs.area` and each member of `events.areas`. Always declared by
// the writer from the data it writes, never guessed from free strings. A row nothing can classify
// gets `admin`, readable only with admin authority.

import { FEATURE_LIST } from '../generated/features.js'
import { CORE_AREAS } from './access.js'
import { ADMIN_AREA } from './levels.js'

// The pseudo-area of rows nothing classifies; the executor adds it to an admin's area lists.
export { ADMIN_AREA }

/** Whether `area` can be stored as an owning area: an installed feature, a core area, or `admin`. */
export function isStoredArea(area: string): boolean {
  return area === ADMIN_AREA || (CORE_AREAS as readonly string[]).includes(area) || FEATURE_LIST.some((f) => f.id === area)
}

/** `area`, checked; throws for anything that is not an installed feature, a core area or `admin`. */
export function storedArea(area: string): string {
  if (typeof area !== 'string' || !isStoredArea(area)) {
    throw new Error(`"${String(area)}" is not an owning area (an installed feature, signals, ops or admin)`)
  }
  return area
}

/** The area of a Box tracker key (`<feature>.<name>`): its feature, or `admin` when the prefix
 *  names no installed feature (nothing classifies it, 8.3). */
export function trackerArea(key: string): string {
  const feature = key.split('.')[0] ?? ''
  return FEATURE_LIST.some((f) => f.id === feature) ? feature : ADMIN_AREA
}
