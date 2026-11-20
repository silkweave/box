import { useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Calendar, currentToday } from '../components/DateInput.tsx'
import { InlineEdit } from '../components/InlineEdit.tsx'
import { Input } from '../components/Input.tsx'
import { RelativeTime } from '../components/RelativeTime.tsx'
import { NavAnchor } from '../components/NavAnchor.tsx'
import { OPTION_SEARCH_THRESHOLD, OptionList } from '../components/OptionList.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/Select.tsx'
import { TokenPicker, lowercaseUniqueSorted } from '../components/TokenPicker.tsx'
import { cn } from '../lib/utils.ts'
import { CELL_BUTTON, CELL_ICON, CELL_TRIGGER } from './cellTrigger.ts'

/**
 * Grid cells that edit in place: every stored, settable value of a row changes from its cell, so
 * triage is a click on the list rather than a trip to the record. Each saves through `onChange` the
 * moment a value is picked; the caller writes optimistically and reports a failure (`notifyError`).
 *
 * - `TitleCell` in `name.render`: the title opens the record, a hover pencil renames it. Without a
 *   record to open (no `href`, no `onOpen`) a click on the title renames it. `summary` is the
 *   read-only second line (a description); only the title edits in a grid.
 * - `SelectCell` for a closed set (kind, stage, status), `iconOnly` for a leading icon column.
 * - `DateCell` for a day, with an optional tone (overdue, due today); `time` for a moment.
 * - `TextCell` for free text (a next action, an external id), `NumberCell` for a number shown with
 *   its unit at rest (money, a percentage) and edited bare.
 * - `TagsCell` for a free tag list.
 * - A person is the kit's `UserPicker` (`className='w-full'`).
 * - `CellEmpty` is the "nothing set" mark a read-only cell shows too.
 */

/** The "nothing set" mark of a cell: a quiet dot, never a dash or "None". */
export function CellEmpty({ title }: { title: string }) {
  return (
    <span title={title} className='text-label text-fg-4'>
      ·
    </span>
  )
}

/**
 * One value from a closed set. `T | null` in, `T | ''` out: `''` clears, so the empty option
 * round-trips. Omit `emptyLabel` for a value that cannot be cleared. Past `OPTION_SEARCH_THRESHOLD`
 * options it opens a searchable list (`OptionList`).
 */
