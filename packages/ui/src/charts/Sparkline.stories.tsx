import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Sparkline } from './Sparkline.tsx'
import { DAILY } from './fixtures.ts'
import { seriesColor } from './theme.ts'
import { withStage } from '../stories/Stage.tsx'

const meta = {
  title: 'Charts/Sparkline',
  component: Sparkline,
  decorators: [withStage],
} satisfies Meta<typeof Sparkline>

export default meta
type Story = StoryObj<typeof meta>

const nf = new Intl.NumberFormat('en-US')
const points = DAILY.slice(-30)

/** No axes, no grid, no tooltip box. A sparkline says direction; the number beside it says value. */
export const Default: Story = {
  args: { points },
  render: () => (
    <div className='max-w-64 rounded-lg border border-border bg-surface p-4'>
      <div className='text-body-sm text-muted-foreground'>Weekly signups</div>
      <div className='text-display-lg tabular-nums leading-none text-text'>{nf.format(points[points.length - 1].value)}</div>
      <Sparkline className='-mx-1 mt-1' points={points} />
    </div>
  ),
}

/**
 * Hover it. `onHoverIndex` hands the index back and the CARD re-points its headline at that
 * reading, so the value stays in one place instead of appearing twice - which is why there is no
 * floating tooltip here.
 */
export const Scrubbing: Story = {
  args: { points },
  render: function Scrub() {
    const [i, setI] = useState<number | null>(null)
    const at = i == null ? points[points.length - 1] : points[i]
    return (
      <div className='max-w-64 rounded-lg border border-border bg-surface p-4'>
        <div className='text-body-sm text-muted-foreground'>{at.date}</div>
        <div className='text-display-lg tabular-nums leading-none text-text'>{nf.format(at.value)}</div>
        <Sparkline className='-mx-1 mt-1' points={points} onHoverIndex={setI} color={seriesColor(2)} />
      </div>
    )
  },
}

/** Two points is a line; one is a dot. */
export const TwoPoints: Story = {
  args: { points: points.slice(-2) },
  render: () => (
    <div className='max-w-64 rounded-lg border border-border bg-surface p-4'>
      <Sparkline points={points.slice(-2)} />
    </div>
  ),
}
