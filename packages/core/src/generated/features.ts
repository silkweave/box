// Core-only consumer registration.
import type { CoreFeature } from '../feature.js'

export const FEATURES = [] as const satisfies readonly CoreFeature[]
export const FEATURE_LIST: readonly CoreFeature[] = FEATURES
