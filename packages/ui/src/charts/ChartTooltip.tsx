// The tooltip surface, and the legend key. Both are plain DOM - they are here so that an app that
// writes its own tooltip body (which is usually right: the wording of a row is the app's) draws it
// in the same box the library's default one uses.

import type { ReactNode } from 'react'
import { cn } from '../lib/utils.ts'
import { CHART_INK } from './theme.ts'

/** The floating surface a chart's hover layer renders into. Body is the caller's. */
export function ChartTooltip({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-md border border-border bg-surface px-2.5 py-1.5 text-label shadow-(--shadow-md)',
        className,
      )}>
      {children}
    </div>
  )
}

/** One `label: value` row inside a tooltip, with the series' colour carried by a short line key
 *  beside the text rather than by colouring the text. */
export function ChartTooltipRow({
  color,
  dashed,
  label,
  value,
}: {
  color?: string
  dashed?: boolean
  label: ReactNode
  value: ReactNode
}) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <span className='flex items-center gap-1.5 text-muted-foreground'>
        {color ? <LineKey color={color} dashed={dashed} /> : null}
        {label}
      </span>
      <span className='font-medium tabular-nums text-text'>{value}</span>
    </div>
  )
}

/** An 18x2 line in the series colour - the swatch a legend and a tooltip row share. Dashed repeats
 *  the stroke pattern, which is the second encoding that keeps identity off colour alone. */
export function LineKey({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width='18' height='2' aria-hidden className='shrink-0'>
      <line
        x1='0'
        y1='1'
        x2='18'
        y2='1'
        stroke={color}
        strokeWidth='2'
        strokeDasharray={dashed ? '4 3' : undefined}
      />
    </svg>
  )
}

export interface LegendEntry {
  label: ReactNode
  color: string
  dashed?: boolean
}

/**
 * The legend. Present whenever a chart draws two or more series - identity is never colour alone,
 * and a legend is the channel that never depends on a hover. A SINGLE series gets none: there is
 * one colour, and whatever titles the chart already says what it is.
 */
export function ChartLegend({ entries, className }: { entries: LegendEntry[]; className?: string }) {
  if (entries.length < 2) return null
  return (
    <div
      className={cn('flex flex-wrap items-center justify-end gap-4 text-label', className)}
      style={{ color: CHART_INK }}>
      {entries.map((e, i) => (
        <span key={i} className='inline-flex items-center gap-1.5'>
          <LineKey color={e.color} dashed={e.dashed} />
          {e.label}
        </span>
      ))}
    </div>
  )
}
