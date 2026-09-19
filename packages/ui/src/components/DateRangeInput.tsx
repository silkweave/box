// A date RANGE as one control, for the places where two dates are one fact - a sprint's window is
// the case this was built for. Two `DateInput`s side by side said "here are two independent dates",
// which is exactly what a window is not: the end is only meaningful against the start, an end before
// its start is nonsense the pair could express, and picking a fortnight meant opening two calendars
// and doing the arithmetic yourself.
//
// So: ONE bordered field split into a from half and a to half, and ONE popover holding two months
// side by side, where the range is drawn across both as you pick it. Same value contract as
// `DateInput` - plain `yyyy-mm-dd` strings, `''` for unset, no Date ever handed back to a caller -
// and the same reason for being hand-rolled rather than native (see the note at the top of
// `DateInput.tsx`: a native picker follows the browser's locale and cannot be themed).

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from './Popover.tsx'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number): string => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** Monday-first, matching ISO-8601 - the same standard the date format itself comes from. */
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function parseIso(v: string): { y: number; m: number; d: number } | null {
  if (!ISO.test(v)) return null
  const [y, m, d] = v.split('-').map(Number)
  const probe = new Date(Date.UTC(y as number, (m as number) - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== (m as number) - 1 || probe.getUTCDate() !== d) return null
  return { y: y as number, m: m as number, d: d as number }
}

export interface DateRange {
  start: string
  end: string
}

/**
 * The whole range commits at once. A half-made range (a start with no end yet) never reaches the
 * caller: the sprint it was built for refuses to slot a task outside its window, so publishing an
 * intermediate `{ start, end: '' }` would briefly assert a window nobody chose.
 */
export function DateRangeInput({
  value,
  onChange,
  ariaLabel,
  className,
  disabled,
}: {
  value: DateRange
  onChange: (next: DateRange) => void
  /** Names the field as a whole; the two halves get "start"/"end" suffixes from it. */
  ariaLabel: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span
        role='group'
        aria-label={ariaLabel}
        className={cn(
          'inline-flex h-8 items-center rounded-md border border-border bg-bg transition-colors focus-within:border-accent hover:border-accent/40',
          disabled && 'cursor-not-allowed opacity-60',
          className,
        )}>
        <Half
          value={value.start}
          ariaLabel={`${ariaLabel} start`}
          disabled={disabled}
          onCommit={(next) => onChange({ ...value, start: next })}
        />
        <ArrowRight className='size-3 shrink-0 text-fg-4' aria-hidden />
        <Half
          value={value.end}
          ariaLabel={`${ariaLabel} end`}
          disabled={disabled}
          onCommit={(next) => onChange({ ...value, end: next })}
        />
        <PopoverTrigger
          disabled={disabled}
          aria-label={`Open ${ariaLabel} calendar`}
          title='Open calendar'
          className='mr-1 shrink-0 rounded p-1 text-muted-foreground transition-colors outline-none hover:bg-accent-tint hover:text-accent disabled:pointer-events-none'>
          <CalendarDays className='size-3.5' />
        </PopoverTrigger>
      </span>
      <PopoverContent align='start' sideOffset={6} className='w-auto gap-0 rounded-lg border border-border p-3'>
        <RangeCalendar
          value={value}
          onPick={(next) => {
            onChange(next)
            setOpen(false)
          }}
          onClear={() => {
            onChange({ start: '', end: '' })
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** One end of the range: a plain ISO text field, buffered exactly like `DateInput`'s. */
function Half({
  value,
  ariaLabel,
  disabled,
  onCommit,
}: {
  value: string
  ariaLabel: string
  disabled?: boolean
  onCommit: (next: string) => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  return (
    <input
      type='text'
      inputMode='numeric'
      placeholder='YYYY-MM-DD'
      maxLength={10}
      value={text}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        const next = e.target.value.trim()
        setText(next)
        if (next === '' || parseIso(next)) onCommit(next)
      }}
      // A field left mid-edit ("2026-08-1") would otherwise sit there looking committed.
      onBlur={() => setText(value)}
      className={cn(
        'w-[6.75rem] bg-transparent px-2 text-center text-body-sm tabular-nums text-text outline-none placeholder:text-fg-4',
        text !== '' && !parseIso(text) && 'text-danger',
      )}
    />
  )
}

/**
 * Two months, side by side, with the range painted across both.
 *
 * Picking is the two-click convention: the first click starts a NEW range (and blanks the old end,
 * so the grid stops showing a window you have already replaced), the second closes it. Clicking a
 * day before the pending start closes the range backwards rather than refusing - the intent is
 * unambiguous and making someone start over to express it is pedantry. Between the two clicks the
 * day under the cursor previews the range, which is the whole reason a range picker beats two
 * fields: you see the fortnight before you commit to it.
 */
function RangeCalendar({
  value,
  onPick,
  onClear,
}: {
  value: DateRange
  onPick: (next: DateRange) => void
  onClear: () => void
}) {
  const anchor = parseIso(value.start) ?? { y: new Date().getUTCFullYear(), m: new Date().getUTCMonth() + 1, d: 1 }
  const [view, setView] = useState({ y: anchor.y, m: anchor.m })
  /** The half-made range: a start with no end. Null whenever the committed value is what is shown. */
  const [pending, setPending] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  // Re-centre when the field changes underneath the open popover.
  useEffect(() => {
    const a = parseIso(value.start)
    if (a) setView({ y: a.y, m: a.m })
  }, [value.start])

  const step = (by: number): void => {
    const m0 = view.m - 1 + by
    setView({ y: view.y + Math.floor(m0 / 12), m: (((m0 % 12) + 12) % 12) + 1 })
  }

  // What the grid should PAINT: the pending range while one is being made, the committed one at rest.
  const [from, to] = pending
    ? [pending, hover && hover < pending ? hover : (hover ?? pending)].sort()
    : [value.start, value.end]

  const pick = (day: string): void => {
    if (!pending) {
      setPending(day)
      setHover(day)
      return
    }
    const [start, end] = [pending, day].sort()
    setPending(null)
    setHover(null)
    onPick({ start: start as string, end: end as string })
  }

  const next = { y: view.m === 12 ? view.y + 1 : view.y, m: view.m === 12 ? 1 : view.m + 1 }

  return (
    <div>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <NavButton label='Previous month' onClick={() => step(-1)}>
          <ChevronLeft className='size-4' />
        </NavButton>
        <span className='flex-1 text-center text-body-sm font-medium tabular-nums text-text'>
          {MONTHS[view.m - 1]} {view.y}
        </span>
        <span className='flex-1 text-center text-body-sm font-medium tabular-nums text-text'>
          {MONTHS[next.m - 1]} {next.y}
        </span>
        <NavButton label='Next month' onClick={() => step(1)}>
          <ChevronRight className='size-4' />
        </NavButton>
      </div>

      <div className='flex gap-3' onPointerLeave={() => pending && setHover(pending)}>
        <MonthGrid view={view} from={from ?? ''} to={to ?? ''} onPick={pick} onHover={setHover} />
        <MonthGrid view={next} from={from ?? ''} to={to ?? ''} onPick={pick} onHover={setHover} />
      </div>

      <div className='mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5'>
        <span className='px-1.5 text-label text-muted-foreground'>
          {pending ? 'Now pick the end' : 'Click a start, then an end'}
        </span>
        <button
          type='button'
          onClick={() => {
            setPending(null)
            setHover(null)
            onClear()
          }}
          className='rounded px-1.5 py-0.5 text-label text-muted-foreground transition-colors outline-none hover:bg-accent-tint hover:text-danger'>
          Clear
        </button>
      </div>
    </div>
  )
}

/** One month. Pure presentation over ISO strings - it never builds a Date it will hand back. */
function MonthGrid({
  view,
  from,
  to,
  onPick,
  onHover,
}: {
  view: { y: number; m: number }
  from: string
  to: string
  onPick: (day: string) => void
  onHover: (day: string) => void
}) {
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m - 1, 1))
    const lead = (first.getUTCDay() + 6) % 7 // Monday-first
    const days = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate()
    return [
      ...Array(lead).fill(null),
      ...Array.from({ length: days }, (_, i) => iso(view.y, view.m, i + 1)),
    ] as (string | null)[]
  }, [view])

  return (
    <div className='grid w-[15.5rem] grid-cols-7 gap-y-0.5'>
      {WEEKDAYS.map((w) => (
        <span key={w} className='py-1 text-center text-label text-muted-foreground'>
          {w}
        </span>
      ))}
      {cells.map((day, i) => {
        if (day === null) return <span key={`pad-${i}`} />
        const isFrom = day === from
        const isTo = day === to
        const inside = Boolean(from && to && day > from && day < to)
        return (
          <button
            key={day}
            type='button'
            onClick={() => onPick(day)}
            onPointerEnter={() => onHover(day)}
            title={day}
            className={cn(
              'py-1 text-center text-body-sm tabular-nums transition-colors outline-none',
              // The band is drawn with square edges in the middle and rounded ones at the ends, so
              // a fortnight reads as one continuous bar rather than fourteen separate chips.
              inside && 'bg-accent-tint text-text',
              isFrom && 'rounded-l-md bg-accent text-accent-fg',
              isTo && 'rounded-r-md bg-accent text-accent-fg',
              isFrom && isTo && 'rounded-md',
              !isFrom && !isTo && !inside && 'rounded-md text-text hover:bg-accent-tint',
            )}>
            {Number(day.slice(8))}
          </button>
        )
      })}
    </div>
  )
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      title={label}
      className='rounded-md p-1 text-muted-foreground transition-colors outline-none hover:bg-accent-tint hover:text-text focus-visible:text-text'>
      {children}
    </button>
  )
}
