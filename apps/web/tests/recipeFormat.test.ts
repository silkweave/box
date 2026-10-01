import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRecipe, recipeBrief } from '../src/lib/recipeFormat.ts'

const recipe = (id: string) => parseRecipe(id, readFileSync(join(import.meta.dir, '../../../recipes', id, 'RECIPE.md'), 'utf8'))!

describe('recipe catalog format', () => {
  test('a ## Mobile section lists the mobile module and the brief asks about it', () => {
    const chat = recipe('chat')
    expect(chat.mobile.length).toBeGreaterThan(0)
    const brief = recipeBrief(chat, new Map())
    expect(brief).toContain('features/chat/mobile')
    expect(brief).toContain('ask me whether to include it')
  })

  test('a recipe without a mobile module drafts no mobile question', () => {
    const reminders = recipe('reminders')
    expect(reminders.mobile).toEqual([])
    expect(recipeBrief(reminders, new Map())).not.toContain('mobile')
  })

  test('the mobile bullets do not leak into the highlights', () => {
    const chat = recipe('chat')
    for (const item of chat.mobile) expect(chat.highlights).not.toContain(item)
    expect(chat.buildsOn).toEqual([])
    expect(recipe('notifications').buildsOn).toEqual(['chat', 'alerts'])
  })
})
