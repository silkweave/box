// A failed read shows its error with Retry in every layout of an app list: a successful retry clears
// the error and draws the records again in the layout the person had chosen, a failed retry keeps the
// error and Retry visible. CRM Deals carries list and its own board layout; Sprints and Goals carry
// cards (no app list has all three). Reads are failed by interception only.

import { check, eventually, interceptTrpc, none, one, type FlowContext, type FlowSpec } from './harness.ts'

interface Target { path: string; read: string; layout: string; /** Text a drawn record shows. */ drawn: RegExp }
const TARGETS: Target[] = [
  { path: '/crm/deals', read: 'crmAccounts', layout: 'List', drawn: /\$\d/ },
  { path: '/crm/deals', read: 'crmAccounts', layout: 'Board', drawn: /\$\d/ },
  { path: '/sprints', read: 'planningSprints', layout: 'Cards', drawn: /Sprint \d+/ },
  { path: '/goals', read: 'goalsList', layout: 'Cards', drawn: /On track|At risk|Off track/ },
]

const layoutRadio = (ctx: FlowContext, t: Target) =>
  one(ctx.page.getByRole('radiogroup', { name: 'Layout', exact: true }).getByRole('radio', { name: t.layout, exact: true }), `${t.path}: the ${t.layout} layout control`, 20000)

/** Opens `t` in its layout, then reloads with every read of `t.read` failing until `heal()`. */
async function openFailing(ctx: FlowContext, t: Target) {
  await ctx.open(t.path)
  const radio = await layoutRadio(ctx, t)
  if ((await radio.getAttribute('aria-checked')) !== 'true') await radio.click()
  await eventually(() => radio.getAttribute('aria-checked'), (v) => v === 'true', `${t.path}: switching to ${t.layout}`)
  let failing = true
  const net = await interceptTrpc(ctx.page, (call) => (call.name === t.read && failing ? { fail: true, message: 'Gate C forced read failure' } : undefined))
  await ctx.page.reload()
  await one(ctx.page.getByText('This could not load.', { exact: true }), `${t.path} ${t.layout}: the failed-read notice`, 20000)
  await one(ctx.page.getByText(/Gate C forced read failure/), `${t.path} ${t.layout}: the failure's message`)
  const retry = await one(ctx.page.getByRole('button', { name: 'Retry', exact: true }), `${t.path} ${t.layout}: Retry`)
  return { net, retry, heal: () => { failing = false } }
}

export const specs: FlowSpec[] = TARGETS.flatMap((t): FlowSpec[] => [
  {
    name: `failed read (${t.path} ${t.layout}): Retry that succeeds clears the error`,
    run: async (ctx) => {
      const { net, retry, heal } = await openFailing(ctx, t)
      await ctx.page.waitForTimeout(300)
      heal()
      const before = net.count(t.read)
      await retry.click()
      await none(ctx.page.getByText('This could not load.', { exact: true }), `${t.layout}: the notice after a successful Retry`)
      await none(ctx.page.getByRole('button', { name: 'Retry', exact: true }), `${t.layout}: Retry after a successful Retry`)
      check(net.count(t.read) === before + 1, `${t.layout}: Retry sent ${net.count(t.read) - before} reads, expected 1`)
      const radio = await layoutRadio(ctx, t)
      check((await radio.getAttribute('aria-checked')) === 'true', `${t.path}: after Retry the list left its ${t.layout} layout`)
      await eventually(async () => t.drawn.test(await ctx.page.locator('main').innerText()), Boolean, `${t.path} ${t.layout}: records after Retry`)
    },
  },
  {
    name: `failed read (${t.path} ${t.layout}): Retry that fails again keeps the error and Retry`,
    run: async (ctx) => {
      const { net, retry } = await openFailing(ctx, t)
      await ctx.page.waitForTimeout(300)
      const before = net.count(t.read)
      await retry.click()
      await eventually(() => Promise.resolve(net.count(t.read)), (n) => n === before + 1, `${t.layout}: the retried read`)
      await ctx.page.waitForTimeout(500)
      await one(ctx.page.getByText('This could not load.', { exact: true }), `${t.layout}: the notice after a failed Retry`)
      const again = await one(ctx.page.getByRole('button', { name: 'Retry', exact: true }), `${t.layout}: Retry after a failed Retry`)
      check(await again.isEnabled(), `${t.layout}: Retry is disabled after a failed Retry`)
    },
  },
])
