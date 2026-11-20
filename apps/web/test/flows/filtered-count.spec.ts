// A narrowed list counts "x of N" against the list's own unfiltered N, not against what is left:
// CRM Deals (the page narrows the rows itself and passes the total) and All tasks.

import { check, eventually, one, trpcCall, type FlowContext, type FlowSpec } from './harness.ts'

const countText = (ctx: FlowContext, noun: string) => ctx.page.getByText(new RegExp(`^\\d+( of \\d+)? ${noun}s?$`))
const readCount = async (ctx: FlowContext, noun: string): Promise<{ shown: number; total: number }> => {
  const t = await (await one(countText(ctx, noun), `the ${noun} count`, 20000)).innerText()
  const [, a, , b] = /^(\d+)( of (\d+))?/.exec(t) ?? []
  return { shown: Number(a), total: Number(b ?? a) }
}

export const specs: FlowSpec[] = [
  {
    name: 'filtered count: CRM Deals searched shows "x of N deals" with every deal as N',
    run: async (ctx) => {
      await ctx.open('/crm/deals')
      const list = await one(ctx.page.getByRole('radio', { name: 'List', exact: true }), 'List layout control', 20000)
      await list.click()
      const data = await trpcCall<{ accounts: { name: string; deals?: { name: string }[] }[] }>(ctx.page, 'query', 'crmAccounts', {})
      const all = data.accounts.reduce((n, a) => n + (a.deals?.length ?? 0), 0)
      const before = await readCount(ctx, 'deal')
      // An account whose deal the current view shows, so the search narrows to something.
      const text = await ctx.page.locator('main').innerText()
      const term = data.accounts.find((a) => (a.deals?.length ?? 0) > 0 && text.includes(a.name))?.name
      check(term && all > 1, 'the dev Box shows no deal to search for')
      check(before.total === all, `unsearched, the count says ${before.shown} of ${before.total}; the Box has ${all} deals`)
      await (await one(ctx.page.getByPlaceholder('Search deal, company, contact, notes…', { exact: true }), 'deals search')).fill(term)
      const after = await eventually(() => readCount(ctx, 'deal'), (c) => c.shown < before.shown || c.shown < all, `the count after searching "${term}"`)
      check(after.total === all, `searched, the denominator is ${after.total}, expected all ${all} deals`)
      check(after.shown >= 1, `searching an account's own name "${term}" found no deal`)
    },
  },
  {
    name: 'filtered count: All tasks searched keeps the unsearched N as denominator',
    run: async (ctx) => {
      await ctx.open('/tasks')
      const before = await readCount(ctx, 'task')
      check(before.total > 1, `the task count is ${before.total}`)
      const search = await one(ctx.page.getByPlaceholder('Search task, id, initiative…', { exact: true }), 'tasks search')
      await search.fill('zzz-gate-c-no-such-task')
      const none = await eventually(() => readCount(ctx, 'task'), (c) => c.shown === 0, 'the count for a search that matches nothing')
      check(none.total === before.total, `searched, the denominator is ${none.total}, expected ${before.total}`)
      await search.fill('')
      const back = await eventually(() => readCount(ctx, 'task'), (c) => c.shown === before.shown, 'the count after clearing the search')
      check(back.total === before.total, `cleared, the count says ${back.shown} of ${back.total}`)
    },
  },
]