export function SelectCell<T extends string>({
  value,
  options,
  labelOf,
  onChange,
  render,
  label,
  emptyLabel,
  iconOnly = false,
  title,
  disabled,
}: {
  value: T | null
  options: readonly T[]
  labelOf: (v: T) => string
  onChange: (v: T | '') => void
  /** How the current value reads in the cell (a chip, a meter, an icon). Defaults to its label. */
  render?: (v: T | null) => ReactNode
  /** The control's accessible name, e.g. "Kind". */
  label: string
  /** The clear option's label ("No kind"); omit when the value cannot be cleared. */
  emptyLabel?: string
  /** A 32px square showing only `render`, for a leading icon column. */
  iconOnly?: boolean
  /** The trigger's tooltip; an icon-only cell defaults to the value's label. */
  title?: string
  disabled?: boolean
}) {
  const items = [
    ...(emptyLabel === undefined ? [] : [{ value: '', label: emptyLabel }]),
    ...options.map((o) => ({ value: o as string, label: labelOf(o) })),
  ]
  const show = render ?? ((v: T | null) => (v ? <span className='truncate'>{labelOf(v)}</span> : <CellEmpty title={emptyLabel ?? `No ${label.toLowerCase()}`} />))
  const tip = title ?? (iconOnly && value ? labelOf(value) : undefined)
  if (options.length > OPTION_SEARCH_THRESHOLD)
    return (
      <SearchableSelectCell
        value={value}
        items={items}
        onChange={(v) => v !== (value ?? '') && onChange(v as T | '')}
        trigger={show(value)}
        label={label}
        title={tip}
        iconOnly={iconOnly}
        disabled={disabled}
      />
    )
  return (
    <Select
      value={value ?? ''}
      disabled={disabled}
      onValueChange={(next) => {
        const v = (next ?? '') as T | ''
        if (v !== (value ?? '')) onChange(v)
      }}
      items={items}>
      <SelectTrigger aria-label={label} title={tip} className={cn(CELL_TRIGGER, iconOnly && CELL_ICON)}>
        <SelectValue>{(v) => <span className={cn('flex min-w-0 flex-1', iconOnly && 'justify-center')}>{show((v as T) || null)}</span>}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            <span className={o.value ? '' : 'text-muted-foreground'}>{o.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** `SelectCell` past the threshold: the same resting cell, a popover with a searchable list. */
function SearchableSelectCell({
  value,
  items,
  onChange,
  trigger,
  label,
  title,
  iconOnly,
  disabled,
}: {
  value: string | null
  items: { value: string; label: string }[]
  onChange: (v: string) => void
  trigger: ReactNode
  label: string
  title?: string
  iconOnly: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger disabled={disabled} aria-label={label} title={title} className={cn(CELL_BUTTON, iconOnly && CELL_ICON)}>
        <span className={cn('flex min-w-0 flex-1', iconOnly && 'justify-center')}>{trigger}</span>
      </PopoverTrigger>
      <PopoverContent align='start' sideOffset={6} className='w-60 gap-1 p-1'>
        <OptionList
          items={items}
          value={value ?? ''}
          searchLabel={`Search ${label.toLowerCase()}`}
          onPick={(v) => {
            setOpen(false)
            onChange(v)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** A timestamp's local day and time (`YYYY-MM-DD`, `HH:MM`), or null for no or a broken value. */
function localParts(iso: string | null): { day: string; time: string } | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return { day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` }
}

/** A local day and `HH:MM` as an ISO timestamp; null when the time does not read. */
function toIso(day: string, time: string): string | null {
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const d = new Date(`${day}T${time.padStart(5, '0')}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * A day (`YYYY-MM-DD`), picked from a calendar on click; the calendar's Clear sends `''`. `tone`
 * colours the date: danger for overdue, warning for due today.
 *
 * With `time` the value is a moment (an ISO timestamp): the cell reads it relative ("in 2 hours"),
 * the popover adds a 24-hour time under the calendar, and `onChange` gets an ISO timestamp. A new
 * day keeps the set time (or `defaultTime`).
 */
export function DateCell({
  value,
  label,
  onChange,
  tone,
  title,
  disabled,
  time = false,
  defaultTime = '09:00',
}: {
  value: string | null
  /** The control's accessible name, e.g. "Due date". */
  label: string
  onChange: (v: string) => void
  tone?: 'danger' | 'warning' | null
  /** The trigger's tooltip; defaults to "<label>: <date>". */
  title?: string
  disabled?: boolean
  /** A moment rather than a day: ISO timestamps in and out, a time field in the popover. */
  time?: boolean
  /** With `time`: the time a first-picked day gets. */
  defaultTime?: string
}) {
  const [open, setOpen] = useState(false)
  const parts = time ? localParts(value) : null
  const day = time ? (parts?.day ?? null) : value ? value.slice(0, 10) : null
  const [clock, setClock] = useState(parts?.time ?? defaultTime)
  const toneCls = tone === 'danger' ? 'font-medium text-danger' : tone === 'warning' ? 'font-medium text-warning' : 'text-muted-foreground'
  const shown = parts ? `${parts.day} ${parts.time}` : day
  const emit = (nextDay: string, nextTime: string) => {
    if (!time) return nextDay !== (day ?? '') && onChange(nextDay)
    const iso = toIso(nextDay, nextTime)
    if (iso && iso !== (value ? new Date(value).toISOString() : null)) onChange(iso)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setClock(parts?.time ?? defaultTime)
      }}>
      <PopoverTrigger disabled={disabled} aria-label={label} title={title ?? (shown ? `${label}: ${shown}` : `Set the ${label.toLowerCase()}`)} className={CELL_BUTTON}>
        {day && time && value ? (
          <RelativeTime value={value} className={cn('text-label', toneCls)} />
        ) : day ? (
          <span className={cn('text-label tabular-nums', toneCls)}>{day}</span>
        ) : (
          <CellEmpty title={`No ${label.toLowerCase()}`} />
        )}
      </PopoverTrigger>
      <PopoverContent align='start' sideOffset={6} className='w-auto gap-0 rounded-lg border border-border p-3'>
        <Calendar
          value={day ?? ''}
          today={currentToday()}
          onPick={(next) => {
            setOpen(false)
            emit(next, clock)
          }}
          onClear={() => {
            setOpen(false)
            if (day) onChange('')
          }}
        />
        {time && (
          <label className='mt-2 flex items-center justify-between gap-2 border-t border-border-light pt-2 text-label text-muted-foreground'>
            Time
            <Input
              size='sm'
              className='w-20 tabular-nums'
              placeholder={defaultTime}
              value={clock}
              aria-label={`${label}, time (24-hour)`}
              onChange={(e) => setClock(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !day) return
                e.preventDefault()
                setOpen(false)
                emit(day, clock)
              }}
              onBlur={() => day && emit(day, clock)}
            />
          </label>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Free text of a row, edited in place (a next action, a loss reason, an external id). Saves on blur
 * or Enter when changed; return the write's promise from `onCommit` and a rejection puts the stored
 * text back. Reseeds from `value` after a reload. `disabled` (a reader) shows the text only.
 */
export function TextCell({
  value,
  label,
  onCommit,
  placeholder,
  disabled,
  mono = false,
}: {
  value: string | null
  /** The input's accessible name, e.g. "Next action for Acme". */
  label: string
  /** Called with the trimmed text when it changed. */
  onCommit: (value: string) => unknown
  placeholder?: string
  disabled?: boolean
  /** Monospace, for ids and keys. */
  mono?: boolean
}) {
  const current = value ?? ''
  if (disabled)
    return current ? <span className={cn('truncate px-1 text-body-sm text-text', mono && 'font-mono text-label')}>{current}</span> : <CellEmpty title={`No ${label.toLowerCase()}`} />
  return (
    <InlineEdit
      key={current}
      defaultValue={current}
      aria-label={label}
      placeholder={placeholder ?? '·'}
      className='min-w-0 flex-1'
      inputClassName={cn('h-6 px-1', mono && 'font-mono text-label')}
      onCommit={(v) => {
        const next = v.trim()
        if (next !== current) return onCommit(next)
      }}
    />
  )
}

/**
 * A number of a row: shown with its unit at rest (`format`, e.g. the kit's `Money` or a percentage),
 * a bare number input on click. Blank clears only with `clearable`; anything else that is not a
 * number of at least `min` is refused and the cell shows the stored value again. Return the write's
 * promise from `onCommit` so a rejection restores it. `disabled` (a reader) shows the value only.
 */
export function NumberCell({
  value,
  label,
  onCommit,
  format = (n) => n.toLocaleString(),
  min = 0,
  max,
  clearable = false,
  disabled,
  align = 'right',
}: {
  value: number | null
  /** The input's accessible name, e.g. "MRR of Acme". */
  label: string
  onCommit: (value: number | null) => unknown
  /** How the value reads at rest. */
  format?: (n: number) => ReactNode
  min?: number
  max?: number
  /** Blank clears (`null`); otherwise blank is refused. */
  clearable?: boolean
  disabled?: boolean
  align?: 'left' | 'right'
}) {
  const [editing, setEditing] = useState(false)
  const rest = value == null ? <CellEmpty title={`No ${label.toLowerCase()}`} /> : <span className='truncate tabular-nums'>{format(value)}</span>
  const alignCls = align === 'right' ? 'justify-end text-right' : ''
  if (disabled) return <span className={cn('flex w-full px-1 text-body-sm text-text', alignCls)}>{rest}</span>
  if (editing)
    return (
      <InlineEdit
        autoFocus
        type='number'
        min={min}
        max={max}
        defaultValue={value == null ? '' : String(value)}
        aria-label={label}
        className='w-full'
        inputClassName={cn('h-6 px-1 tabular-nums', align === 'right' && 'text-right')}
        onDone={() => setEditing(false)}
        onCommit={(v) => {
          const raw = v.trim()
          if (raw === '') return clearable && value != null ? onCommit(null) : undefined
          const n = Number(raw)
          if (!Number.isFinite(n) || n < min || (max !== undefined && n > max) || n === value) return
          return onCommit(n)
        }}
      />
    )
  return (
    <button type='button' aria-label={`Edit ${label}`} title={`Edit ${label}`} onClick={() => setEditing(true)} className={cn(CELL_BUTTON, 'text-body-sm text-text', alignCls)}>
      {rest}
    </button>
  )
}

/** Tags as small pills on one line, clipped at the cell's edge; past `max` a `+n`. The full list is the tooltip. */
export function TagChips({ tags, max = 3 }: { tags: readonly string[]; max?: number }) {
  if (tags.length === 0) return null
  const shown = tags.slice(0, max)
  const rest = tags.length - shown.length
  return (
    <span className='flex min-w-0 items-center gap-1 overflow-hidden' title={tags.join(', ')}>
      {shown.map((t) => (
        <span key={t} className='shrink-0 truncate rounded bg-[var(--bg-code)] px-1 text-[0.6875rem] leading-4 text-muted-foreground'>
          {t}
        </span>
      ))}
      {rest > 0 && (
        <span className='shrink-0 text-[0.6875rem] leading-4 text-fg-4'>
          +{rest}
        </span>
      )}
    </span>
  )
}

/** A free tag list: chips in the cell, a token picker in a popover. Tags are lowercase, unique and
 *  sorted unless `normalize` says otherwise. */
export function TagsCell({
  tags,
  suggestions,
  onChange,
  max = 3,
  normalize = lowercaseUniqueSorted,
  disabled,
}: {
  tags: string[]
  suggestions: string[]
  onChange: (tags: string[]) => void
  max?: number
  normalize?: (values: string[]) => string[]
  disabled?: boolean
}) {
  return (
    <Popover>
      <PopoverTrigger disabled={disabled} aria-label='Tags' title={tags.length ? tags.join(', ') : 'Add tags'} className={CELL_BUTTON}>
        {tags.length > 0 ? <TagChips tags={tags} max={max} /> : <CellEmpty title='No tags' />}
      </PopoverTrigger>
      <PopoverContent align='start' sideOffset={6} className='w-72 gap-2'>
        <span className='text-label text-muted-foreground'>Tags</span>
        <TokenPicker
          value={tags}
          options={suggestions}
          placeholder='add a tag…'
          emptyLabel='No tags yet.'
          normalize={normalize}
          onChange={(next) => next.join(',') !== tags.join(',') && onChange(next)}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The name cell of a row whose title can be renamed in place: the title opens the record (a real
 * link with `href`, so Cmd/Ctrl/middle click open a new tab), a hover pencil turns it into an input.
 * `summary` is the second line.
 */
export function TitleCell({
  value,
  summary,
  href,
  onOpen,
  onCommit,
  label,
  textClassName,
  inputClassName,
  openTitle = 'Open',
  trailing,
}: {
  value: string
  summary?: ReactNode
  href?: string
  /** Opens the record. Omit with `href` for a row with no record page: the title then renames. */
  onOpen?: () => void
  /** Called with the new title; the caller trims, compares and writes. */
  onCommit: (value: string) => void
  /** The input's accessible name, e.g. "Initiative title". */
  label: string
  textClassName?: string
  inputClassName?: string
  /** The title link's tooltip. */
  openTitle?: string
  /** After the title on its line: a count, a badge. */
  trailing?: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const second = summary != null && summary !== '' && <p className='truncate px-1 text-label text-muted-foreground'>{summary}</p>
  if (editing)
    return (
      // The input pads its text 8px; the title pads 4px, so it shifts left to keep the text in place.
      <div className='-ml-1 min-w-0 flex-1'>
        <InlineEdit defaultValue={value} aria-label={label} inputClassName={inputClassName} autoFocus onCommit={onCommit} onDone={() => setEditing(false)} />
        {second}
      </div>
    )
  return (
    <div className='group/title min-w-0 flex-1'>
      <div className='flex min-w-0 items-center gap-1'>
        {!href && !onOpen ? (
          <button
            type='button'
            onClick={() => setEditing(true)}
            title='Edit title'
            className={cn('min-w-0 truncate rounded px-1 py-0.5 text-left text-body-sm text-text outline-none hover:text-accent focus-visible:text-accent', textClassName)}>
            {value}
          </button>
        ) : (
        <NavAnchor
          href={href}
          onClick={onOpen}
          title={openTitle}
          draggable={false}
          className={cn(
            'min-w-0 truncate rounded px-1 py-0.5 text-left text-body-sm text-text underline-offset-2 outline-none hover:text-accent hover:underline focus-visible:text-accent focus-visible:underline',
            textClassName,
          )}>
          {value}
        </NavAnchor>
        )}
        <button
          type='button'
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label}`}
          title='Edit title'
          className='shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent-tint hover:text-accent focus-visible:opacity-100 group-hover/title:opacity-100'>
          <Pencil className='size-3.5' />
        </button>
        {trailing}
      </div>
      {second}
    </div>
  )
}
