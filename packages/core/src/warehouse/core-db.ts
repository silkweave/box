// Core's Kysely instance: its shared tables on box_core (reach `core`). For core accessors only;
// a feature uses its own `featureDb` and reaches core through core's exports.

import { coreDb } from './kysely.js'
import type { CoreDb } from './core-models.js'

export const db = coreDb<CoreDb>()
