// The app's one date field. Every calendar date in the dashboard goes through this, so the format
// rule - **dates are always `YYYY-MM-DD`, everywhere, typed or rendered** - holds in one place.
//
// WHY THIS IS NOT `<input type='date'>` ANY MORE (2026-08-11). It was, and it was wrong twice:
//
//   • **The format followed the browser, not us.** A native date input renders in the browser's
//     locale, so this dashboard showed `dd/mm/yyyy` while the value we store, the API we send and
//     every label in the app say `2026-08-11`. The documented fix - `lang='en-CA'` - is a Blink
//     behaviour that this Chrome simply does not honour; the field kept rendering `dd/mm/yyyy`
//     with the attribute set. There is no attribute that reliably pins it, so the only way to
//     guarantee the format is to own the field.
//   • **The picker could not be themed.** Chrome's calendar popup is a browser surface: it painted
//     white on the dark canvas, and no border, radius or colour of ours applies to it.
//     `color-scheme: dark` (now set in globals.css, and still worth having for the remaining native
//     controls) repaints it, but that is the ceiling - it can never take the app's styling.
//
// So the field is a plain text input that accepts and displays ISO, plus our own Popover calendar.
// The value contract is unchanged: `''` when unset, `yyyy-mm-dd` otherwise - the same shape the
// server takes, so no call site parses or formats anything.

import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from './Popover.tsx'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar date as `yyyy-mm-dd` - built from the local parts, never `toISOString()`, which
 *  would hand back the UTC day and read as "yesterday" for anyone west of UTC. */
export function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Today as a UTC calendar date - for the surfaces that store UTC buckets (signal points). */
export const todayUtc = (): string => new Date().toISOString().slice(0, 10)

let defaultToday: () => string = todayLocal

/** Set the clock a DateInput's "today" is read on when it is given none (the app sets the team's
 *  day). The browser's local day until then. */
export function setDefaultToday(today: () => string): void {
  defaultToday = today
}

/** `2026-08-11` -> {y, m, d} (m is 1-based), or null when it is not a well-formed ISO date. */
function parseIso(v: string): { y: number; m: number; d: number } | null {
  if (!ISO.test(v)) return null
  const [y, m, d] = v.split('-').map(Number)
  // Reject the impossible (2026-02-31): Date rolls it over silently, and a field that accepts a
  // date the server will refuse is worse than one that just does not light up.
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null
  return { y, m, d }
}

