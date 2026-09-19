/**
 * `@silkweave/box-ui/charts` - the plotted forms: a time series, a multi-series line, and the
 * sparkline that fits in a card, plus the palette and chrome they share.
 *
 * A SEPARATE entry point because it is the only thing in the library that needs `recharts`, which
 * is declared as an OPTIONAL peer dependency. This package has no build step - both consumers
 * resolve the `@silkweave/box-source` condition straight to `src/` - so anything the root barrel
 * re-exports is walked by the type-checker and by Vite's scanner on EVERY import of it. Re-exported
 * from `.`, a Box that never draws a chart would still have to resolve recharts. Tree-shaking never
 * gets a say; resolution fails first.
 *
 * The design rules these were built to (palette, mark specs, the hover layer, the accessibility
 * pass) are the `dataviz` skill's. Two of them decide most of the API here:
 *
 *  - **Colour is a token and a SLOT, never a hex and never a cycle.** `tokens.css` holds the eight
 *    validated steps per theme; `seriesColor(i)` hands them out in fixed order. Re-run the skill's
 *    validator if you touch them.
 *  - **The chart plots numbers; the app supplies the words.** Every label, caption, headline and
 *    tooltip sentence is a prop - a `ReactNode` or a formatter - because the vocabulary of a
 *    measure belongs to the feature that owns it, not to the drawing.
 */
export { ChartLegend, ChartTooltip, ChartTooltipRow, LineKey, type LegendEntry } from './ChartTooltip.tsx'
export { SeriesLineChart, type ChartSeries, type SeriesTooltipRow } from './SeriesLineChart.tsx'
export { Sparkline } from './Sparkline.tsx'
export { TimeSeriesChart, type TimeSeriesPoint } from './TimeSeriesChart.tsx'
export {
  DEFAULT_TIME_RANGES,
  rangesFor,
  spanDays,
  windowPoints,
  type TimeRange,
} from './ranges.ts'
export {
  AXIS_TICK,
  CHART_AXIS,
  CHART_GRID,
  CHART_INK,
  CHART_SERIES,
  CHART_SURFACE,
  MARK,
  MAX_SERIES,
  MAX_SERIES_ALL_PAIRS,
  seriesColor,
} from './theme.ts'
