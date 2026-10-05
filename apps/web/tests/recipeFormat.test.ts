import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePowerup, parseRecipe, powerupBrief, RecipeBook, recipeBrief } from '../src/lib/recipeFormat.ts'

const RECIPES = join(import.meta.dir, '../../../recipes')
const recipe = (id: string) => parseRecipe(id, readFileSync(join(RECIPES, id, 'RECIPE.md'), 'utf8'))!
const powerupIds = (id: string): string[] => {
  const dir = join(RECIPES, id, 'powerups')
  return existsSync(dir) ? readdirSync(dir).filter(name => existsSync(join(dir, name, 'POWERUP.md'))).sort() : []
}
const powerup = (id: string, powerupId: string) => parsePowerup(id, powerupId, readFileSync(join(RECIPES, id, 'powerups', powerupId, 'POWERUP.md'), 'utf8'))!
const recipeIds = readdirSync(RECIPES).filter(name => existsSync(join(RECIPES, name, 'RECIPE.md')))

const INSTALL_SECTIONS = ['Detect', 'Requires', 'Owner decisions', 'Owner-only steps', 'Steps', 'Verify', 'Remove']

describe('recipe catalog format', () => {
  test('recipes parse with highlights and dependencies', () => {
    expect(recipe('chat').highlights.length).toBeGreaterThan(0)
    expect(recipe('chat').buildsOn).toEqual([])
    expect(recipe('notifications').buildsOn).toEqual(['chat', 'alerts'])
  })

  test('RECIPE.md no longer carries a ## Mobile section; the mobile module is a powerup', () => {
    for (const id of recipeIds) expect(readFileSync(join(RECIPES, id, 'RECIPE.md'), 'utf8')).not.toMatch(/^## Mobile$/m)
    for (const id of ['chat', 'planning', 'notifications', 'artifacts']) expect(powerupIds(id)).toContain('mobile')
  })

  test('every powerup has a catalog entry and an INSTALL.md with the sections in order', () => {
    for (const id of recipeIds) {
      for (const powerupId of powerupIds(id)) {
        const entry = powerup(id, powerupId)
        expect(entry.title.length).toBeGreaterThan(0)
        expect(entry.summary.length).toBeGreaterThan(0)
        expect(entry.highlights.length).toBeGreaterThan(0)
        expect(entry.needs.length).toBeGreaterThan(0)
        const install = readFileSync(join(RECIPES, id, 'powerups', powerupId, 'INSTALL.md'), 'utf8')
        const headings = [...install.matchAll(/^## (.+)$/gm)].map(match => match[1]!.trim())
        expect(headings.filter(heading => INSTALL_SECTIONS.includes(heading))).toEqual(INSTALL_SECTIONS)
      }
    }
  })

  test('a recipe with powerups drafts an adapt brief that asks which to add', () => {
    const chat = recipe('chat')
    const brief = recipeBrief(chat, new Map(), false, [powerup('chat', 'mobile')])
    expect(brief).toContain('recipes/chat/powerups/mobile/')
    expect(brief).toContain('ask me whether to add any of them')
  })

  test('a recipe without powerups drafts no powerup question', () => {
    expect(powerupIds('reminders')).toEqual([])
    expect(recipeBrief(recipe('reminders'), new Map())).not.toContain('optional powerups')
  })

  test('the powerup brief points at its folder, the owner decisions and verification', () => {
    const brief = powerupBrief(powerup('artifacts', 'public-sharing'), 'Artifacts')
    expect(brief).toContain('recipes/artifacts/powerups/public-sharing/')
    expect(brief).toContain('already has it')
    expect(brief).toContain('owner-only steps')
    expect(brief).toContain('never print them')
    expect(brief).toContain('Verify')
  })

  test('adapt and powerup briefs record the result in the recipes ledger', () => {
    expect(recipeBrief(recipe('reminders'), new Map())).toContain('`"reminders": { "powerups": [] }`')
    expect(recipeBrief(recipe('chat'), new Map(), true)).toContain('`recipes` ledger')
    expect(powerupBrief(powerup('chat', 'mobile'), 'Chat')).toContain('`recipes.chat.powerups`')
  })

  test('the mobile app is a recipe, and every mobile powerup requires it', () => {
    expect(recipeIds).toContain('mobile')
    expect(recipe('mobile').buildsOn).toEqual([])
    for (const id of ['chat', 'planning', 'notifications', 'artifacts']) expect(powerup(id, 'mobile').requires).toEqual([{ recipe: 'mobile' }])
    expect(powerup('artifacts', 'public-sharing').requires).toEqual([])
  })

  test('## Requires links resolve to recipes and powerups; the own recipe is implied', () => {
    const doc = (links: string) => `# X\n\nSummary.\n\n## Requires\n\n${links}\n`
    const parsed = parsePowerup('chat', 'mobile', doc([
      '- [Mobile app](../../../mobile/RECIPE.md)',
      '- [Chat](../../RECIPE.md)',
      '- [Sharing](../../../artifacts/powerups/public-sharing/POWERUP.md)',
      '- [Sibling](../search/POWERUP.md)',
      '- Plain text without a link',
    ].join('\n')))!
    expect(parsed.requires).toEqual([{ recipe: 'mobile' }, { recipe: 'artifacts', powerup: 'public-sharing' }, { recipe: 'chat', powerup: 'search' }])
  })

  test('the recipe book unlocks powerups from the ledger and registered features', () => {
    const mobile = powerup('chat', 'mobile')
    const chatOnly = new RecipeBook({ chat: { powerups: [] } }, new Set())
    expect(chatOnly.powerup(mobile)).toEqual({ kind: 'locked', needs: [{ recipe: 'mobile' }] })
    expect(new RecipeBook({}, new Set()).powerup(mobile)).toEqual({ kind: 'locked', needs: [{ recipe: 'chat' }, { recipe: 'mobile' }] })
    expect(new RecipeBook({ chat: { powerups: [] }, mobile: { powerups: [] } }, new Set()).powerup(mobile)).toEqual({ kind: 'available' })
    expect(new RecipeBook({ chat: { powerups: ['mobile'] }, mobile: { powerups: [] } }, new Set()).powerup(mobile)).toEqual({ kind: 'added', needs: [] })
    // Recorded, but its requirement was removed since: still added, with the drift named.
    expect(new RecipeBook({ chat: { powerups: ['mobile'] } }, new Set()).powerup(mobile)).toEqual({ kind: 'added', needs: [{ recipe: 'mobile' }] })
    // A registered feature counts as adapted even before it is recorded.
    const legacy = new RecipeBook({ mobile: { powerups: [] } }, new Set(['chat']))
    expect(legacy.powerup(mobile)).toEqual({ kind: 'available' })
    expect(legacy.recipe(recipe('chat'))).toEqual({ adapted: true, recorded: false, missing: [] })
    expect(new RecipeBook({}, new Set(['chat'])).recipe(recipe('notifications'))).toEqual({ adapted: false, recorded: false, missing: ['alerts'] })
  })
})
