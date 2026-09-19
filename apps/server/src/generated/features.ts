// Core-only consumer registration.
import type { ServerFeature } from '../feature.js'

export const SERVER_FEATURES = [] as const satisfies readonly ServerFeature[]
export const SERVER_FEATURE_LIST: readonly ServerFeature[] = SERVER_FEATURES
