// A trend with no axes, no grid and no tooltip box - the chart that fits inside a card.
//
// It is deliberately not a small TimeSeriesChart. A sparkline's job is direction, not value: the
// number it belongs to is already printed beside it, so axes would be furniture and a floating
// tooltip would cover the thing it explains. What it does instead is SCRUB - `onHoverIndex` hands
// the hovered index back and the caller re-points its own headline at that reading, which keeps the
// value in one place on the card instead of two.
//
// Windowing is the caller's: how much recent history counts as "lately" is a judgement about the
// measure (see `apps/web`'s signal card), not something a 44px plot can decide.

import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'
import { cn } from '../lib/utils.ts'
import { CHART_AXIS, CHART_SURFACE, MARK, seriesColor } from './theme.ts'

export function Sparkline({
  points,
  color = seriesColor(0),
  height = 44,
  onHoverIndex,
  className,
}: {
  /** In order. One point draws as a dot - a line needs two. */
  points: { value: number }[]
  color?: string
  height?: number
  /** The hovered index, or null on leave. Wire it to whatever the sparkline sits beside. */
  onHoverIndex?: (index: number | null) => void
  className?: string
}) {
  const single = points.length < 2

  return (
    <div className={cn(className)}>
      <ResponsiveContainer width='100%' height={height}>
        <LineChart
          data={points}
          margin={{ top: MARK.dot + MARK.ring, right: 2, bottom: MARK.dot, left: 2 }}
          onMouseMove={(s) => {
            if (!onHoverIndex) return
            // recharts 3 reports activeTooltipIndex as a string; coerce and gate on the flag.
            const i = s?.isTooltipActive ? Number(s.activeTooltipIndex) : NaN
            onHoverIndex(Number.isInteger(i) ? i : null)
          }}
          onMouseLeave={() => onHoverIndex?.(null)}>
          {/* dataMin..dataMax, not zero-based: a sparkline reads SHAPE, and anchoring a flat series
              at zero flattens the only thing it has to say. The value beside it carries the level. */}
          <YAxis hide domain={['dataMin', 'dataMax']} />
          {/* The tooltip is here only to drive the cursor line and the active dot; its box is
              suppressed, because the caller's headline is the readout. */}
          <Tooltip cursor={{ stroke: CHART_AXIS }} content={() => null} />
          <Line
            type='monotone'
            dataKey='value'
            stroke={color}
            strokeWidth={MARK.line}
            dot={single ? { r: MARK.dot, fill: color, stroke: CHART_SURFACE, strokeWidth: MARK.ring } : false}
            activeDot={{ r: MARK.dot, fill: color, stroke: CHART_SURFACE, strokeWidth: MARK.ring }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
