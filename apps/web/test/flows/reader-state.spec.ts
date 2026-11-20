// Reader state on a genuinely read-only surface. `ds-member` holds write on every feature area
// (`bun run cli access-explain --id ds-member`: every area "write"), so no feature list is read-only
// for it; what a member truly cannot change is other people, in Settings > Users (admin only). There
// the writes are absent (New user, New agent, row actions; another person's page reads only) while
// search, filter and open still work. The admin run of the same page proves the locators find the
// controls when they exist.

import { check, dialog, eventually, none, one, type FlowContext, type FlowSpec } from './harness.ts'

const settings = (ctx: FlowContext) => one(dialog(ctx.page, 'Settings'), 'Settings dialog', 20000)
const rowsShown = async (ctx: FlowContext): Promise<string> =>
  (await (await one(ctx.page.getByText(/^\d+( of \d+)? users?$/), 'the users count')).innerText())

export const specs: FlowSpec[] = [
  {
    name: 'reader state: admin sees the user writes (locator control)',
    run: async (ctx) => {
      await ctx.open('/#settings/users')
      const s = await settings(ctx)
      await one(s.getByRole('button', { name: 'New user', exact: true }), 'New user (admin)')
      await one(s.getByRole('button', { name: 'New agent', exact: true }), 'New agent (admin)')
      check((await s.getByRole('button', { name: /^Actions for / }).count()) > 0, 'admin: no row action menus')
    },
  },
  {
    name: 'reader state: a member cannot change other people but can search, filter and open them',
    as: 'member',
    run: async (ctx) => {
      await ctx.open('/#settings/users')
      const s = await settings(ctx)
      const search = await one(s.getByPlaceholder('Search users', { exact: true }), 'users search', 20000)
      await eventually(() => rowsShown(ctx), (t) => /^\d+ users$/.test(t), 'the unfiltered users count')
      check((await s.getByRole('button', { name: 'New user', exact: true }).count()) === 0, 'member: New user is offered')
      check((await s.getByRole('button', { name: 'New agent', exact: true }).count()) === 0, 'member: New agent is offered')
      check((await s.getByRole('button', { name: /^Actions for / }).count()) === 0, 'member: row action menus are offered')
      const total = Number((await rowsShown(ctx)).split(' ')[0])

      // Search narrows.
      await search.fill('toby')
      await eventually(() => rowsShown(ctx), (t) => t.startsWith('1 of '), 'the count after searching "toby"')
      await search.fill('')
      await eventually(() => rowsShown(ctx), (t) => t === `${total} users`, 'the count after clearing the search')

      // Filter narrows: Role is Admin.
      await (await one(s.getByRole('button', { name: 'Filters', exact: true }), 'Filters')).click()
      const panel = ctx.page.getByRole('group', { name: 'Filter fields', exact: true })
      await (await one(panel.getByRole('button', { name: 'Role', exact: true }), 'the Role field')).click()
      await (await one(ctx.page.getByRole('group', { name: 'Role', exact: true }).getByRole('button', { name: 'Admin', exact: true }), 'the Admin option')).click()
      await eventually(() => rowsShown(ctx), (t) => new RegExp(`^\\d+ of ${total} users$`).test(t), 'the count with Role: Admin')
      await ctx.page.keyboard.press('Escape')
      await one(dialog(ctx.page, 'Settings'), 'Settings dialog after closing the filter panel')
      await (await one(s.getByRole('button', { name: 'Clear 1 filter', exact: true }), 'Clear 1 filter')).click()
      await eventually(() => rowsShown(ctx), (t) => t === `${total} users`, 'the count after clearing the filter')

      // Open another person: their page reads, nothing saves.
      await search.fill('toby')
      await (await one(s.getByText('Tobias Strebitzer', { exact: true }), 'Toby\'s row')).click()
      await one(s.getByText('Only administrators can change other people.', { exact: true }), 'the read-only note on Toby\'s page')
      check((await s.getByRole('button', { name: /^(Save|Delete)/ }).count()) === 0, 'member: Save or Delete offered on another person')
      const editable = await s.locator('input:not([type=hidden]):not([readonly]):not(:disabled), textarea:not([readonly]):not(:disabled)').evaluateAll(
        // Visible ones: the avatar's file input is hidden behind its (disabled) button.
        (els) => els.filter((e) => (e as HTMLElement).offsetParent !== null && !(e as HTMLElement).closest('[inert]') && (e as HTMLInputElement).placeholder !== 'Search users').map((e) => (e as HTMLInputElement).name || e.id || e.outerHTML.slice(0, 80)),
      )
      check(editable.length === 0, `member: Toby's page has editable fields: ${editable.join(', ')}`)
      const live = await s.getByRole('button', { name: /^(Upload avatar image|Swatch )/ }).evaluateAll((els) => els.filter((e) => !e.matches(':disabled') && (e as HTMLElement).offsetParent !== null).length)
      check(live === 0, `member: ${live} avatar or swatch buttons on Toby's page are live`)
      await none(s.getByRole('button', { name: 'New user', exact: true }), 'New user on Toby\'s page', 500)
    },
  },
]
