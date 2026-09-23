/**
 * The recipe catalog, read at build time from `recipes/<id>/RECIPE.md` and `recipes/<id>/screenshots/`.
 *
 * `recipes/` is a managed core path: it ships in every Box, so a core-only Box can show what the
 * Stack offers without carrying its implementation. A recipe is descriptive. Picking one only drafts
 * a Builder brief; Builder still reads the recipe docs, fetches the implementation with
 * `box stack fetch`, adapts it into `features/<id>/`, and runs the validation chain.
 *
 * RECIPE.md contract (see recipes/README.md): `# Title`, one summary paragraph, `## Highlights`
 * bullets, and an optional `## Builds on` list of links to sibling recipes.
 */

import { parseRecipe, type RecipeText } from './recipeFormat.ts'

export interface RecipeScreenshot { src: string; alt: string }

export interface Recipe extends RecipeText {
  screenshots: RecipeScreenshot[]
}

const documents = import.meta.glob<string>('../../../../recipes/*/RECIPE.md', { query: '?raw', import: 'default', eager: true })
const images = import.meta.glob<string>('../../../../recipes/*/screenshots/*.{png,jpg,jpeg,webp,svg}', { query: '?url', import: 'default', eager: true })

const recipeId = (path: string): string | undefined => /\/recipes\/([^/]+)\//.exec(path)?.[1]

function loadRecipes(): Recipe[] {
  const shots = new Map<string, RecipeScreenshot[]>()
  for (const path of Object.keys(images).sort()) {
    const id = recipeId(path)
    if (!id) continue
    const list = shots.get(id) ?? []
    shots.set(id, [...list, { src: images[path]!, alt: '' }])
  }
  const recipes: Recipe[] = []
  for (const [path, markdown] of Object.entries(documents)) {
    const id = recipeId(path)
    const parsed = id ? parseRecipe(id, markdown) : null
    if (!parsed) continue
    const screenshots = (shots.get(parsed.id) ?? []).map((shot, index) => ({ ...shot, alt: `${parsed.title} screenshot ${index + 1}` }))
    recipes.push({ ...parsed, screenshots })
  }
  return recipes.sort((a, b) => a.title.localeCompare(b.title))
}

export const RECIPES: readonly Recipe[] = loadRecipes()

/** The small, dependency-free first recipe the onboarding dashboard suggests. */
export const RECOMMENDED_RECIPE = 'reminders'

export function matchesRecipe(recipe: Recipe, query: string, titles: ReadonlyMap<string, string>): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = [recipe.id, recipe.title, recipe.summary, ...recipe.highlights, ...recipe.buildsOn.map(id => titles.get(id) ?? id)].join(' ').toLowerCase()
  return terms.every(term => haystack.includes(term))
}

export function recipeBrief(recipe: Recipe, titles: ReadonlyMap<string, string>, adapted = false): string {
  if (adapted) return `Update the ${recipe.title} recipe (\`${recipe.id}\`) in this Box from Silkweave Stack. Read \`recipes/${recipe.id}/\` and the recorded source revision in \`docs/UPSTREAM.md\`, then use \`box stack fetch\` to compare that revision, this Box's \`features/${recipe.id}/\`, and the Stack's current \`features/${recipe.id}/\`. Follow the adapt skill: preserve local customizations and migration history, back up before any migration, run the complete validation chain, and let me review the result before finishing.`
  const deps = recipe.buildsOn.length
    ? ` It builds on ${recipe.buildsOn.map(id => `${titles.get(id) ?? id} (\`${id}\`)`).join(', ')}; adapt any of those that are not already in this Box first.`
    : ''
  return `Adapt the ${recipe.title} recipe (\`${recipe.id}\`) from Silkweave Stack into this Box.${deps} Read \`recipes/${recipe.id}/\` and \`docs/RECIPES.md\` first, then use \`box stack fetch\` to read the implementation from the Stack's \`features/${recipe.id}/\`, ideally at the revision recorded in \`docs/UPSTREAM.md\`. Follow the adapt skill: record the scope and source SHA before editing and back up before any migration. Preserve this Box's local decisions and migration history, update registration and dependencies, run the complete validation chain, and let me review the result before finishing.`
}
