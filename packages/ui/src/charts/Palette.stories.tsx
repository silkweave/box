import type { Meta, StoryObj } from '@storybook/react-vite'
import { CHART_SERIES, MAX_SERIES_ALL_PAIRS } from './theme.ts'
import { withStage } from '../stories/Stage.tsx'

const meta = { title: 'Charts/Palette', decorators: [withStage] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const NAMES = ['indigo (accent)', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'blue', 'red']

/**
 * The eight categorical slots, from `--chart-1..8` in `src/styles/tokens.css`. Flip the toolbar's
 * Theme control: the dark column is a SELECTED set of steps for the dark surface, not an automatic
 * flip of the light one.
 *
 * Three things about them are load-bearing, and none is taste:
 *
 *  - **They are assigned in fixed order and never cycled.** The order is the colour-vision safety
 *    property: each neighbouring pair was checked, in both modes, against this Box's own chart
 *    surface. A ninth series is never a generated hue.
 *  - **Colour follows the entity, not its rank.** A filter that drops a series must not repaint the
 *    survivors, which is what the `color` prop on a series is for.
 *  - **Only the first three clear the all-pairs bar**, so a form where every series touches every
 *    other one - scatter, bubble, small multiples - stops at three and facets after that.
 *
 * Changing a value here means re-running the `dataviz` skill's validator against both surfaces.
 * Do not eyeball it.
 */
export const Slots: Story = {
  render: () => (
    <div className='grid max-w-2xl gap-2'>
      {CHART_SERIES.map((c, i) => (
        <div key={c} className='flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2'>
          <span className='size-8 shrink-0 rounded' style={{ background: c }} />
          <span className='w-24 text-body-sm tabular-nums text-text'>Slot {i + 1}</span>
          <span className='flex-1 text-body-sm text-muted-foreground'>{NAMES[i]}</span>
          <span className='font-mono text-label text-muted-foreground'>{c}</span>
          {i < MAX_SERIES_ALL_PAIRS ? (
            <span className='rounded bg-accent-tint px-1.5 py-0.5 text-label text-accent'>all-pairs safe</span>
          ) : null}
        </div>
      ))}
    </div>
  ),
}
