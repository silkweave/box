/**
 * The recipe registry's offer for this Box, merged into the gallery at runtime. The server asks the
 * registry (with this Box's access key, which never reaches the browser) and returns, for each
 * recipe whose docs are not in `recipes/`, its RECIPE.md, POWERUP.md texts and screenshot URLs from
 * the verified local cache. Parsed with the same contract as the shipped docs.
 */
import { createDataStore } from './dataStore.ts'
import { setRemoteRecipes } from './recipes.ts'
import { toOffer, type RegistryOffer, type RegistryResponse } from './registryOffer.ts'
import { trpc } from './trpc.ts'

export type { RegistryOffer } from './registryOffer.ts'

const store = createDataStore<RegistryOffer>(async () => {
  const offer = toOffer((await trpc.recipesRegistry.query({})) as unknown as RegistryResponse)
  setRemoteRecipes(offer.extra)
  return offer
})

export const useRegistryOffer = (): { data: RegistryOffer | null; error: string | null } => store.useData()
