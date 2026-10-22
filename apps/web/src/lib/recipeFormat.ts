/**
 * The RECIPE.md and POWERUP.md contracts, kept free of Vite APIs so they can be exercised directly.
 * See recipes/README.md.
 */
export interface RecipeText {
  id: string
  title: string
  summary: string
  highlights: string[]
  buildsOn: string[]
}

/**
 * An optional capability for an adapted recipe, from `recipes/<recipe>/powerups/<id>/POWERUP.md`.
 * A recipe adopts a feature in its base form; powerups extend it later, one at a time.
 */
export interface PowerupText {
  recipe: string
  id: string
  title: string
  summary: string
  highlights: string[]
  /** Bullets under `## Needs`: accounts, tools and decisions the owner must bring. */
  needs: string[]
  /**
   * Links under `## Requires`: other recipes, or powerups of any recipe, that must be in place
   * first. The powerup's own recipe is always required and is not listed.
   */
  requires: Requirement[]
}

/** A recipe (`powerup` absent) or a recipe's powerup that something else needs first. */
export interface Requirement { recipe: string; powerup?: string }

/** The recipes ledger from `box.json`: adapted recipe id to the powerups added to it. */
export type RecipeLedger = Readonly<Record<string, { readonly powerups: readonly string[] }>>

/** Plain text for display: drops inline code ticks, emphasis markers and link targets. */
const plain = (text: string): string => text
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[`*_]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

interface Parsed { title: string; summary: string; section: (heading: string) => string[] }

/** `# Title`, the first paragraph after it, and the bullets of any `## Heading`. */
function parseDocument(markdown: string): Parsed | null {
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
  return { title, summary: plain(summary.join(' ')), section }
}

export function parseRecipe(id: string, markdown: string): RecipeText | null {
  const doc = parseDocument(markdown)
  if (!doc) return null
  const buildsOn = doc.section('builds on').flatMap(item => {
    const link = /\]\(\.\.\/([^/)]+)\//.exec(item)?.[1]
    return link ? [link] : []
  })
  return { id, title: doc.title, summary: doc.summary, highlights: doc.section('highlights').map(plain), buildsOn }
}

/**
 * Resolve a `## Requires` link from `recipes/<recipe>/powerups/<id>/POWERUP.md` to what it names:
 * `../../../mobile/RECIPE.md` is a recipe, `../public-sharing/POWERUP.md` a sibling powerup, and
 * `../../../chat/powerups/mobile/POWERUP.md` another recipe's powerup.
 */
function requirement(recipe: string, id: string, item: string): Requirement | null {
  const target = /\]\(([^)\s]+)\)/.exec(item)?.[1]
  if (!target) return null
  const path = new URL(target, `file:///recipes/${recipe}/powerups/${id}/`).pathname
  const named = /^\/recipes\/([^/]+)\/(?:RECIPE\.md|powerups\/([^/]+)\/POWERUP\.md)$/.exec(path)
  if (!named) return null
  return named[2] ? { recipe: named[1]!, powerup: named[2] } : { recipe: named[1]! }
}

export function parsePowerup(recipe: string, id: string, markdown: string): PowerupText | null {
  const doc = parseDocument(markdown)
  if (!doc) return null
  const requires = doc.section('requires').flatMap(item => {
    const found = requirement(recipe, id, item)
    return found && !(found.recipe === recipe && !found.powerup) ? [found] : []
  })
  return { recipe, id, title: doc.title, summary: doc.summary, highlights: doc.section('highlights').map(plain), needs: doc.section('needs').map(plain), requires }
}

/** What the gallery knows about one recipe in this Box. */
export interface RecipeState {
  /** Recorded in the ledger or registered as a feature. */
  adapted: boolean
  /** In the `recipes` ledger of `box.json`. */
  recorded: boolean
  /** Builds-on recipes that are not adapted yet. */
  missing: string[]
}

export type PowerupState =
  /** Recorded in the ledger; `needs` lists requirements that are no longer in place (drift). */
  | { kind: 'added'; needs: Requirement[] }
  | { kind: 'available' }
  /** Its recipe or a requirement is not in place; `needs` lists what is missing, recipe first. */
  | { kind: 'locked'; needs: Requirement[] }

/**
 * Recipe and powerup state from the ledger plus the registered features. A registered feature counts
 * as adapted even without a ledger entry, so a Box that adapted recipes before the ledger existed
 * still shows them; the gallery marks those as not recorded. Powerups are known only from the ledger.
 */
export class RecipeBook {
  constructor(private readonly ledger: RecipeLedger, private readonly registered: ReadonlySet<string>) {}

