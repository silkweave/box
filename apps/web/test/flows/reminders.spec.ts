// Reminders: the row menu's Edit reminder opens `#edit-<id>` over the list; saving changes the
// reminder's name and the description line under it and closes the dialog; the name cell renames in
// place on click (a reminder has no page, so the name is no link). The reminder is created for the
// spec through the API and deleted at the end.

import { check, dialog, eventually, hashOf, none, one, trpcCall, type FlowSpec } from './harness.ts'

export const specs: FlowSpec[] = [
  {
    name: 'reminders: Edit reminder at #edit-<id> saves name and description; the name renames in place',
    run: async (ctx) => {
      const { page } = ctx
      const stamp = Date.now().toString(36)
      const t1 = `Gate C reminder ${stamp}`
      const t2 = `Gate C reminder ${stamp} edited`
      const t3 = `Gate C reminder ${stamp} renamed`
      const d2 = `Gate C description ${stamp}`
      await ctx.open('/reminders')
      const created = await trpcCall<{ id: string }>(page, 'mutation', 'remindersUpsert', { title: t1, description: 'Gate C first line', due_at: '2099-01-01T09:00:00.000Z' })
      check(created?.id, 'creating the spec reminder returned no id')
      ctx.cleanup(() => trpcCall(page, 'mutation', 'remindersDelete', { id: created.id }))

      await ctx.open('/reminders')
      const menu = await one(page.getByRole('button', { name: `Actions for ${t1}`, exact: true }), 'the reminder row menu', 20000)
      await menu.click()
      await (await one(page.getByRole('menuitem', { name: 'Edit reminder', exact: true }), 'Edit reminder')).click()
      check(hashOf(page) === `edit-${created.id}`, `Edit reminder set #${hashOf(page)}, expected #edit-${created.id}`)
      const d = await one(dialog(page, 'Edit reminder'), 'Edit reminder dialog')
      const name = await one(d.getByLabel('Name', { exact: true }), 'Name field')
      check((await name.inputValue()) === t1, `the Name field holds "${await name.inputValue()}", expected "${t1}"`)
      await name.fill(t2)
      await (await one(d.getByLabel('Description', { exact: true }), 'Description field')).fill(d2)
      await (await one(d.getByRole('button', { name: 'Save', exact: true }), 'Save')).click()
      await none(dialog(page, 'Discard changes?'), 'a discard question after a successful save', 1500)
      await none(dialog(page, 'Edit reminder'), 'Edit reminder dialog after Save')
      check(hashOf(page) === '', `after Save the hash is #${hashOf(page)}`)
      const row = await one(page.getByRole('button', { name: t2, exact: true }), 'the edited name in its row')
      await one(page.getByText(d2, { exact: true }), 'the edited description line')

      // The name is a rename control, not a link.
      check((await page.getByRole('link', { name: t2 }).count()) === 0, 'the reminder name is a link')
      await row.click()
      const input = await one(page.getByRole('textbox', { name: `Name of ${t2}`, exact: true }), 'the in-place name input')
      await input.fill(t3)
      await input.press('Enter')
      await one(page.getByRole('button', { name: t3, exact: true }), 'the renamed reminder in its row')
      check(new URL(page.url()).pathname === '/reminders', `renaming navigated to ${page.url()}`)
      await eventually(
        async () => (await trpcCall<{ reminders: { id: string; title: string; description: string | null }[] }>(page, 'query', 'remindersList', {})).reminders.find((r) => r.id === created.id),
        (r) => r?.title === t3 && r?.description === d2,
        'the stored reminder',
      )
    },
  },
]