const iso = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** Monday-first, matching ISO-8601 - the same standard the date format itself comes from. */
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export function DateInput({
  value,
  onChange,
  ariaLabel,
  className,
  disabled,
  /** The day "today" means here, `YYYY-MM-DD`; the default clock (setDefaultToday) when absent. */
  today: todayProp,
  /** Card-scale: no "today" shortcut and no width floor, for a field living inside a task card. */
  compact = false,
  /** Full size without the "today" shortcut, for several dates side by side in a narrow row: the
   *  calendar stays, and the floor drops to the 140px the date and one icon need. */
  noToday = false,
  /** Table-cell scale: reads as the cell's text at rest (no outline) with the calendar always
   *  showing, and outlines on hover or focus, as InlineEdit does. No "today" shortcut. */
  inline = false,
  /** Classes for the input itself, e.g. a colour that flags an overdue date. */
  inputClassName,
}: {
  value: string
  onChange: (next: string) => void
  ariaLabel: string
  className?: string
  disabled?: boolean
  today?: string
  compact?: boolean
  noToday?: boolean
  inline?: boolean
  inputClassName?: string
}) {
  const today = todayProp ?? defaultToday()
  const [open, setOpen] = useState(false)

  // Typing is buffered locally so a half-finished date ("2026-08") is not committed on every
  // keystroke; only a complete, real ISO date reaches onChange. Re-syncs when the value changes
  // from outside (the Today button, a dialog reset).
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  const commit = (next: string) => {
    setText(next)
    if (next === '') onChange('')
    else if (parseIso(next)) onChange(next)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* FIXED WIDTH, not `w-full` (2026-09-13). The content is a fixed 10 characters plus two
          affordances, so there is nothing for extra width to do: stretching to the grid column just
          made the same field a different size on every form, and the eye reads that as misalignment
          rather than as flexibility. 168px is MEASURED, not guessed: at text-body-sm the placeholder
          `YYYY-MM-DD` needs 93px and a value `2026-09-13` 84px, on top of the 50px icon well
          (`pr-14`) and 10px of left pad - so the floor is ~154px and 168 leaves a little slack. The
          first attempt at 152 clipped the placeholder to `YYYY-MM-D`, and 160 fits by half a pixel,
          which is not a margin worth shipping. `shrink-0` because a flex parent would squeeze it below the
          text; `min-w` because Tailwind resolves min-w over w, so a call site's stale `w-36` cannot
          clip it. A call site that genuinely needs another width still wins via `className`, which
          sizes the whole group (input + calendar + today), never the bare input. */}
      <span
        className={cn(
          'inline-flex items-center gap-1',
          compact || inline ? 'w-full min-w-0' : noToday ? 'w-[140px] min-w-[140px] shrink-0' : 'w-[168px] min-w-[168px] shrink-0',
          className,
        )}>
        <span className='relative min-w-0 flex-1'>
          <input
            type='text'
            inputMode='numeric'
            // A column of empty dates reads as dashes, not a column of format hints.
            placeholder={inline ? '-' : 'YYYY-MM-DD'}
            maxLength={10}
            value={text}
            onChange={(e) => commit(e.target.value.trim())}
            // A field left mid-edit ("2026-08-1") would otherwise sit there looking committed;
            // snap it back to the last good value on blur.
            onBlur={() => setText(value)}
            aria-label={ariaLabel}
            disabled={disabled}
            className={cn(
              'w-full rounded-md border bg-bg text-text tabular-nums transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
              // The right padding is reserved for whichever affordances are mounted inside the
              // field: compact has the calendar alone, full size has "today" beside it.
              inline
                ? 'block h-7 py-0.5 pr-7 pl-1.5 text-body-sm'
                : compact
                  ? 'py-0.5 pr-6 pl-1.5 text-label'
                  : noToday
                    ? 'py-1.5 pr-8 pl-2.5 text-body-sm'
                    : 'py-1.5 pr-14 pl-2.5 text-body-sm',
              // A malformed entry is shown, not swallowed - but it is visibly not accepted.
              text !== '' && !parseIso(text)
                ? 'border-danger/60'
                : inline
                  ? 'border-transparent bg-transparent hover:border-border-light hover:bg-accent-tint focus:border-accent focus:bg-bg'
                  : 'border-border hover:border-accent/40 focus:border-accent',
              inputClassName,
            )}
          />
          {/* Both affordances sit INSIDE the field, right-aligned. "Today" used to be a sibling of
              the input, outside its border, which made a two-control group whose second half looked
              detached - it read as a stray button floating to the right of the field rather than as
              part of it, and it pushed the group wider than the box it was labelling. The field
              already has the room. */}
          <span className='absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5'>
            {!compact && !noToday && !inline && (
              <button
                type='button'
                onClick={() => onChange(today)}
                disabled={disabled || value === today}
                title={`Set to today (${today})`}
                aria-label='Set to today'
                className='rounded p-1 text-muted-foreground transition-colors hover:bg-accent-tint hover:text-accent disabled:pointer-events-none disabled:opacity-40'>
                <CalendarCheck className='size-3.5' />
              </button>
            )}
            <PopoverTrigger
              disabled={disabled}
              aria-label='Open calendar'
              title='Open calendar'
              className={cn(
                'rounded text-muted-foreground transition-colors outline-none hover:bg-accent-tint hover:text-accent focus-visible:text-accent disabled:pointer-events-none disabled:opacity-40',
                compact ? 'p-0.5' : 'p-1',
              )}>
              <CalendarDays className={compact ? 'size-3' : 'size-3.5'} />
            </PopoverTrigger>
          </span>
        </span>
      </span>
      <PopoverContent align='start' sideOffset={6} className='w-auto gap-0 rounded-lg border border-border p-3'>
        <Calendar
          value={parseIso(value) ? value : ''}
          today={today}
          onPick={(next) => {
            onChange(next)
            setText(next)
            setOpen(false)
          }}
          onClear={() => {
            onChange('')
            setText('')
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** The month grid. Pure presentation over ISO strings - it never constructs a Date for a value it
 *  will hand back, so there is no timezone in the picker at all. Exported because the dense grid
 *  cells pick a date straight from a popover calendar - there is no room there for the text field. */
export function Calendar({
  value,
  today,
  onPick,
  onClear,
}: {
  value: string
  today: string
  onPick: (next: string) => void
  onClear: () => void
}) {
  const anchor = parseIso(value) ?? parseIso(today)!
  const [view, setView] = useState({ y: anchor.y, m: anchor.m })
  // Re-centre on the selected month when the field is changed from outside while the popover lives.
  useEffect(() => {
    const a = parseIso(value)
    if (a) setView({ y: a.y, m: a.m })
  }, [value])

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m - 1, 1))
    const lead = (first.getUTCDay() + 6) % 7 // Monday-first
    const days = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate()
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(view.y, view.m, i + 1))] as (string | null)[]
  }, [view])

  const step = (by: number) => {
    const m0 = view.m - 1 + by
    setView({ y: view.y + Math.floor(m0 / 12), m: ((m0 % 12) + 12) % 12 + 1 })
  }

  return (
    <div className='w-[15.5rem]'>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <NavButton label='Previous month' onClick={() => step(-1)}>
          <ChevronLeft className='size-4' />
        </NavButton>
        <span className='text-body-sm font-medium text-text tabular-nums'>
          {MONTHS[view.m - 1]} {view.y}
        </span>
        <NavButton label='Next month' onClick={() => step(1)}>
          <ChevronRight className='size-4' />
        </NavButton>
      </div>

      <div className='grid grid-cols-7 gap-0.5'>
        {WEEKDAYS.map((w) => (
          <span key={w} className='py-1 text-center text-label text-muted-foreground'>
            {w}
          </span>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <span key={`pad-${i}`} />
          ) : (
            <button
              key={day}
              type='button'
              onClick={() => onPick(day)}
              title={day}
              aria-current={day === today ? 'date' : undefined}
              className={cn(
                'rounded-md py-1 text-center text-body-sm tabular-nums transition-colors outline-none',
                day === value
                  ? 'bg-accent text-accent-fg'
                  : day === today
                    ? 'text-accent ring-1 ring-accent/40 ring-inset hover:bg-accent-tint'
                    : 'text-text hover:bg-accent-tint',
              )}>
              {Number(day.slice(8))}
            </button>
          ),
        )}
      </div>

      <div className='mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5'>
        <button
          type='button'
          onClick={() => onPick(today)}
          className='rounded px-1.5 py-0.5 text-label text-muted-foreground transition-colors outline-none hover:bg-accent-tint hover:text-accent'>
          Today
        </button>
        <button
          type='button'
          onClick={onClear}
          className='rounded px-1.5 py-0.5 text-label text-muted-foreground transition-colors outline-none hover:bg-accent-tint hover:text-danger'>
          Clear
        </button>
      </div>
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
