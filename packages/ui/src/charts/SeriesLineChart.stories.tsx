import type { Meta, StoryObj } from '@storybook/react-vite'
import { SeriesLineChart } from './SeriesLineChart.tsx'
import { ChartTooltipRow } from './ChartTooltip.tsx'
import { BURNDOWN, CHANNELS } from './fixtures.ts'
import { CHART_SERIES } from './theme.ts'
import { withStage } from '../stories/Stage.tsx'

const meta = {
  title: 'Charts/SeriesLineChart',
  component: SeriesLineChart,
  decorators: [withStage],
} satisfies Meta<typeof SeriesLineChart<Record<string, unknown>>>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Three series, ONE scale. There is no second-axis prop and there will not be one: a chart with two
 * y-scales can be made to say anything, because the crossing point is chosen by whoever picked the
 * domains. Two measures of different magnitude are two charts, small multiples, or both indexed to
 * a common base.
 *
 * The legend is always drawn for two or more series - it is the identity channel that survives
 * having no pointer.
 */
export const Default: Story = {
  args: { data: CHANNELS, xKey: 'week', series: [] },
  render: () => (
    <SeriesLineChart
      data={CHANNELS}
      xKey='week'
      height={280}
      formatValue={(v) => `${v}`}
      series={[
        { key: 'blog', label: 'Blog' },
        { key: 'newsletter', label: 'Newsletter' },
        { key: 'social', label: 'Social' },
      ]}
    />
  ),
}

/**
 * Plan against actual, and the two things that make it honest:
 *
 *  - The ideal line is DASHED. Colour is never the only difference between two series; the dash
 *    survives a greyscale print and full-severity colour blindness, and the legend repeats it.
 *  - The actual line STOPS at the last real reading (`remaining` is null past it, `connectNulls`
 *    off). Running it flat to the right edge would read as "nothing more will get done" - a claim
 *    about the future the data has not made.
 *
 * The tooltip body is the CALLER's: "not yet" and "planned" are this chart's vocabulary, not the
 * library's.
 */
export const PlanAgainstActual: Story = {
  args: { data: BURNDOWN, xKey: 'day', series: [] },
  render: () => (
    <SeriesLineChart
      data={BURNDOWN}
      xKey='day'
      formatValue={(v) => `${v}h`}
      yDomain={[0, (max: number) => Math.max(20, Math.ceil(max / 20) * 20)]}
      reference={{ x: 'Tue 7', label: 'today' }}
      series={[
        { key: 'ideal', label: 'Ideal', color: 'var(--chart-ink)', dashed: true },
        { key: 'remaining', label: 'Remaining', dots: true },
      ]}
      renderTooltip={(_row, rows) => (
        <>
          <ChartTooltipRow
            color={rows[1].color}
            label='Left'
            value={rows[1].value === null ? 'not yet' : `${rows[1].value}h`}
          />
          <ChartTooltipRow color={rows[0].color} dashed label='Planned' value={`${rows[0].value}h`} />
        </>
      )}
      caption="Working days only, and the ideal line follows capacity - a half day is a half step."
    />
  ),
}

/** Every slot at once, in the order the palette hands them out. Past eight the palette stops rather
 *  than inventing a ninth hue: fold the tail into one series or facet into small multiples. */
export const EightSlots: Story = {
  args: { data: CHANNELS, xKey: 'week', series: [] },
  render: () => (
    <SeriesLineChart
      data={CHANNELS.map((r, i) => ({
        ...r,
        ...Object.fromEntries(CHART_SERIES.map((_, s) => [`s${s}`, Math.round(80 + s * 45 + Math.sin((i + s) / 2.2) * 22)])),
      }))}
      xKey='week'
      height={300}
      series={CHART_SERIES.map((_, s) => ({ key: `s${s}`, label: `Slot ${s + 1}` }))}
    />
  ),
}
