/** The RECIPE.md contract, kept free of Vite APIs so it can be exercised directly. See recipes/README.md. */
export interface RecipeText {
  id: string
  title: string
  summary: string
  highlights: string[]
  buildsOn: string[]
  /** Bullets under `## Mobile`: what the recipe's optional mobile module adds. Empty when it has none. */
  mobile: string[]
}

/** Plain text for display: drops inline code ticks, emphasis markers and link targets. */
const plain = (text: string): string => text
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[`*_]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

export function parseRecipe(id: string, markdown: string): RecipeText | null {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const titleAt = lines.findIndex(line => line.startsWith('# '))
  if (titleAt < 0) return null
  const title = plain(lines[titleAt]!.slice(2))

  const summary: string[] = []
  let at = titleAt + 1
  while (at < lines.length && lines[at]!.trim() === '') at++
  while (at < lines.length && lines[at]!.trim() !== '' && !lines[at]!.startsWith('#')) summary.push(lines[at++]!.trim())

  const section = (heading: string): string[] => {
    const start = lines.findIndex(line => line.trim().toLowerCase() === `## ${heading}`)
    if (start < 0) return []
    const items: string[] = []
    for (let i = start + 1; i < lines.length && !lines[i]!.startsWith('#'); i++) {
      const match = /^\s*[-*]\s+(.*)$/.exec(lines[i]!)
      if (match) items.push(match[1]!)
    }
    return items
  }

  const buildsOn = section('builds on').flatMap(item => {
    const link = /\]\(\.\.\/([^/)]+)\//.exec(item)?.[1]
    return link ? [link] : []
  })
  return { id, title, summary: plain(summary.join(' ')), highlights: section('highlights').map(plain), buildsOn, mobile: section('mobile').map(plain) }
}

/** The Builder brief drafted by "Adapt recipe" / "Update recipe". The owner edits it before sending. */
export function recipeBrief(recipe: RecipeText, titles: ReadonlyMap<string, string>, adapted = false): string {
  if (adapted) return `Update the ${recipe.title} recipe (\`${recipe.id}\`) in this Box from Silkweave Stack. Read \`recipes/${recipe.id}/\` and the recorded source revision in \`docs/UPSTREAM.md\`, then use \`box stack fetch\` to compare that revision, this Box's \`features/${recipe.id}/\`, and the Stack's current \`features/${recipe.id}/\`. Follow the adapt skill: preserve local customizations and migration history, back up before any migration, run the complete validation chain, and let me review the result before finishing.`
  const deps = recipe.buildsOn.length
    ? ` It builds on ${recipe.buildsOn.map(id => `${titles.get(id) ?? id} (\`${id}\`)`).join(', ')}; adapt any of those that are not already in this Box first.`
    : ''
  const mobile = recipe.mobile.length
    ? ` This recipe also has a mobile app module (\`features/${recipe.id}/mobile\`, see \`docs/MOBILE.md\`): ask me whether to include it in the mobile app before you start, and if I say yes, integrate and register it too.`
    : ''
  return `Adapt the ${recipe.title} recipe (\`${recipe.id}\`) from Silkweave Stack into this Box.${deps}${mobile} Read \`recipes/${recipe.id}/\` and \`docs/RECIPES.md\` first, then use \`box stack fetch\` to read the implementation from the Stack's \`features/${recipe.id}/\`, ideally at the revision recorded in \`docs/UPSTREAM.md\`. Follow the adapt skill: record the scope and source SHA before editing and back up before any migration. Preserve this Box's local decisions and migration history, update registration and dependencies, run the complete validation chain, and let me review the result before finishing.`
}
