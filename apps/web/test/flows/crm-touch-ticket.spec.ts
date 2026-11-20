// CRM account, Log support ticket from a touch: `#new-ticket-<activity id>` is owned by the account
// action (always on the page), so a direct link or a reload opens New ticket prefilled from that touch
// even when the Conversation section is folded; switching the hash from touch A to touch B shows B's
// values (the form is keyed by the touch, not reused with A's state).
//
// The two touches are fixtures injected into the account's `crmActivities` read: nothing is written.

import { check, dialog, eventually, hashOf, interceptTrpc, one, trpcCall, type FlowContext, type FlowSpec } from './harness.ts'

const COLLAPSED = 'ui.crm.collapsedCards'
const A = { id: 'gate-c-touch-a', subject: 'Gate C touch A subject', body: 'Gate C touch A body' }
const B = { id: 'gate-c-touch-b', subject: 'Gate C touch B subject', body: 'Gate C touch B body' }

async function setup(ctx: FlowContext): Promise<string> {
  await ctx.open('/crm')
  const accounts = await trpcCall<{ accounts: { id: string }[] }>(ctx.page, 'query', 'crmAccounts', {})
  const account = accounts.accounts[0]?.id
  check(account, 'the dev Box has no CRM account to open')
  const touch = (t: typeof A) => ({
    id: t.id, account_id: account, contact_id: null, channel: 'email', direction: 'inbound', occurred_at: '2026-11-19T10:00:00Z',
    body: t.body, subject: t.subject, author_name: 'Gate C', campaign_name: '', thread_id: null, thread_index: null,
    message_type: null, interaction_type: null, campaign_id: null, data_source_id: null, external_id: null,
  })
  await interceptTrpc(ctx.page, (call) =>
    call.name === 'crmActivities' ? { rewrite: (d) => ({ ...(d as object), activities: [touch(A), touch(B)] }) } : undefined,
  )
  return account
}

async function expectPrefill(ctx: FlowContext, t: typeof A, when: string): Promise<void> {
  const d = await one(dialog(ctx.page, 'New ticket'), `New ticket dialog ${when}`, 20000)
  const subject = await one(d.getByLabel('Subject', { exact: true }), `Subject field ${when}`)
  const summary = await one(d.getByLabel('Summary', { exact: true }), `Summary field ${when}`)
  await eventually(() => subject.inputValue(), (v) => v === t.subject, `Subject ${when}`)
  const s = await summary.evaluate((el) => (el as HTMLTextAreaElement).value ?? el.textContent ?? '')
  check(s.includes(t.body), `Summary ${when} is "${s}", expected "${t.body}"`)
}

export const specs: FlowSpec[] = [
  {
    name: 'crm touch ticket: folded Conversation, direct link and reload open it prefilled',
    run: async (ctx) => {
      const account = await setup(ctx)
      await ctx.page.evaluate((k) => localStorage.setItem(k, JSON.stringify(['conversation'])), COLLAPSED)
      await ctx.open(`/crm/${account}#new-ticket-${A.id}`)
      await expectPrefill(ctx, A, 'on a direct link with Conversation folded')
      await ctx.page.reload()
      await expectPrefill(ctx, A, 'after reload with Conversation folded')
      check(hashOf(ctx.page) === `new-ticket-${A.id}`, `the hash became #${hashOf(ctx.page)}`)
    },
  },
  {
    name: 'crm touch ticket: switching the hash from touch A to B shows B',
    run: async (ctx) => {
      const account = await setup(ctx)
      await ctx.page.evaluate((k) => localStorage.setItem(k, JSON.stringify([])), COLLAPSED)
      await ctx.open(`/crm/${account}#new-ticket-${A.id}`)
      await expectPrefill(ctx, A, 'for touch A')
      await ctx.page.evaluate((h) => { location.hash = h }, `new-ticket-${B.id}`)
      // An untouched prefilled form is not a draft: switching must not ask to discard it.
      await ctx.page.waitForTimeout(300)
      check((await dialog(ctx.page, 'Discard changes?').count()) === 0, 'switching touches asked to discard an untouched prefilled form')
      await expectPrefill(ctx, B, 'after switching to touch B')
      check(hashOf(ctx.page) === `new-ticket-${B.id}`, `the hash is #${hashOf(ctx.page)}, expected touch B`)
    },
  },
]
