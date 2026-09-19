// Two or more measures on ONE scale, over a shared x - plan against actual, this period against
// last, a target line under a reading.
//
// One scale is the hard part of the contract, and it is why there is no second y-axis prop here: a
// chart with two scales can be made to say anything, because the crossing point is chosen by
// whoever picked the two domains. Two measures of different magnitude are two charts, small
// multiples, or both indexed to a common base.
//
// Identity never rests on colour: a legend is drawn for every chart with two or more series, and a
// series can also carry a dash pattern, which is the encoding that survives a greyscale print and
// full-severity colour blindness alike.
//
// A null in a series is a HOLE, not a zero: `connectNulls` defaults off, so a line that stops at
// today stops, rather than running flat to the right edge and claiming nothing more will happen.

import type { ReactNode } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '../lib/utils.ts'
import { ChartLegend, ChartTooltip, ChartTooltipRow } from './ChartTooltip.tsx'
import { AXIS_TICK, CHART_AXIS, CHART_GRID, CHART_SURFACE, MARK, MAX_SERIES, seriesColor } from './theme.ts'

export interface ChartSeries {
  /** The key to read out of each row. */
  key: string
  /** What the legend and the tooltip call it. The app's word, never one composed here. */
  label: ReactNode
  /** Defaults to this series' slot, in order. Pass one to pin a colour to an entity so a filter
   *  that drops series does not repaint the survivors. */
  color?: string
  /** Second encoding, and the right default for a derived or reference line. */
  dashed?: boolean
  /** Draw a marker at every reading. Off past a few dozen points - a line of dots is a blob. */
  dots?: boolean
  /** Bridge a gap instead of leaving it. Only true where a missing reading really means "the same
   *  as the last one". */
  connectNulls?: boolean
}

export interface SeriesTooltipRow {
  series: ChartSeries
  color: string
  value: number | null
}

export function SeriesLineChart<Row extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 220,
  formatValue = (v) => String(v),
  formatX,
  renderTooltip,
  yDomain,
  reference,
  legend = true,
  caption,
  className,
}: {
  data: Row[]
  /** The key holding the already-formatted x label. Formatting the axis is the caller's, because a
   *  tick is as much about width as about the date behind it. */
  xKey: string
  /** In order. Past eight the palette stops; fold the tail or facet. */
  series: ChartSeries[]
  height?: number
  formatValue?: (value: number) => string
  /** The x value as the tooltip should say it, given the row. Defaults to the axis label. */
  formatX?: (row: Row) => ReactNode
  /** Replace the tooltip BODY. Take it when a row needs a sentence - "not yet", "planned", a unit
   *  that changes with the value - because that wording is the app's. */
  renderTooltip?: (row: Row, rows: SeriesTooltipRow[]) => ReactNode
  yDomain?: [unknown, unknown]
  /** A vertical rule - "today", a launch, a cutover. */
  reference?: { x: string | number; label?: string }
  /** Off only where the caller draws its own legend. Never off because there is no room. */
  legend?: boolean
  caption?: ReactNode
  className?: string
}) {
  // A series that brings its own colour does NOT consume a slot: a plan line drawn in the axis ink
  // would otherwise push the reading it is compared against off slot 1 and into orange, which is a
  // different chart every time somebody adds a reference line.
  let slot = 0
  const colored = series
    .slice(0, MAX_SERIES)
    .map((s) => ({ ...s, color: s.color ?? seriesColor(slot++) }))

  return (
    <div className={cn(className)}>
      {legend ? (
        <ChartLegend className='mb-1 px-2' entries={colored.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
      ) : null}
      <ResponsiveContainer width='100%' height={height}>
        <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_AXIS }} minTickGap={24} />
          <YAxis
            width={52}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatValue(Number(v))}
            domain={yDomain as never}
          />
          {reference ? (
            <ReferenceLine
              x={reference.x}
              stroke={CHART_AXIS}
              label={
                reference.label
                  ? { value: reference.label, position: 'insideTopRight', fill: 'var(--chart-ink)', fontSize: 10 }
                  : undefined
              }
            />
          ) : null}
          <Tooltip
            cursor={{ stroke: CHART_AXIS }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]?.payload as Row
              const rows: SeriesTooltipRow[] = colored.map((s) => ({
                series: s,
                color: s.color,
                value: typeof row[s.key] === 'number' ? (row[s.key] as number) : null,
              }))
              return (
                <ChartTooltip>
                  <div className='mb-0.5 text-muted-foreground'>{formatX ? formatX(row) : String(row[xKey])}</div>
                  {renderTooltip
                    ? renderTooltip(row, rows)
                    : rows.map((r, i) => (
                        <ChartTooltipRow
                          key={i}
                          color={r.color}
                          dashed={r.series.dashed}
                          label={r.series.label}
                          value={r.value === null ? '-' : formatValue(r.value)}
                        />
                      ))}
                </ChartTooltip>
              )
            }}
          />
          {colored.map((s) => (
            <Line
              key={s.key}
              type='linear'
              dataKey={s.key}
              name={typeof s.label === 'string' ? s.label : s.key}
              stroke={s.color}
              strokeWidth={MARK.line}
              strokeDasharray={s.dashed ? '4 3' : undefined}
              dot={s.dots ? { r: 2.5, fill: s.color } : false}
              activeDot={{ r: MARK.dot, fill: s.color, stroke: CHART_SURFACE, strokeWidth: MARK.ring }}
              connectNulls={s.connectNulls ?? false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {caption ? <p className='px-2 pt-1 text-label text-muted-foreground'>{caption}</p> : null}
    </div>
  )
}
