import { modelMatches, type ModelOption } from '@workerdeck/protocol'

/**
 * The models the Builder status bar offers, per engine, in display order. Only current
 * generations: the worker's full catalogue also carries previous generations and aliases.
 * Each entry is an exact model id (with an optional [variant]); WorkerDeck matches it against a
 * catalogue option's value or resolved model. The first entry is the start default, mirrored in BUILDER_DEFAULT_MODEL in
 * apps/server/src/builder/builder-host.ts.
 */
export const BUILDER_MODELS: Record<string, readonly string[]> = {
  codex: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'],
  claude: ['claude-opus-5-5[1m]', 'claude-sonnet-5-5', 'claude-fable-5-1[1m]'],
}

/**
 * Narrow the session's catalogue to the curated set. The session's current model stays listed
 * even when it is outside the set, so the select never shows a blank value.
 */
export function builderModelOptions(engine: string | undefined, models: readonly ModelOption[], current: string | undefined): ModelOption[] {
  const curated = BUILDER_MODELS[engine ?? '']
  if (!curated) return [...models]
  const picked = curated.flatMap(id => {
    const option = models.find(model => model.value === id) ?? models.find(model => model.value !== 'default' && modelMatches(model, id))
    return option ? [option] : []
  })
  const active = current ? models.find(model => model.value !== 'default' && modelMatches(model, current)) : undefined
  return active && !picked.includes(active) ? [...picked, active] : picked
}
