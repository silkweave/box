// Gate B: the same pieces in every frame they appear in (full page, Settings, section card, app
// page), wide and narrow, both themes. Geometry is asserted (header 33px, rows 48px, header and
// cells on the same column lines, names on one start line); a reviewed screenshot catches the rest.

import { check, rect, type RenderedSpec, type SpecContext } from './harness.ts'

const WIDTHS = [1280, 820]
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol

/** Every table on the page: header 33px, list rows 48px, header columns on the cells' lines. */
async function gridGeometry({ page }: SpecContext, story: string): Promise<void> {
  const tables = page.locator('[role="table"]')
  const n = await tables.count()
  check(n > 0, `${story}: no table rendered`)
  for (let t = 0; t < n; t++) {
    const table = tables.nth(t)
    const header = table.locator('[role="row"]:has([role="columnheader"])').first()
    const rows = table.locator('[data-row]')
    const rowCount = await rows.count()
    if (rowCount === 0) continue
    const what = `${story} table ${t + 1}`
    if ((await header.count()) === 1 && (await header.isVisible())) {
      const h = await rect(header, `${what} header`)
      check(near(h.height, 33, 0.5), `${what}: header is ${h.height}px, expected 33`)
      // Each visible column header starts where the first row's cell of that column starts.
      const heads = header.locator('[role="columnheader"]')
      const cells = rows.first().locator(':scope > [role="cell"], :scope [role="cell"]')
      const hc = await heads.count()
      const cc = await cells.count()
      for (let i = 0; i < Math.min(hc, cc); i++) {
        const hd = await heads.nth(i).boundingBox()
        const cl = await cells.nth(i).boundingBox()
        if (!hd || !cl || hd.width === 0 || cl.width === 0) continue
        check(near(hd.x, cl.x), `${what}: column ${i + 1} header starts at ${hd.x.toFixed(1)}, its cells at ${cl.x.toFixed(1)}`)
      }
    }
    const starts = new Set<string>()
    for (let r = 0; r < Math.min(rowCount, 12); r++) {
      const row = rows.nth(r)
      const box = await row.boundingBox()
      if (!box) continue
      // Card layouts and rows with an open detail grow on purpose; list rows are 48px.
      if ((await row.getAttribute('aria-expanded')) === 'true' || (await row.locator('[role="cell"]').count()) === 0) continue
      check(box.height >= 47.5, `${what}: row ${r + 1} is ${box.height}px, expected at least 48`)
      const first = await row.locator('[role="cell"]').first().boundingBox()
      if (first) starts.add(first.x.toFixed(0))
      // Every cell after the name holds one line of content, centred on the row: a chip whose
      // picture sits higher than its letter-tile siblings shows up here.
      const off = await row.locator('[role="cell"]').evaluateAll((cells, rowBox) => {
        const mid = (rowBox as { y: number; height: number }).y + (rowBox as { height: number }).height / 2
        return cells.slice(1).flatMap((c, i) => {
          const leaf = [...c.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent ?? '').trim() !== '' && (e as HTMLElement).offsetParent !== null)
          return leaf.flatMap((e) => {
            const b = e.getBoundingClientRect()
            const d = b.y + b.height / 2 - mid
            return Math.abs(d) > 1.5 ? [`column ${i + 2} "${(e.textContent ?? '').trim().slice(0, 20)}" ${d.toFixed(1)}px`] : []
          })
        })
      }, box)
      check(off.length === 0, `${what}: row ${r + 1} content off its centre line: ${off.join('; ')}`)
    }
    check(starts.size <= 1, `${what}: rows start their first cell at different x (${[...starts].join(', ')})`)
  }
}

const FRAMES = [
  'grid-datagrid--full',
  'grid-datagrid--full-grouped',
  'grid-datagrid--card',
  'grid-datagrid--card-everything',
  'patterns-settings-list--list',
  'patterns-settings-list--grouped',
  'patterns-settings-list--editable',
  'patterns-list-view--page',
]

export const specs: RenderedSpec[] = [
  ...FRAMES.map((story): RenderedSpec => ({
    story,
    name: 'grid geometry: 33px header, 48px rows, columns on one line',
    widths: WIDTHS,
    run: (ctx) => gridGeometry(ctx, story),
  })),
  ...[...FRAMES, 'grid-name-cell--siblings', 'grid-cells--select-threshold', 'grid-cells--numbers', 'grid-cells--text', 'grid-cells--dates', 'grid-cells--titles', 'grid-cells--tags'].map(
    (story): RenderedSpec => ({
      story,
      name: 'matches its reviewed screenshot',
      widths: story.startsWith('grid-cells') ? [1280] : WIDTHS,
      run: (ctx) => ctx.screenshot('root'),
    }),
  ),
]
