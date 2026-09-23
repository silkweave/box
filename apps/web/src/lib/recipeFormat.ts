/** The RECIPE.md contract, kept free of Vite APIs so it can be exercised directly. See recipes/README.md. */
export interface RecipeText {
  id: string
  title: string
  summary: string
  highlights: string[]
  buildsOn: string[]
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
  return { id, title, summary: plain(summary.join(' ')), highlights: section('highlights').map(plain), buildsOn }
}
