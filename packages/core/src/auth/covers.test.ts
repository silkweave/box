// Coverage (PERMISSIONS 5.4): areas, admin authority and the audiences of the connections an agent
// can use where its output lands. Pure: no database (knownAreas comes from the feature list).

import { afterEach, describe, expect, it } from 'vitest'
import type { Access } from './access.js'
import { coverageGaps, covers, coversAccess, describeGap } from './covers.js'
import { registerMcpConnections } from '../mcp-connections.js'

const access = (areas: Record<string, 'none' | 'read' | 'write'>, fallback: 'none' | 'read' | 'write' = 'none', admin = false): Access =>
  ({ role: 'x', areas: new Map(Object.entries(areas)), fallback, admin, revision: 1 })

let off: (() => void) | null = null
afterEach(() => {
  off?.()
  off = null
})

describe('coverage', () => {
  it('needs every area at the agent level and admin authority for an admin agent', () => {
    const agent = access({ crm: 'write', sink: 'read' })
    const dita = { id: 'dita', kind: 'human', access: access({ crm: 'read', sink: 'write' }) }
    expect(coverageGaps(dita, agent).map(describeGap)).toEqual(['crm write'])
    expect(covers({ ...dita, access: access({ crm: 'write', sink: 'read' }) }, agent)).toBe(true)
    const admin = access({}, 'write', true)
    expect(coverageGaps({ id: 'm', kind: 'human', access: access({}, 'write') }, admin).map(describeGap)).toEqual(['admin authority'])
    expect(coversAccess(access({}, 'write', true), admin)).toBe(true)
  })

  it("compares the destination's own area at read and every other area exactly", () => {
    const upkeep = access({ sink: 'write', crm: 'read' })
    const reader = { id: 'wren', kind: 'human', access: access({ sink: 'read', crm: 'read' }) }
    expect(coverageGaps(reader, upkeep).map(describeGap)).toEqual(['sink write'])
    expect(covers(reader, upkeep, [], { destinationArea: 'sink' })).toBe(true)
    expect(coverageGaps({ ...reader, access: access({ sink: 'read' }) }, upkeep, [], { destinationArea: 'sink' }).map(describeGap)).toEqual(['crm read'])
    expect(coverageGaps({ ...reader, access: access({ sink: 'read' }) }, access({ sink: 'write', crm: 'write' }), [], { destinationArea: 'crm' }).map(describeGap).sort())
      .toEqual(['crm read', 'sink write'])
  })

  it('needs the audience of every connection the agent can use there, and fails closed without the recipe', () => {
    const agent = access({ crm: 'read' })
    const ana = { id: 'ana', kind: 'human', access: access({ crm: 'write' }) }
    expect(coverageGaps(ana, agent, ['stripe']).map(describeGap)).toEqual(['the stripe connection'])
    off = registerMcpConnections('test', {
      list: () => [{ id: 'stripe', label: 'Stripe' }],
      sessionProblem: async () => null,
      personal: async () => [],
      inAudience: (id, viewer) => id === 'stripe' && (viewer.admin || viewer.id === 'ana'),
      serve: async () => {},
    })
    expect(covers(ana, agent, ['stripe'])).toBe(true)
    expect(coverageGaps({ id: 'ben', kind: 'human', access: access({ crm: 'write' }) }, agent, ['stripe', 'linear']).map(describeGap))
      .toEqual(['the stripe connection', 'the linear connection'])
    expect(covers({ id: 'boss', kind: 'human', access: access({}, 'write', true) }, agent, ['stripe'])).toBe(true)
  })
})
