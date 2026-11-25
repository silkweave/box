import { describe, expect, test } from 'bun:test'
import { validBrief } from '../src/lib/builderBrief.ts'
import { parseSessionReport } from '../src/lib/builderStore.ts'
import { formatMinutes, remainingMinutes } from '../src/components/builder/BuilderTasks.tsx'
import { recipeBuilderBrief } from '../src/lib/recipeFormat.ts'

describe('Builder brief', () => {
  test('accepts a plain prompt or a brief with a card, and drops a malformed card', () => {
    expect(validBrief('Do it')).toEqual({ text: 'Do it' })
    expect(validBrief({ text: 'Do it', card: { title: 'Adapt', steps: ['One', 2, ''], groups: [{ label: 'Powerups', items: [] }] } }))
      .toEqual({ text: 'Do it', card: { title: 'Adapt', steps: ['One'] } })
    expect(validBrief({ text: 'Do it', card: { summary: 'no title' } })).toEqual({ text: 'Do it' })
    expect(validBrief({ text: '  ' })).toBeNull()
    expect(validBrief('x'.repeat(20_001))).toBeNull()
  })

  test('an adapt brief names the powerups to choose and asks about them first', () => {
    const brief = recipeBuilderBrief({ id: 'wiki', title: 'Wiki', summary: 'Team wiki', highlights: [], buildsOn: [] }, new Map(), false,
      [{ recipe: 'wiki', id: 'ask', title: 'Ask', summary: '', highlights: [], needs: [], requires: [] }])
    expect(brief.card.title).toBe('Adapt Wiki')
    expect(brief.card.groups[0]?.items).toEqual(['Ask'])
    expect(brief.card.steps).toContain('Ask you which powerups to add now')
    expect(brief.text).toContain('box recipe fetch wiki')
  })
})

describe('Builder session report', () => {
  test('keeps only well-formed parts', () => {
    expect(parseSessionReport(null)).toBeNull()
    expect(parseSessionReport({ plan: { tasks: [{ title: 'A', status: 'odd' }], startedAt: 'x', updatedAt: 'x' } })).toBeNull()
    expect(parseSessionReport({ ready: { at: 't', commitMessage: '' } })).toBeNull()
    expect(parseSessionReport({ ready: { at: 't', commitMessage: 'feat: x', summary: 'old' } }))
      .toEqual({ ready: { commitMessage: 'feat: x', at: 't' } })
  })

  test('time left counts open estimates less what the running task used', () => {
    const now = Date.parse('2026-11-25T10:10:00Z')
    const tasks = [
      { title: 'A', status: 'done' as const, estimateMinutes: 5 },
      { title: 'B', status: 'running' as const, estimateMinutes: 15, startedAt: '2026-11-25T10:00:00Z' },
      { title: 'C', status: 'pending' as const, estimateMinutes: 8 },
    ]
    expect(remainingMinutes(tasks, now)).toBe(13)
    expect(remainingMinutes([{ ...tasks[1]!, estimateMinutes: 5 }], now)).toBe(1)
    expect(remainingMinutes([{ title: 'D', status: 'pending' }], now)).toBeNull()
    expect(formatMinutes(0.2)).toBe('1 min')
    expect(formatMinutes(80)).toBe('1 h 20 min')
  })
})
