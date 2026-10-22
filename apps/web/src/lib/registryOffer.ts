/**
 * The pure half of lib/registryRecipes.ts: the server's registry answer turned into gallery cards,
 * parsed with the same RECIPE.md and POWERUP.md contract as the shipped docs. No Vite or tRPC
 * imports, so it can be tested directly.
 */
import { parsePowerup, parseRecipe } from './recipeFormat.ts'
import type { Recipe } from './recipes.ts'

export interface RegistryOffer {
  status: 'ok' | 'unavailable' | 'key-rejected'
  keySet: boolean
  /** Registry recipes this Box does not ship docs for, ready for a card. */
  extra: Recipe[]
  /** recipe id -> latest registry version. */
  latest: ReadonlyMap<string, string>
}

export interface RegistryResponse {
  status: RegistryOffer['status']
  keySet: boolean
  recipes: Array<{
    id: string; title: string; latest: string; powerups: string[]; local: boolean
    docs: { recipe: string; powerups: Array<{ id: string; markdown: string }>; screenshots: string[] } | null
  }>
}

export function toOffer(response: RegistryResponse): RegistryOffer {
  const extra: Recipe[] = []
  for (const entry of response.recipes) {
    if (entry.local) continue
    const parsed = entry.docs ? parseRecipe(entry.id, entry.docs.recipe) : null
    const text = parsed ?? { id: entry.id, title: entry.title, summary: 'Available from the recipe registry.', highlights: [], buildsOn: [] }
    const powerups = (entry.docs?.powerups ?? []).flatMap(p => { const one = parsePowerup(entry.id, p.id, p.markdown); return one ? [one] : [] }).sort((a, b) => a.title.localeCompare(b.title))
    const screenshots = (entry.docs?.screenshots ?? []).map((src, index) => ({ src, alt: `${text.title} screenshot ${index + 1}` }))
    extra.push({ ...text, id: entry.id, screenshots, powerups, remote: true })
  }
  return { status: response.status, keySet: response.keySet, extra, latest: new Map(response.recipes.map(r => [r.id, r.latest])) }
}

