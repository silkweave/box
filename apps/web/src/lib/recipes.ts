/**
 * The recipe catalog, read at build time from `recipes/<id>/RECIPE.md` and `recipes/<id>/screenshots/`.
 *
 * `recipes/` is a managed core path: it ships in every Box, so a core-only Box can show what the
 * Stack offers without carrying its implementation. A recipe is descriptive. Picking one only drafts
 * a Builder brief; Builder still reads the recipe docs, fetches the implementation with
 * `box stack fetch`, adapts it into `features/<id>/`, and runs the validation chain.
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

export const recipeTitles: ReadonlyMap<string, string> = new Map(RECIPES.map(recipe => [recipe.id, recipe.title]))

export function matchesRecipe(recipe: Recipe, query: string, titles: ReadonlyMap<string, string>): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = [recipe.id, recipe.title, recipe.summary, ...recipe.highlights, ...recipe.buildsOn.map(id => titles.get(id) ?? id), ...recipe.powerups.flatMap(p => [p.title, p.summary])].join(' ').toLowerCase()
  return terms.every(term => haystack.includes(term))
}
