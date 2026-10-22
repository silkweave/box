// A feature's own background capabilities: box.json `background.features.<feature-id>.<capability>`.
// The feature declares each capability in its core manifest (`background`); box-json.ts parses the
// section without knowing any feature, and this module ties the two together: the one accessor
// features read their switch through, and the boot check that refuses a capability a registered
// feature does not declare (almost always a typo, which would otherwise read as "off" forever).
// Ids of features this Box has not adapted are accepted: a shared box.json may name them.
//
// Maintenance boots force every capability off: boxJson() then returns an empty `features`.

import { boxJson } from './box-config.js'
import type { BoxJson } from './box-json.js'
import type { CoreFeature } from './feature.js'
import { FEATURE_LIST } from './generated/features.js'

/** The capabilities `feature` declares, by key, with what each arms. */
export function backgroundCapabilities(feature: CoreFeature): Readonly<Record<string, string>> {
  return feature.background ?? {}
}

/**
 * Configured capabilities a registered feature does not declare, as messages naming the key.
 * Pure over its inputs, so tests can pass their own feature list.
 */
export function backgroundProblems(config: BoxJson = boxJson(), features: readonly CoreFeature[] = FEATURE_LIST): string[] {
  const problems: string[] = []
  for (const [id, flags] of Object.entries(config.background.features)) {
    const feature = features.find((f) => f.id === id)
    if (!feature) continue
    const declared = Object.keys(backgroundCapabilities(feature))
    for (const key of Object.keys(flags)) {
      if (declared.includes(key)) continue
      problems.push(`box.json background.features.${id}: unknown capability ${JSON.stringify(key)} (declared: ${declared.join(', ') || 'none'})`)
    }
  }
  return problems
}

/** Refuse a configuration whose `background.features` names a capability its feature does not declare. */
export function assertBackgroundDeclared(config: BoxJson = boxJson(), features: readonly CoreFeature[] = FEATURE_LIST): void {
  const problems = backgroundProblems(config, features)
  if (problems.length) throw new Error(problems.join('; '))
}

/**
 * Whether `capability` of `featureId` is armed on this Box, read at call time and never cached.
 * Throws when the feature is not registered or does not declare the capability: a reader of an
 * undeclared switch is a programming error, not a switch that is off.
 */
export function isBackgroundEnabled(featureId: string, capability: string, features: readonly CoreFeature[] = FEATURE_LIST): boolean {
  const feature = features.find((f) => f.id === featureId)
  if (!feature) throw new Error(`background: feature ${JSON.stringify(featureId)} is not registered`)
  if (!Object.hasOwn(backgroundCapabilities(feature), capability)) {
    throw new Error(`background: feature ${JSON.stringify(featureId)} does not declare capability ${JSON.stringify(capability)}`)
  }
  return boxJson().background.features[featureId]?.[capability] === true
}
