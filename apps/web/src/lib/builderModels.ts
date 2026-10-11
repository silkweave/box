import type { ModelOption } from '@workerdeck/protocol'

/**
 * The models the Builder status bar offers, per engine, in display order. Only current
 * generations: the worker's full catalogue also carries previous generations and aliases.
 * Each entry lists the ids a catalogue option may use for it (alias, pinned id, resolved id).
 * The first entry is the start default, mirrored in BUILDER_DEFAULT_MODEL in
 * apps/server/src/builder/builder-host.ts.
 */
export const BUILDER_MODELS: Record<string, readonly (readonly string[])[]> = {
  codex: [['gpt-5.6-luna'], ['gpt-5.6-terra'], ['gpt-5.6-sol'], ['gpt-6-astra']],
  claude: [['opus[1m]', 'claude-opus-5-5'], ['sonnet', 'claude-sonnet-5-5'], ['claude-fable-5-1[1m]', 'claude-fable-5-1']],
}

const bare = (id: string): string => id.replace(/\[.*\]$/, '')

const matches = (option: ModelOption, id: string): boolean =>
  [option.value, option.resolvedModel].some(candidate => candidate !== undefined && (candidate === id || bare(candidate) === bare(id)))

/**
 * Narrow the session's catalogue to the curated set. The session's current model stays listed
 * even when it is outside the set, so the select never shows a blank value.
 */
export function builderModelOptions(engine: string | undefined, models: readonly ModelOption[], current: string | undefined): ModelOption[] {
  const curated = BUILDER_MODELS[engine ?? '']
  if (!curated) return [...models]
  const picked = curated.flatMap(ids => {
    const option = models.find(model => model.value === ids[0]) ?? models.find(model => ids.some(id => matches(model, id)))
    return option ? [option] : []
  })
  const active = current ? models.find(model => matches(model, current)) : undefined
  return active && !picked.includes(active) ? [...picked, active] : picked
}
