// Core-only consumer registration.
import type { WebFeature } from '../feature.js'

export const WEB_FEATURES = [] as const satisfies readonly WebFeature[]
export const WEB_FEATURE_LIST: readonly WebFeature[] = WEB_FEATURES
export const WEB_ROUTES = [] as const
