import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { fullTime, relativeTime, toDate } from '../lib/time.ts'

// One ticking clock for every mounted RelativeTime: a page of 200 log rows sets one interval, not 200.
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  timer ??= setInterval(() => listeners.forEach((l) => l()), 30_000)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

function useMinuteClock(): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => subscribe(() => setNow(Date.now())), [])
  return now
}

/**
 * A point in time as a short distance ("5m ago", "in 2h", "just now"), with the full local date and
 * time as its title and `dateTime`. It refreshes itself every 30 seconds.
 *
 * Use it for: when something happened or will happen, in a row, a fact or a header (last run, next
 * fire, created, last used).
 * Not for: a date that matters as a date (a due date, a period: write `YYYY-MM-DD`), a duration.
 * Props: `value` is an ISO or "YYYY-MM-DD HH:MM:SS" string, epoch ms or a `Date`; `now` pins the
 * clock (stories, tests); `className` for colour and size, it inherits both by default.
 * Rules: the text is `tabular-nums` so columns of times line up. An unparseable value prints as
 * given. Nothing (`null`/`undefined`) renders `fallback`, by default "Never".
 */
export function RelativeTime({
  value,
  now,
  fallback = 'Never',
  className,
}: {
  value: string | number | Date | null | undefined
  now?: number
  fallback?: React.ReactNode
  className?: string
}) {
  const clock = useMinuteClock()
  if (value == null || value === '') return <span className={className}>{fallback}</span>
  const d = toDate(value)
  const valid = !Number.isNaN(d.getTime())
  return (
    <time
      dateTime={valid ? d.toISOString() : undefined}
      title={valid ? fullTime(d) : undefined}
      className={cn('whitespace-nowrap tabular-nums', className)}>
      {valid ? relativeTime(d, now ?? clock) : String(value)}
    </time>
  )
}
