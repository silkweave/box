// One measure over time: the form for "which way is this going", with real axes, a hover layer and
// an optional window selector.
//
// It plots POINTS, not a domain object. What the series is called, what its number means, whether
// it is up or down that is good, and what sits above it as a headline are all the app's - they
// arrive as a `header` node and a pair of formatters. That is what let one chart replace the one
// that knew about signals.
//
// The window selector is CONTROLLED (`range` in, an id out) for the same reason a board's view bar
// is: which window you are looking at usually belongs to a URL or a stored view, and a chart that
// remembered it privately would quietly disagree with them. The windowing arithmetic is the
// library's (see ranges.ts); the storage is not.

import type { ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { SegmentedControl } from '../components/SegmentedControl.tsx'
import { cn } from '../lib/utils.ts'
import { ChartTooltip } from './ChartTooltip.tsx'
import { AXIS_TICK, CHART_AXIS, CHART_GRID, CHART_SURFACE, MARK, seriesColor } from './theme.ts'
import { windowPoints, type TimeRange } from './ranges.ts'

export interface TimeSeriesPoint {
  /** An ISO date (or any `Date.parse`-able string that sorts lexically). */
  date: string
  value: number
}

export function TimeSeriesChart({
  points,
  color = seriesColor(0),
  height = 300,
  formatValue = (v) => String(v),
  formatTick = (date) => date,
  formatTooltipDate = (date) => date,
  unit,
  header,
  caption,
  ranges,
  range,
  onRangeChange,
  className,
}: {
  /** In date order. A single point draws as a dot rather than an invisible line. */
  points: TimeSeriesPoint[]
  /** Defaults to the first categorical slot. A single series needs no legend - whatever titles the
   *  chart says what is plotted. */
  color?: string
  height?: number
  formatValue?: (value: number) => string
  /** X-axis ticks. Keep these SHORT: the axis drops ticks that would collide, so a long format
   *  buys fewer of them. */
  formatTick?: (date: string) => string
  formatTooltipDate?: (date: string) => string
  /** Appended after the value in the tooltip, e.g. `"stars"`. */
  unit?: string
  /** Anything above the plot on the left: a headline figure, a delta, a title. */
  header?: ReactNode
  /** A line under the plot - what the reader has to know to read it honestly. */
  caption?: ReactNode
  /** Offer a window selector. Pass the presets the data can fill (`rangesFor`). */
  ranges?: TimeRange[]
  range?: string
  onRangeChange?: (id: string) => void
  className?: string
}) {
  const active = ranges?.find((r) => r.id === range) ?? null
  // Not memoised on purpose: the formatters are props and usually inline arrows, so a memo keyed
  // on them would never hit, and one keyed on less would go stale.
  const data = windowPoints(points, active).map((p) => ({ ...p, label: formatTick(p.date) }))
  const single = data.length < 2

  return (
    <div className={cn('rounded-lg border border-border bg-surface p-5 shadow-(--shadow-sm)', className)}>
      {(header || (ranges && ranges.length > 1)) && (
        <div className='mb-4 flex flex-wrap items-end justify-between gap-3'>
          <div>{header}</div>
          {ranges && ranges.length > 1 && range && onRangeChange ? (
            <SegmentedControl
              value={range}
              options={ranges.map((r) => ({ value: r.id, label: r.label }))}
              onChange={onRangeChange}
            />
          ) : null}
        </div>
      )}

      <ResponsiveContainer width='100%' height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          {/* Hairline, solid, horizontal only: the grid carries the values no label states, and a
              dashed one would compete with a dashed series. */}
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis
            dataKey='label'
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: CHART_AXIS }}
            minTickGap={64}
          />
          <YAxis
            width={52}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatValue(Number(v))}
            domain={['auto', 'auto']}
          />
          <Tooltip
            cursor={{ stroke: CHART_AXIS }}
            content={({ active: on, payload }) => {
              if (!on || !payload?.length) return null
              const p = payload[0].payload as TimeSeriesPoint
              return (
                <ChartTooltip>
                  <div className='font-medium tabular-nums text-text'>
                    {formatValue(p.value)}
                    {unit ? ` ${unit}` : ''}
                  </div>
                  <div className='text-muted-foreground'>{formatTooltipDate(p.date)}</div>
                </ChartTooltip>
              )
            }}
          />
          <Area
            type='monotone'
            dataKey='value'
            stroke={color}
            strokeWidth={MARK.line}
            // A wash, never a saturated block: the line carries the value, the fill only says which
            // side of it the measure lives on.
            fill={color}
            fillOpacity={0.1}
            dot={single ? { r: MARK.dot, fill: color, stroke: CHART_SURFACE, strokeWidth: MARK.ring } : false}
            activeDot={{ r: MARK.dot, fill: color, stroke: CHART_SURFACE, strokeWidth: MARK.ring }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {caption ? <p className='pt-2 text-label text-muted-foreground'>{caption}</p> : null}
    </div>
  )
}