  adapted(id: string): boolean { return Object.hasOwn(this.ledger, id) || this.registered.has(id) }

  hasPowerup(recipe: string, powerup: string): boolean { return Object.hasOwn(this.ledger, recipe) && this.ledger[recipe]!.powerups.includes(powerup) }

  recipe(recipe: RecipeText): RecipeState {
    return { adapted: this.adapted(recipe.id), recorded: Object.hasOwn(this.ledger, recipe.id), missing: recipe.buildsOn.filter(id => !this.adapted(id)) }
  }

  powerup(powerup: PowerupText): PowerupState {
    const needs: Requirement[] = [
      ...(this.adapted(powerup.recipe) ? [] : [{ recipe: powerup.recipe }]),
      ...powerup.requires.filter(req => req.powerup ? !this.hasPowerup(req.recipe, req.powerup) : !this.adapted(req.recipe)),
    ]
    if (this.hasPowerup(powerup.recipe, powerup.id)) return { kind: 'added', needs }
    return needs.length ? { kind: 'locked', needs } : { kind: 'available' }
  }
}

const powerupPath = (powerup: PowerupText): string => `recipes/${powerup.recipe}/powerups/${powerup.id}/`

/** The Builder brief drafted by "Adapt recipe" / "Update recipe". The owner edits it before sending. */
export function recipeBrief(recipe: RecipeText, titles: ReadonlyMap<string, string>, adapted = false, powerups: readonly PowerupText[] = []): string {
  if (adapted) return `Update the ${recipe.title} recipe (\`${recipe.id}\`) in this Box. Run \`box recipe fetch ${recipe.id}\` for the latest registry version, and \`box recipe fetch ${recipe.id} --version <sha>\` for the version recorded in the \`recipes\` ledger of \`box.json\` (or in \`docs/UPSTREAM.md\`), then compare the recorded version, this Box's \`features/${recipe.id}/\` and the latest. Update the powerups recorded for it in the ledger too, and only those. Follow the adapt skill: preserve local customizations and migration history, back up before any migration, run the complete validation chain, record the new version and sha256 in the ledger, and let me review the result before finishing.`
  const deps = recipe.buildsOn.length
    ? ` It builds on ${recipe.buildsOn.map(id => `${titles.get(id) ?? id} (\`${id}\`)`).join(', ')}; adapt any of those that are not already in this Box first.`
    : ''
  const optional = powerups.length
    ? ` Adapt the recipe in its base form. It also offers optional powerups: ${powerups.map(p => `${p.title} (\`${powerupPath(p)}\`)`).join(', ')}. Before you start, ask me whether to add any of them now; each can also be added later. For each one I want, follow its INSTALL.md after the base recipe validates.`
    : ''
  return `Adapt the ${recipe.title} recipe (\`${recipe.id}\`) from Silkweave Stack into this Box.${deps}${optional} Run \`box recipe fetch ${recipe.id}\` first: it downloads the recipe's docs (\`recipes/${recipe.id}/\`) and implementation (\`features/${recipe.id}/\`) from the recipe registry and prints where. Read those docs and \`docs/RECIPES.md\` before changing anything. Follow the adapt skill: record the scope and the fetched version before editing and back up before any migration. Preserve this Box's local decisions and migration history, update registration and dependencies, and run the complete validation chain. Once it passes, record the recipe in the \`recipes\` ledger of \`box.json\` (\`"${recipe.id}": { "powerups": [], "version": "<fetched version>", "sha256": "<fetched sha256>" }\`, plus the ids of any powerups added and verified), then let me review the result before finishing.`
}

/** The Builder brief drafted by "Add powerup". The owner edits it before sending. */
export function powerupBrief(powerup: PowerupText, recipeTitle: string): string {
  return `Add the ${powerup.title} powerup to the ${recipeTitle} recipe (\`${powerup.recipe}\`) in this Box. Read \`${powerupPath(powerup)}\` (POWERUP.md and INSTALL.md) and the Powerups section of \`docs/RECIPES.md\` first, and check whether this Box already has it before changing anything. Ask me the owner decisions INSTALL.md lists, then tell me exactly which owner-only steps I have to do myself and wait for me. Fetch any source it needs with \`box recipe fetch ${powerup.recipe} --version <sha>\` at the version recorded in the \`recipes\` ledger of \`box.json\`. Keep secrets in \`box.local.json\` and never print them. Record the scope in \`_docs/INTEGRATION.md\`, run INSTALL.md's Verify steps and the complete validation chain, then add \`${powerup.id}\` to \`recipes.${powerup.recipe}.powerups\` in \`box.json\` and let me review the result before finishing.`
}
