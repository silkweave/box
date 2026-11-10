// The running Box's area map (pg/areas.ts) over core's models and the registered features: where
// a table lives and which login reaches it. Built on first use, after registration is complete.
//
//   table(m)     `"schema"."table"` for SQL
//   reachOf(m)   `core` for core's shared tables (box_core), `area` for a feature's (role login)

import { FEATURE_LIST } from '../generated/features.js'
import type { Reach } from './executor.js'
import { CORE_MODELS } from './core-models.js'
import type { ModelSpec } from './model.js'
import { buildAreaMap, type AreaMap } from './pg/areas.js'

let map: AreaMap | null = null

export function boxAreas(): AreaMap {
  return (map ??= buildAreaMap(CORE_MODELS, FEATURE_LIST))
}

/** `"schema"."table"` for a model or a bare table name. */
export function table(t: string | ModelSpec): string {
  return boxAreas().qualify(t)
}

/** The executor reach of a table: core's shared tables go through box_core. */
export function reachOf(t: string | ModelSpec): Reach {
  return boxAreas().ownerOf(typeof t === 'string' ? t : t.table) === 'core' ? 'core' : 'area'
}
