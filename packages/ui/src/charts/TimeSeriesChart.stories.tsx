import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { TimeSeriesChart } from './TimeSeriesChart.tsx'
import { DAILY, SPARSE } from './fixtures.ts'
import { DEFAULT_TIME_RANGES, rangesFor } from './ranges.ts'
import { seriesColor } from './theme.ts'
import { withStage } from '../stories/Stage.tsx'

const meta = {
  title: 'Charts/TimeSeriesChart',
  component: TimeSeriesChart,
  decorators: [withStage],
} satisfies Meta<typeof TimeSeriesChart>

export default meta
type Story = StoryObj<typeof meta>

const nf = new Intl.NumberFormat('en-US')
const tick = (d: string) => d.slice(5)

/**
 * One measure over time. There is no legend, and that is the rule rather than an omission: a single
 * series has one colour, so the headline above the plot already says what is drawn. A legend box
 * with one swatch restates it and costs space.
 */
export const Default: Story = {
  args: { points: DAILY },
  render: () => (
    <TimeSeriesChart
      points={DAILY}
      formatValue={(v) => nf.format(v)}
      formatTick={tick}
      header={
        <div>
          <div className='text-display-lg tabular-nums leading-none text-text'>{nf.format(DAILY[DAILY.length - 1].value)}</div>
          <div className='mt-1.5 text-label text-muted-foreground'>Downloads, to 2026-08-29</div>
        </div>
      }
    />
  ),
}

/**
 * The window selector is CONTROLLED - the id goes in, a new id comes out - because which window you
 * are looking at usually belongs to a URL or a stored view. Only the presets the data can fill are
 * offered (`rangesFor`): a "1Y" button over 90 days of readings draws the same chart as "All" and
 * tells the reader the series is longer than it is.
 */
export const WithRanges: Story = {
  args: { points: DAILY },
  render: function Ranged() {
    const ranges = rangesFor(DAILY, DEFAULT_TIME_RANGES)
    const [range, setRange] = useState('all')
    return (
      <TimeSeriesChart
        points={DAILY}
        ranges={ranges}
        range={range}
        onRangeChange={setRange}
        formatValue={(v) => nf.format(v)}
        formatTick={tick}
        header={<div className='text-body-sm text-muted-foreground'>npm downloads</div>}
        caption='Every reading is the end of its day; the last bucket is still filling.'
      />
    )
  },
}

/** A series can be pinned to any slot. Pin it to the ENTITY, never to its rank in the current
 *  filter, or dropping one series repaints the others. */
export const SecondSlot: Story = {
  args: { points: DAILY },
  render: () => <TimeSeriesChart points={DAILY} color={seriesColor(1)} formatValue={(v) => nf.format(v)} formatTick={tick} />,
}

/** Four readings and a coarse grain. The markers appear only where the line cannot carry the shape
 *  on its own; each is 8px across with a 2px ring in the surface colour. */
export const Sparse: Story = {
  args: { points: SPARSE },
  render: () => <TimeSeriesChart points={SPARSE} height={200} formatValue={(v) => nf.format(v)} formatTick={tick} />,
}

/** One reading. A single point is drawn as a dot rather than an invisible zero-length line. */
export const SinglePoint: Story = {
  args: { points: DAILY.slice(-1) },
  render: () => <TimeSeriesChart points={DAILY.slice(-1)} height={200} formatValue={(v) => nf.format(v)} formatTick={tick} />,
}
