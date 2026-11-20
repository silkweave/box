// Pinned filters persist on a self-kept list view (Goals, `DataGrid` with its own `storageKey`):
// unpinning Status survives a reload, pinning it again and setting a value survives a reload with the
// chip and its value in place. Goals offers one filter field (Status, pinned by default), so the spec
// unpins before it pins. The goals view's local keys are put back at the end.

import { check, eventually, none, one, type FlowContext, type FlowSpec } from './harness.ts'

const chip = (ctx: FlowContext) => ctx.page.getByRole('button', { name: /^Status: / })
const fieldsPanel = (ctx: FlowContext) => ctx.page.getByRole('group', { name: 'Filter fields', exact: true })

async function togglePin(ctx: FlowContext, action: 'Pin' | 'Unpin'): Promise<void> {
  await (await one(ctx.page.getByRole('button', { name: /^Filters( \(\d+ active\))?$/ }), 'Filters')).click()
  const name = action === 'Pin' ? 'Pin Status to the bar' : 'Unpin Status from the bar'
  await (await one(fieldsPanel(ctx).getByRole('button', { name, exact: true }), name)).click()
  await ctx.page.keyboard.press('Escape')
  await none(fieldsPanel(ctx), 'the filter panel after Escape')
}

export const specs: FlowSpec[] = [
  {
    name: 'pinned filters: Goals keeps an unpinned field, then a pinned field and its value, across reloads',
    run: async (ctx) => {
      const { page } = ctx
      await ctx.open('/goals')
      await one(chip(ctx), 'the Status chip (pinned by default)', 20000)
      const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ui.goals')))
      const saved = await page.evaluate((ks) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])), keys)
      ctx.cleanup(() =>
        page.evaluate((s) => {
          for (const k of Object.keys(localStorage).filter((k) => k.startsWith('ui.goals'))) if (!(k in s)) localStorage.removeItem(k)
          for (const [k, v] of Object.entries(s)) if (v !== null) localStorage.setItem(k, v)
        }, saved),
      )

      await togglePin(ctx, 'Unpin')
      await none(chip(ctx), 'the Status chip after unpinning')
      await page.reload()
      await one(page.getByRole('button', { name: /^Filters/ }), 'Filters after reload', 20000)
      await page.waitForTimeout(500)
      check((await chip(ctx).count()) === 0, 'the Status chip came back after a reload')

      await togglePin(ctx, 'Pin')
      const c = await one(chip(ctx), 'the Status chip after pinning')
      check((await c.innerText()).replace(/\s+/g, ' ').includes('Any'), `a freshly pinned chip reads "${await c.innerText()}"`)
      await c.click()
      await (await one(page.getByRole('dialog').getByRole('button', { name: 'Active', exact: true }), 'the Active option')).click()
      await page.keyboard.press('Escape')
      await eventually(async () => (await chip(ctx).innerText()).replace(/\s+/g, ' '), (t) => t.includes('Active'), 'the chip after picking Active')

      await page.reload()
      const after = await one(chip(ctx), 'the Status chip after reload', 20000)
      await eventually(async () => (await after.innerText()).replace(/\s+/g, ' '), (t) => t.includes('Active'), 'the chip value after reload')
      await one(page.getByRole('button', { name: 'Clear Status', exact: true }), 'Clear Status beside the active chip')
      await one(page.getByText(/^\d+ of \d+ goals?$/), 'the narrowed goals count after reload')
    },
  },
]
