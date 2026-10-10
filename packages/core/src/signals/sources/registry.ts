// The provider registry: a core port. A provider is CODE that a recipe or powerup registers at
// boot (`registerProvider`, from its server module); core ships none, and every consumer handles
// zero (the catalogue renders empty, `requireProvider` refuses with "(none)").
//
// The dependency direction must not be reversed: the registering feature -> provider -> kit. A
// provider imports only @silkweave/box-provider-kit, never @silkweave/box-core, so it cannot reach
// the warehouse the pure-fetcher contract keeps it out of; the kit carries the signal vocabulary
// and the fetch helpers for that reason.

import type { Provider, ProviderMeasure } from '@silkweave/box-provider-kit'

const PROVIDERS = new Map<string, Provider>()

/** Register a provider. Returns the unregister function. Ids are unique. */
export function registerProvider(provider: Provider): () => void {
  if (PROVIDERS.has(provider.id)) throw new Error(`provider "${provider.id}" registered twice`)
  PROVIDERS.set(provider.id, provider)
  return () => {
    if (PROVIDERS.get(provider.id) === provider) PROVIDERS.delete(provider.id)
  }
}

export function listProviders(): Provider[] {
  return [...PROVIDERS.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** One provider, or null when the id names nothing registered (a row can outlive its provider). */
export function findProvider(id: string): Provider | null {
  return PROVIDERS.get(id) ?? null
}

/** One provider, or a refusal listing what IS registered. */
export function requireProvider(id: string): Provider {
  const p = PROVIDERS.get(id)
  if (!p) {
    throw new Error(`unknown provider "${id}" - registered providers: ${[...PROVIDERS.keys()].sort().join(', ') || '(none)'}`)
  }
  return p
}

/** One measure of a provider's catalogue, or null. Measure keys are the provider's native tokens. */
export function findMeasure(provider: Provider, key: string): ProviderMeasure | null {
  return provider.measures.find((s) => s.key === key) ?? null
}
