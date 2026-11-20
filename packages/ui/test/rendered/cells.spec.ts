// Gate A: the production grid cells (`src/list/cells.tsx`) through their story fixtures
// (`src/list/cells.stories.tsx`). SelectCell is measured on both sides of its option threshold,
// where its trigger's DOM changes (a Select below, a searchable popover above).

import { check, expectCentered, expectInside, expectSize, one, rect, type RenderedSpec, type SpecContext } from './harness.ts'

const THRESHOLD = 5
const SIDES = [THRESHOLD, THRESHOLD + 1]
const trigger = async (ctx: SpecContext, id: string) => one((await ctx.fixture(id)).locator('[aria-label="Kind"]'), `${id} trigger`)

/** Every fixture of a story keeps its content inside its host. */
const noSpill = (story: string, ids: string[]): RenderedSpec => ({
  story,
  name: 'content stays inside its host',
  run: async (ctx) => {
    for (const id of ids) {
      const host = await ctx.fixture(id)
      await expectInside(host, host.locator(':scope > *').first(), id)
    }
  },
})

export const specs: RenderedSpec[] = [
  {
    story: 'grid-cells--select-threshold',
    name: 'icon-only: a 32px square with its glyph centred, on both sides of the threshold',
    run: async (ctx) => {
      for (const width of ['wide', 'narrow']) {
        const offsets: string[] = []
        for (const count of SIDES) {
          const id = `select-${count}-icon-${width}`
          const t = await trigger(ctx, id)
          const glyph = await one(t.locator('[data-glyph]'), `${id} glyph`)
          await expectSize(t, 32, 32, `${id} trigger`)
          await expectCentered(t, glyph, id)
          const tr = await rect(t, id)
          const g = await rect(glyph, id)
          offsets.push(`${(g.x - tr.x).toFixed(1)},${(g.y - tr.y).toFixed(1)}`)
        }
        check(offsets[0] === offsets[1], `icon ${width}: the glyph sits at ${offsets[0]} below the threshold and ${offsets[1]} above it`)
      }
    },
  },
  {
    story: 'grid-cells--select-threshold',
    name: 'text: the same resting look on both sides of the threshold',
    run: async (ctx) => {
      for (const width of ['wide', 'narrow']) {
        const seen: string[] = []
        for (const count of SIDES) {
          const id = `select-${count}-text-${width}`
          const host = await ctx.fixture(id)
          const t = await trigger(ctx, id)
          const text = await one(t.getByText('Feature', { exact: true }), `${id} label`)
          await expectInside(host, t, id)
          const tr = await rect(t, id)
          const x = await rect(text, id)
          check(Math.abs(x.y + x.height / 2 - (tr.y + tr.height / 2)) <= 1, `${id}: label is not vertically centred`)
          seen.push(`h${tr.height} x${(x.x - tr.x).toFixed(1)}`)
        }
        check(seen[0] === seen[1], `text ${width}: resting look differs across the threshold (${seen[0]} vs ${seen[1]})`)
      }
    },
  },
  {
    story: 'grid-cells--select-threshold',
    name: 'both branches open, pick, clear and give focus back',
    themes: ['light'],
    run: async ({ page, fixture }) => {
      for (const count of SIDES) {
        const id = `select-${count}-text-wide`
        const t = await one((await fixture(id)).locator('[aria-label="Kind"]'), id)
        await t.click()
        const options = page.getByRole('option')
        await options.first().waitFor()
        // The clear option ("No kind") is one more than the kinds.
        check((await options.count()) === count + 1, `${id}: ${await options.count()} options, expected ${count + 1}`)
        if (count > THRESHOLD) {
          const search = await one(page.getByRole('searchbox', { name: 'Search kind' }), `${id} search`)
          await search.fill('bu')
          check((await options.count()) === 1, `${id}: search "bu" left ${await options.count()} options`)
          await search.fill('')
        } else {
          check((await page.getByRole('searchbox', { name: 'Search kind' }).count()) === 0, `${id}: a search box below the threshold`)
        }
        await page.getByRole('option', { name: 'Bug' }).click()
        await one(t.getByText('Bug', { exact: true }), `${id} picked value`)
        await t.click()
        await page.getByRole('option', { name: 'No kind' }).click()
        check((await t.getByText('Bug', { exact: true }).count()) === 0, `${id}: clearing kept the value`)
        await t.click()
        await page.getByRole('option').first().waitFor()
        await page.keyboard.press('Escape')
        await page.getByRole('option').first().waitFor({ state: 'detached' })
        check(await t.evaluate((el) => el === document.activeElement), `${id}: Escape did not return focus to the trigger`)
      }
    },
  },
  {
    story: 'grid-cells--numbers',
    name: 'the unit at rest, the bare number while editing, right-aligned',
    run: async ({ page, fixture }) => {
      const money = await fixture('number-money')
      const button = await one(money.getByRole('button', { name: 'Edit MRR' }), 'money button')
      check((await button.innerText()).includes('$1,250'), `money at rest reads "${await button.innerText()}"`)
      const host = await rect(money, 'money host')
      const text = await rect(button.locator('span').first(), 'money text')
      check(host.x + host.width - (text.x + text.width) <= 8, 'money is not right-aligned')
      await button.click()
      const input = await one(money.locator('input[type="number"]'), 'money input')
      check((await input.inputValue()) === '1250', `editing shows "${await input.inputValue()}"`)
      await input.fill('2000')
      await input.press('Enter')
      await one(money.getByRole('button', { name: 'Edit MRR' }), 'money button after save')
      check((await money.innerText()).includes('$2,000'), `after save reads "${await money.innerText()}"`)
      check((await (await fixture('number-percent')).innerText()).includes('40%'), 'percent lost its unit')
      check((await (await fixture('number-reader')).getByRole('button').count()) === 0, 'a reader can edit the number')
      void page
    },
  },
  {
    story: 'grid-cells--text',
    name: 'edits on blur, reseeds, reader sees text only',
    run: async ({ fixture }) => {
      const cell = await fixture('text')
      const input = await one(cell.getByRole('textbox', { name: 'Next action' }), 'text input')
      await input.fill('Call back on Monday')
      await input.press('Enter')
      check((await input.inputValue()) === 'Call back on Monday', 'text did not keep the edit')
      check((await (await fixture('text-reader')).getByRole('textbox').count()) === 0, 'a reader can edit the text')
    },
  },
  {
    story: 'grid-cells--dates',
    name: 'a moment reads relative and offers a time field',
    themes: ['light'],
    run: async ({ page, fixture }) => {
      const cell = await fixture('date-time')
      const t = await one(cell.getByRole('button', { name: 'Due' }), 'date-time trigger')
      check(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test((await t.getAttribute('title')) ?? ''), `date-time tooltip "${await t.getAttribute('title')}"`)
      await t.click()
      const time = await one(page.getByRole('textbox', { name: 'Due, time (24-hour)' }), 'time field')
      check(/^\d{2}:\d{2}$/.test(await time.inputValue()), `time field shows "${await time.inputValue()}"`)
      await page.keyboard.press('Escape')
    },
  },
  {
    story: 'grid-cells--titles',
    name: 'a linked title opens, a plain title renames, the summary is read-only',
    themes: ['light'],
    run: async ({ fixture }) => {
      const link = await fixture('title-link')
      check((await link.getByRole('link').count()) === 1, 'linked title has no link')
      const plain = await fixture('title-plain')
      check((await plain.getByRole('link').count()) === 0, 'plain title renders a link')
      await plain.getByRole('button', { name: 'Call the accountant' }).click()
      await one(plain.getByRole('textbox', { name: 'Reminder name' }), 'rename input')
      check((await (await fixture('title-summary')).getByRole('textbox').count()) === 0, 'the summary line is editable')
    },
  },
  noSpill('grid-cells--numbers', ['number-money', 'number-percent', 'number-empty', 'number-reader']),
  noSpill('grid-cells--text', ['text', 'text-mono', 'text-empty', 'text-reader']),
  noSpill('grid-cells--dates', ['date', 'date-overdue', 'date-empty', 'date-time']),
  noSpill('grid-cells--titles', ['title-link', 'title-summary', 'title-plain']),
  noSpill('grid-cells--tags', ['tags', 'tags-empty']),
]
