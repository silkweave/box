import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SignalDirection } from '../../types.ts'
import { formatDelta, formatNumber, type Delta } from '../../lib/format.ts'

/**
 * The one renderer of a signal's change, shared by the Signals list, the detail's latest reading
 * and its snapshots. Colour means good or bad, so it follows the signal's declared direction ("Up is
 * good" or "Down is good"): a fall in a "down is good" signal is green. A signal with no direction,
 * or no change, stays neutral.
 */
export function deltaTone(dir: Delta['dir'], direction?: SignalDirection | null): 'good' | 'bad' | 'neutral' {
  if (dir === 'flat' || !direction) return 'neutral'
  return dir === direction ? 'good' : 'bad'
}

const TEXT = { good: 'text-success', bad: 'text-danger', neutral: 'text-muted-foreground' } as const
const CHIP = { good: 'bg-success-bg text-success', bad: 'bg-danger-bg text-danger', neutral: 'text-muted-foreground' } as const

/**
 * `row` is the list's cell: arrow and the change with its percentage. `chip` is the detail's tinted
 * percentage. `plain` is a bare signed number (a snapshot row's change from the one before).
 */
export function SignalDelta({ delta, direction, variant = 'row' }: {
  delta: Delta | null
  direction?: SignalDirection | null
  variant?: 'row' | 'chip' | 'plain'
}) {
  if (!delta) return null
  const tone = deltaTone(delta.dir, direction)
  if (variant === 'plain') {
    return (
      <span className={cn('block w-full text-right text-body-sm tabular-nums', TEXT[tone])}>
        {delta.abs > 0 ? '+' : ''}
        {formatNumber(delta.abs)}
      </span>
    )
  }
  if (variant === 'chip') {
    const Icon = delta.dir === 'up' ? ArrowUpRight : delta.dir === 'down' ? ArrowDownRight : Minus
    return (
      <span
        className={cn('inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-label tabular-nums whitespace-nowrap', CHIP[tone])}
        title={`Change from the previous bucket: ${formatDelta(delta)}`}>
        <Icon className='size-3' />
        {delta.pct == null ? formatNumber(delta.abs) : `${delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(1)}%`}
      </span>
    )
  }
  return (
    <span className={cn('block w-full text-right text-label tabular-nums whitespace-nowrap', TEXT[tone])}>
      {delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '–'} {formatDelta(delta)}
    </span>
  )
}
