// Hash-routed create dialogs (`useHashDialog`, `RecordDialog`) on Sprints: the address owns the
// dialog, so a direct load and a reload open it and Back closes it; a dirty form asks before Escape
// or Back throws the typing away (Stay keeps it, Discard closes).

import { check, dialog, eventually, hashOf, none, one, type FlowSpec } from './harness.ts'

const NEW = 'New sprint'
const DRAFT = 'Gate C draft sprint (never saved)'

export const specs: FlowSpec[] = [
  {
    name: 'hash dialog: /sprints#new opens on load and reload, Back closes it',
    run: async ({ page, open }) => {
      await open('/sprints#new')
      const d = await one(dialog(page, NEW), 'New sprint dialog on direct load')
      await one(d.getByLabel('Name', { exact: true }), 'Name field')
      const focusInside = await eventually(() => d.evaluate((el) => el.contains(document.activeElement)), Boolean, 'focus moves into the dialog')
      check(focusInside, 'focus is not inside the New sprint dialog')
      await page.reload()
      await one(dialog(page, NEW), 'New sprint dialog after reload', 20000)
      check(hashOf(page) === 'new', `after reload the hash is #${hashOf(page)}, expected #new`)

      // Opened from the list's button, Back closes it and leaves the list.
      await open('/sprints')
      await (await one(page.getByRole('button', { name: NEW, exact: true }), 'New sprint button')).click()
      await one(dialog(page, NEW), 'New sprint dialog from the button')
      check(hashOf(page) === 'new', `the button set #${hashOf(page)}, expected #new`)
      await page.goBack()
      await none(dialog(page, NEW), 'New sprint dialog after Back')
      check(new URL(page.url()).pathname === '/sprints' && hashOf(page) === '', `Back went to ${new URL(page.url()).pathname}#${hashOf(page)}, expected /sprints`)
    },
  },
  {
    name: 'hash dialog: Escape or Back on a dirty form asks; Stay keeps the text, Discard closes',
    run: async ({ page, open }) => {
      await open('/sprints')
      await (await one(page.getByRole('button', { name: NEW, exact: true }), 'New sprint button')).click()
      const d = await one(dialog(page, NEW), 'New sprint dialog')
      const name = await one(d.getByLabel('Name', { exact: true }), 'Name field')
      await name.fill(DRAFT)

      await page.keyboard.press('Escape')
      const ask = await one(dialog(page, 'Discard changes?'), 'Discard question after Escape on a dirty form')
      await (await one(ask.getByRole('button', { name: 'Cancel', exact: true }), 'Stay (Cancel) button')).click()
      await none(dialog(page, 'Discard changes?'), 'Discard question after Stay')
      await one(dialog(page, NEW), 'New sprint dialog after Stay')
      check((await name.inputValue()) === DRAFT, `Stay lost the typing: Name is "${await name.inputValue()}"`)
      check(hashOf(page) === 'new', `after Stay the hash is #${hashOf(page)}, expected #new`)

      await page.goBack()
      const askBack = await one(dialog(page, 'Discard changes?'), 'Discard question after Back on a dirty form')
      await (await one(askBack.getByRole('button', { name: 'Cancel', exact: true }), 'Stay (Cancel) button')).click()
      await one(dialog(page, NEW), 'New sprint dialog after Stay on Back')
      check((await name.inputValue()) === DRAFT, `Stay on Back lost the typing: Name is "${await name.inputValue()}"`)

      await page.keyboard.press('Escape')
      const again = await one(dialog(page, 'Discard changes?'), 'Discard question on the second Escape')
      await (await one(again.getByRole('button', { name: 'Discard', exact: true }), 'Discard button')).click()
      await none(dialog(page, NEW), 'New sprint dialog after Discard')
      check(hashOf(page) === '', `after Discard the hash is #${hashOf(page)}, expected none`)
      await none(page.getByText(DRAFT), 'the discarded draft (nothing was saved)', 2000)
    },
  },
]
