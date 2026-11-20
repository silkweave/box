// Preset initialisation on CRM Deals (`createViewStore`): a custom view whose base is null survives a
// reload untouched; a browser that never used the list gets the initial preset ("Pipeline") once the
// list is authoritative, even when the first presets read is empty and the seed brings them later;
// and a choice the person made while the presets were still loading is never overwritten by it.
//
// The empty-first read and the seed are intercepted: the seed never reaches the server.

import { check, eventually, interceptTrpc, one, type FlowContext, type FlowSpec } from './harness.ts'

const MODULE = 'crm-deals'
const VIEW = 'ui.crm.deals.view'
const BASED = 'ui.crm.deals.basedOn'
const INITIAL = 'Pipeline'

const stored = (ctx: FlowContext) => ctx.page.evaluate(([v, b]) => ({ view: localStorage.getItem(v), basedOn: localStorage.getItem(b) }), [VIEW, BASED])
const search = (ctx: FlowContext) => one(ctx.page.getByPlaceholder('Search deal, company, contact, notes…', { exact: true }), 'deals search box', 20000)
const trigger = (ctx: FlowContext) => one(ctx.page.getByRole('combobox', { name: 'Preset', exact: true }), 'Preset picker', 20000)

/** First presets read: this module not seeded and empty. The seed answers without writing; later reads are real. */
async function emptyThenSeeded(ctx: FlowContext, populatedDelay = 0) {
  let seeded = false
  return interceptTrpc(ctx.page, (call) => {
    if (call.name === 'presetsSeed') {
      seeded = true
      return { respond: null }
    }
    if (call.name !== 'presetsList') return undefined
    if (!seeded) {
      return {
        rewrite: (d) => {
          const p = d as { seeded: string[]; modules: Record<string, unknown[]> }
          return { ...p, seeded: p.seeded.filter((m) => m !== MODULE), modules: { ...p.modules, [MODULE]: [] } }
        },
      }
    }
    return populatedDelay ? { delay: populatedDelay } : undefined
  })
}

export const specs: FlowSpec[] = [
  {
    name: 'presets: a custom view with a null base survives reload',
    run: async (ctx) => {
      await ctx.open('/crm/deals')
      await search(ctx)
      const view = JSON.parse((await stored(ctx)).view ?? 'null') as Record<string, unknown> | null
      check(view, 'the deals list wrote no live view to start from')
      await ctx.page.evaluate(([v, b, value]) => { localStorage.setItem(v, value); localStorage.setItem(b, 'null') }, [VIEW, BASED, JSON.stringify({ ...view, search: 'gate-c-keep-me' })])
      for (const when of ['on load', 'after reload']) {
        if (when === 'on load') await ctx.open('/crm/deals')
        else await ctx.page.reload()
        const box = await search(ctx)
        await eventually(() => box.inputValue(), (v) => v === 'gate-c-keep-me', `search ${when}`)
        await eventually(async () => (await trigger(ctx)).innerText(), (t) => t.includes('Custom view'), `Preset picker ${when}`)
        const s = await stored(ctx)
        check(s.basedOn === 'null', `basedOn ${when} is ${s.basedOn}, expected null`)
        check((JSON.parse(s.view ?? '{}') as { search?: string }).search === 'gate-c-keep-me', `the stored view lost its search ${when}`)
      }
    },
  },
  {
    name: 'presets: empty first read, populated after the seed: the initial preset applies once',
    run: async (ctx) => {
      await ctx.open('/')
      await ctx.page.evaluate(([v, b]) => { localStorage.removeItem(v); localStorage.removeItem(b) }, [VIEW, BASED])
      const net = await emptyThenSeeded(ctx)
      await ctx.open('/crm/deals')
      await eventually(async () => (await trigger(ctx)).innerText(), (t) => t.includes(INITIAL), 'Preset picker after the seed')
      check(net.count('presetsSeed') === 1, `the seed ran ${net.count('presetsSeed')} times, expected once`)
      check((await stored(ctx)).basedOn === JSON.stringify(INITIAL), `basedOn is ${(await stored(ctx)).basedOn}, expected "${INITIAL}"`)
    },
  },
  {
    name: 'presets: a search typed while presets load is not overwritten by the initial preset',
    run: async (ctx) => {
      await ctx.open('/')
      await ctx.page.evaluate(([v, b]) => { localStorage.removeItem(v); localStorage.removeItem(b) }, [VIEW, BASED])
      const net = await emptyThenSeeded(ctx, 2500)
      await ctx.open('/crm/deals')
      const box = await search(ctx)
      await box.fill('gate-c-mine')
      await eventually(() => Promise.resolve(net.count('presetsList')), (n) => n >= 2, 'the populated presets read')
      await ctx.page.waitForTimeout(3000)
      check((await box.inputValue()) === 'gate-c-mine', `the initial preset replaced the typed search: it is "${await box.inputValue()}"`)
      const t = await (await trigger(ctx)).innerText()
      check(!t.includes(INITIAL), `the picker switched to "${INITIAL}" over the person's own view`)
    },
  },
]
