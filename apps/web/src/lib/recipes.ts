/**
 * The recipe catalog, read at build time from `recipes/<id>/RECIPE.md` and `recipes/<id>/screenshots/`,
 * plus the recipes the recipe registry offers beyond them at runtime (lib/registryRecipes.ts adds
 * those through `setRemoteRecipes`).
 *
 * `recipes/` is a managed core path: it ships in every Box, so a core-only Box can show what it can
 * adapt without carrying the implementation. A recipe is descriptive. Picking one only drafts a
 * Builder brief; Builder fetches the recipe with `box recipe fetch`, adapts it into `features/<id>/`,
 * and runs the validation chain.
 *
 * What this Box has adapted comes from the `recipes` ledger in `box.json` (lib/recipeLedger.ts).
 *
 * RECIPE.md contract (see recipes/README.md): `# Title`, one summary paragraph, `## Highlights`
 * bullets and an optional `## Builds on` list of links to sibling recipes. A recipe's optional
 * powerups are discovered from `recipes/<id>/powerups/<powerup>/POWERUP.md` (title, summary,
 * `## Highlights`, `## Needs`, `## Requires`), so adding one never edits the recipe.
 */

import { parsePowerup, parseRecipe, type PowerupText, type RecipeText } from './recipeFormat.ts'

export { powerupBrief, recipeBrief, RecipeBook } from './recipeFormat.ts'
export type { PowerupState, PowerupText as Powerup, RecipeState, Requirement } from './recipeFormat.ts'

export interface RecipeScreenshot { src: string; alt: string }

export interface Recipe extends RecipeText {
  screenshots: RecipeScreenshot[]
  powerups: PowerupText[]
  /** Offered by the recipe registry; its docs are not in this Box yet. */
  remote?: boolean
}

const documents = import.meta.glob<string>('../../../../recipes/*/RECIPE.md', { query: '?raw', import: 'default', eager: true })
const images = import.meta.glob<string>('../../../../recipes/*/screenshots/*.{png,jpg,jpeg,webp,svg}', { query: '?url', import: 'default', eager: true })
const powerupDocuments = import.meta.glob<string>('../../../../recipes/*/powerups/*/POWERUP.md', { query: '?raw', import: 'default', eager: true })

const recipeId = (path: string): string | undefined => /\/recipes\/([^/]+)\//.exec(path)?.[1]

function loadRecipes(): Recipe[] {
  const shots = new Map<string, RecipeScreenshot[]>()
  for (const path of Object.keys(images).sort()) {
    const id = recipeId(path)
    if (!id) continue
    const list = shots.get(id) ?? []
    shots.set(id, [...list, { src: images[path]!, alt: '' }])
  }
  const powerups = new Map<string, PowerupText[]>()
  for (const [path, markdown] of Object.entries(powerupDocuments)) {
    const match = /\/recipes\/([^/]+)\/powerups\/([^/]+)\/POWERUP\.md$/.exec(path)
    const parsed = match ? parsePowerup(match[1]!, match[2]!, markdown) : null
    if (parsed) powerups.set(parsed.recipe, [...(powerups.get(parsed.recipe) ?? []), parsed])
  }
  const recipes: Recipe[] = []
  for (const [path, markdown] of Object.entries(documents)) {
    const id = recipeId(path)
    const parsed = id ? parseRecipe(id, markdown) : null
    if (!parsed) continue
    const screenshots = (shots.get(parsed.id) ?? []).map((shot, index) => ({ ...shot, alt: `${parsed.title} screenshot ${index + 1}` }))
    const offered = (powerups.get(parsed.id) ?? []).sort((a, b) => a.title.localeCompare(b.title))
    recipes.push({ ...parsed, screenshots, powerups: offered })
  }
  return recipes.sort((a, b) => a.title.localeCompare(b.title))
}

export const RECIPES: readonly Recipe[] = loadRecipes()

/**
 * The first recipes onboarding offers, in order: small, core-only and useful on day one. Onboarding
 * shows three that are not adapted yet, topping up from the rest of the catalog.
 */
export const RECOMMENDED_RECIPES: readonly string[] = ['reminders', 'chat', 'artifacts']

const titles = new Map(RECIPES.map(recipe => [recipe.id, recipe.title]))
export const recipeTitles: ReadonlyMap<string, string> = titles

let remote: readonly Recipe[] = []

/** Registry recipes whose docs are not in this Box. Ids already in `RECIPES` are ignored. */
export function setRemoteRecipes(recipes: readonly Recipe[]): void {
  const local = new Set(RECIPES.map(recipe => recipe.id))
  for (const recipe of remote) if (!local.has(recipe.id)) titles.delete(recipe.id)
  remote = recipes.filter(recipe => !local.has(recipe.id))
  for (const recipe of remote) titles.set(recipe.id, recipe.title)
}

/** Every recipe the gallery can show: the shipped ones and the registry's extras, by title. */
export function allRecipes(): readonly Recipe[] {
  return remote.length ? [...RECIPES, ...remote].sort((a, b) => a.title.localeCompare(b.title)) : RECIPES
}

export function matchesRecipe(recipe: Recipe, query: string, titles: ReadonlyMap<string, string>): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = [recipe.id, recipe.title, recipe.summary, ...recipe.highlights, ...recipe.buildsOn.map(id => titles.get(id) ?? id), ...recipe.powerups.flatMap(p => [p.title, p.summary])].join(' ').toLowerCase()
  return terms.every(term => haystack.includes(term))
}
