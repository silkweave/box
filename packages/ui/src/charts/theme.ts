// The chart palette and the chrome every chart in this library draws with.
//
// Colours are TOKEN references, never hex: `src/styles/tokens.css` is the single source of colour
// truth and carries the light and dark steps of each slot, so a chart follows the theme toggle
// without knowing a theme exists.
//
// The eight series slots are assigned IN FIXED ORDER and never cycled. That order is a
// colour-vision safety property (it was validated pairwise against this Box's chart surface in both
// modes - see the note over `--chart-1` in tokens.css), so slot 5 is slot 5 whatever else is on
// screen: a filter that drops series never repaints the survivors. Past eight, the answer is not a
// ninth hue - fold the tail into one "Other" series, facet into small multiples, or add a second
// encoding.

/** The categorical slots, in their validated order. Index 0 is the Box accent. */
export const CHART_SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const

/** How many series one chart may colour. See the header: a ninth is a composition problem. */
export const MAX_SERIES = CHART_SERIES.length

/**
 * Forms where every series can touch every other one - scatter, bubble, small multiples - hold a
 * tighter bar than lines and stacks do, and only the first three slots clear it. Past three in such
 * a chart, facet instead.
 */
export const MAX_SERIES_ALL_PAIRS = 3

let warned = false

/** The colour of series `index`, clamped at the last slot with one dev warning rather than a crash:
 *  two series sharing a colour is a bad chart, a blank page is a broken app. */
export function seriesColor(index: number): string {
  if (index >= MAX_SERIES) {
    if (!warned && typeof console !== 'undefined') {
      warned = true
      console.warn(
        `[box-ui/charts] ${index + 1} series asked for a colour and there are ${MAX_SERIES} slots. ` +
          'Hues are never generated or cycled - fold the tail into one series, facet into small ' +
          'multiples, or add a second encoding.',
      )
    }
    return CHART_SERIES[MAX_SERIES - 1]
  }
  return CHART_SERIES[Math.max(0, index)]
}

/** The colour the 2px gaps and mark rings are painted in: whatever the chart actually sits on. */
export const CHART_SURFACE = 'var(--chart-surface)'
/** Hairline, SOLID, one step off the surface. A dashed grid competes with a dashed series. */
export const CHART_GRID = 'var(--chart-grid)'
export const CHART_AXIS = 'var(--chart-axis)'
/** Axis and tick ink. Text NEVER wears a series colour - the coloured mark beside it carries the
 *  identity. */
export const CHART_INK = 'var(--chart-ink)'

/** Tick typography, shared so every axis in the library reads the same. */
export const AXIS_TICK = { fill: CHART_INK, fontSize: 11 } as const

/** Marks. A marker is >= 8px across (r >= 4) and carries a 2px ring in the surface colour so it
 *  stays legible where it crosses its own line. */
export const MARK = { line: 2, dot: 4, ring: 2 } as const
