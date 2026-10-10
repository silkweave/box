import { describe, expect, it } from 'vitest'
import { cardSize, layoutLayers, LEAD_H, LEAD_W, NODE_W } from './board-layout.js'


describe('layoutLayers', () => {
  // The q4-goals shape: two goals, their signals, drivers, and a ratio signal (churn-rate) driven by
  // mrr, which would otherwise push its goal a row above the other.
  const nodes = [
    { key: 'goal:mrr-15k', layer: 3, lead: true, label: 'MRR', size: cardSize('lead', 5) },
    { key: 'goal:churn', layer: 3, lead: true, label: 'Churn', size: cardSize('lead') },
    { key: 'signal:mrr', layer: 2, label: 'mrr' },
    { key: 'signal:churn-rate', layer: 2, label: 'churn-rate' },
    { key: 'signal:new-mrr', layer: 2, label: 'new-mrr' },
    { key: 'signal:churned-mrr', layer: 2, label: 'churned-mrr' },
  ]
  const edges = [
    { source: 'signal:mrr', target: 'goal:mrr-15k' },
    { source: 'signal:churn-rate', target: 'goal:churn' },
    { source: 'signal:new-mrr', target: 'signal:mrr' },
    { source: 'signal:churned-mrr', target: 'signal:mrr' },
    { source: 'signal:churned-mrr', target: 'signal:churn-rate' },
    { source: 'signal:mrr', target: 'signal:churn-rate' },
  ]
  const laid = layoutLayers(nodes, edges)
  const pos = (k: string) => laid.get(k)!

  it('puts every lead node on one top row, above everything else', () => {
    expect(pos('goal:mrr-15k').y).toBe(pos('goal:churn').y)
    for (const n of nodes.filter((x) => !x.lead)) expect(pos(n.key).y).toBeGreaterThan(pos('goal:churn').y)
  })

  it('keeps every edge pointing upward and snaps to the grid', () => {
    for (const e of edges) expect(pos(e.source).y).toBeGreaterThan(pos(e.target).y)
    for (const p of laid.values()) expect([Math.abs(p.x % 16), Math.abs(p.y % 16)]).toEqual([0, 0])
  })

  it('never overlaps two cards in a row', () => {
    const w = (k: string) => (k.startsWith('goal:') ? LEAD_W : NODE_W)
    const keys = [...laid.keys()]
    for (const a of keys)
      for (const b of keys) {
        if (a === b || pos(a).y !== pos(b).y) continue
        const [l, r] = pos(a).x < pos(b).x ? [a, b] : [b, a]
        expect(pos(l).x + w(l)).toBeLessThanOrEqual(pos(r).x)
      }
  })

  it('sizes a lead card by the attachments it draws, collapsing past three', () => {
    expect(cardSize('metric', 9)).toEqual({ w: NODE_W, h: 112 })
    expect(cardSize('lead', 0)).toEqual({ w: LEAD_W, h: LEAD_H })
    expect(cardSize('lead', 4).h).toBeGreaterThan(cardSize('lead', 3).h)
    expect(cardSize('lead', 9)).toEqual(cardSize('lead', 4))
  })
})
