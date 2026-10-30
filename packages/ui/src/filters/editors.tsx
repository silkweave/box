// The six field editors, one per field type, each `{ field, value, onChange }`. They commit as you
// go - there is no Apply button anywhere in the filter UI, because the board behind the popover IS
// the preview - except text, which waits 200ms so a word is not a dozen board repaints.
//
// `onChange(null)` means "no filter on this field". Every editor reads its value loosely (through
// `normalizeFilter`), so a stored value of an older shape simply shows as unset.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Search, UserCircle2, X } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Avatar } from '../components/Avatar.tsx'
import { DateInput, currentToday } from '../components/DateInput.tsx'
import { SegmentedControl } from '../components/SegmentedControl.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/Select.tsx'
import { useUsers } from '../users/directory.tsx'
import { DATE_WINDOW_HINT, DATE_WINDOW_LABEL, normalizeFilter } from './match.ts'
import {
  PERSON_ME,
  PERSON_NONE,
  type BooleanField,
  type DateField,
  type DateFilterValue,
  type FilterField,
  type FilterOption,
  type FilterValue,
  type NumberField,
  type NumberFilterValue,
  type NumberOp,
  type OptionsField,
  type PersonField,
  type TextField,
} from './types.ts'

/** What every editor takes. `today` is the date editor's clock (the default clock when absent). */
export interface FilterEditorProps<F extends FilterField> {
  field: F
  value: unknown
  onChange: (next: FilterValue | null) => void
  today?: string
}

/** A list past this many entries gets a search box. */
const SEARCH_FROM = 8

// ---- shared rows --------------------------------------------------------------------------------

/** One choice in an editor's list: the check, then the label. The same row as the columns popover's. */
function ChoiceRow({
  on,
  onClick,
  role,
  children,
  hint,
}: {
  on: boolean
  onClick: () => void
  role?: 'radio'
  children: ReactNode
  hint?: string
}) {
  return (
    <button
      type='button'
      role={role}
      aria-checked={role ? on : undefined}
      aria-pressed={role ? undefined : on}
      onClick={onClick}
      title={hint}
      className='flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left text-body-sm text-text transition-colors hover:bg-accent-tint'>
      <Check className={cn('size-3.5 shrink-0', on ? 'text-accent' : 'opacity-0')} />
      <span className='flex min-w-0 flex-1 items-center gap-1.5 truncate'>{children}</span>
    </button>
  )
}

/** The small search field over a long list. */
function ListSearch({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className='relative mb-1'>
      <Search className='pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground' />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='Search...'
        aria-label={label}
        className='h-7 w-full rounded-md border border-border bg-bg pr-2 pl-7 text-body-sm text-text transition-colors outline-none placeholder:text-fg-4 hover:border-accent/40 focus:border-accent'
      />
    </div>
  )
}

const toggleIn = (list: readonly string[], v: string): string[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
const listOrNull = (list: string[]): string[] | null => (list.length > 0 ? list : null)
const matchesQuery = (q: string) => (o: FilterOption) => !q || o.label.toLowerCase().includes(q.trim().toLowerCase())

// ---- options ------------------------------------------------------------------------------------

/** Any of the field's values: a checklist, with a search box once the list is long. */
export function OptionsFilter({ field, value, onChange }: FilterEditorProps<OptionsField>) {
  const on = normalizeFilter('options', value) ?? []
  const [q, setQ] = useState('')
  const shown = field.options.filter(matchesQuery(q))
  return (
    <div className='flex flex-col'>
      {field.options.length > SEARCH_FROM && <ListSearch value={q} onChange={setQ} label={`Search ${field.title}`} />}
      {shown.map((o) => (
        <ChoiceRow key={o.value} on={on.includes(o.value)} onClick={() => onChange(listOrNull(toggleIn(on, o.value)))}>
          <span className='truncate'>{o.label}</span>
        </ChoiceRow>
      ))}
      {shown.length === 0 && <span className='px-1.5 py-1 text-label text-muted-foreground'>Nothing matches.</span>}
    </div>
  )
}

// ---- person -------------------------------------------------------------------------------------

/** Any of these people: Me and Nobody first (each optional), then everyone on offer, with avatars
 *  when the app provides a user directory. */
export function PersonFilter({ field, value, onChange }: FilterEditorProps<PersonField>) {
  const on = normalizeFilter('person', value) ?? []
  const users = useUsers()
  const [q, setQ] = useState('')
  const toggle = (v: string): void => onChange(listOrNull(toggleIn(on, v)))
  const shown = field.options.filter(matchesQuery(q))
  const meLabel = field.meLabel === false ? null : (field.meLabel ?? 'Me')
  const noneLabel = field.noneLabel === false ? null : (field.noneLabel ?? 'Nobody')
  return (
    <div className='flex flex-col'>
      {field.options.length > SEARCH_FROM && <ListSearch value={q} onChange={setQ} label={`Search ${field.title}`} />}
      {!q && meLabel && (
        <ChoiceRow on={on.includes(PERSON_ME)} onClick={() => toggle(PERSON_ME)} hint='Whoever is looking'>
          <UserCircle2 className='size-4 shrink-0 text-accent' />
          <span className='truncate'>{meLabel}</span>
        </ChoiceRow>
      )}
      {!q && noneLabel && (
        <ChoiceRow on={on.includes(PERSON_NONE)} onClick={() => toggle(PERSON_NONE)}>
          <UserCircle2 className='size-4 shrink-0 text-muted-foreground' />
          <span className='truncate text-muted-foreground'>{noneLabel}</span>
        </ChoiceRow>
      )}
      {!q && (meLabel || noneLabel) && shown.length > 0 && <span className='my-1 border-t border-border' />}
      {shown.map((o) => {
        const user = users?.find((u) => u.id === o.value)
        return (
          <ChoiceRow key={o.value} on={on.includes(o.value)} onClick={() => toggle(o.value)}>
            {user ? <Avatar user={user} size='xs' /> : <UserCircle2 className='size-4 shrink-0 text-muted-foreground' />}
            <span className='truncate'>{o.label}</span>
          </ChoiceRow>
        )
      })}
      {q && shown.length === 0 && <span className='px-1.5 py-1 text-label text-muted-foreground'>Nobody matches.</span>}
    </div>
  )
}

// ---- date ---------------------------------------------------------------------------------------

/** One relative window, or a range with either end open, or "no date". Picking one replaces the
 *  others: a date filter is one question. */
export function DateFilter({ field, value, onChange, today }: FilterEditorProps<DateField>) {
  const v = normalizeFilter('date', value)
  const day = today ?? currentToday()
  const range = v && !('window' in v) && !('none' in v) ? v : null
  const setRange = (next: { from?: string; to?: string }): void => {
    const from = next.from || undefined
    const to = next.to || undefined
    onChange(from || to ? ({ ...(from ? { from } : {}), ...(to ? { to } : {}) } as DateFilterValue) : null)
  }
  const noneLabel = field.noneLabel === false ? null : (field.noneLabel ?? 'No date')
  return (
    <div className='flex flex-col'>
      <div role='radiogroup' aria-label={`${field.title}: window`} className='flex flex-col'>
        {field.windows.map((w) => {
          const on = !!v && 'window' in v && v.window === w
          return (
            <ChoiceRow key={w} role='radio' on={on} onClick={() => onChange(on ? null : { window: w })} hint={DATE_WINDOW_HINT[w]}>
              <span className='truncate'>{DATE_WINDOW_LABEL[w]}</span>
            </ChoiceRow>
          )
        })}
      </div>
      <div className='mt-1.5 flex flex-col gap-1.5 border-t border-border px-1.5 pt-2'>
        <span className='text-label text-muted-foreground'>Between</span>
        <label className='flex items-center gap-2'>
          <span className='w-9 shrink-0 text-label text-muted-foreground'>From</span>
          <DateInput noToday today={day} ariaLabel={`${field.title} from`} value={range?.from ?? ''} onChange={(from) => setRange({ ...range, from })} />
        </label>
        <label className='flex items-center gap-2'>
          <span className='w-9 shrink-0 text-label text-muted-foreground'>To</span>
          <DateInput noToday today={day} ariaLabel={`${field.title} to`} value={range?.to ?? ''} onChange={(to) => setRange({ ...range, to })} />
        </label>
        <span className='text-label text-fg-4'>Leave either end empty for an open range.</span>
      </div>
      {noneLabel && (
        <div className='mt-1.5 border-t border-border pt-1.5'>
          <ChoiceRow on={!!v && 'none' in v} onClick={() => onChange(v && 'none' in v ? null : { none: true })}>
            <span className='truncate'>{noneLabel}</span>
          </ChoiceRow>
        </div>
      )}
    </div>
  )
}

// ---- number -------------------------------------------------------------------------------------

type AnyNumberOp = NumberOp | 'between' | 'empty' | 'set'

const NUMBER_OPS: { value: AnyNumberOp; label: string }[] = [
  { value: 'eq', label: 'Equals' },
  { value: 'ne', label: 'Is not' },
  { value: 'gt', label: 'More than' },
  { value: 'gte', label: 'At least' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'At most' },
  { value: 'between', label: 'Between' },
  { value: 'set', label: 'Has a value' },
  { value: 'empty', label: 'Is empty' },
]

/** The value a draft means, or null while it is unfinished. */
function numberValue(op: AnyNumberOp, a: string, b: string): NumberFilterValue | null {
  if (op === 'empty' || op === 'set') return { op }
  const x = a.trim() === '' ? NaN : Number(a)
  if (!Number.isFinite(x)) return null
  if (op !== 'between') return { op, value: x }
  const y = b.trim() === '' ? NaN : Number(b)
  return Number.isFinite(y) ? { op, value: Math.min(x, y), to: Math.max(x, y) } : null
}

const sameNumber = (a: NumberFilterValue | null, b: NumberFilterValue | null): boolean => JSON.stringify(a) === JSON.stringify(b)

/** A comparison and its number(s). A half-typed draft commits as "no filter" and stays on screen. */
export function NumberFilter({ field, value, onChange }: FilterEditorProps<NumberField>) {
  const v = normalizeFilter('number', value)
  const draftOf = (x: NumberFilterValue | null) => ({
    op: (x?.op ?? 'gt') as AnyNumberOp,
    a: x && 'value' in x ? String(x.value) : '',
    b: x && x.op === 'between' ? String(x.to) : '',
  })
  const [draft, setDraft] = useState(() => draftOf(v))
  // What this editor last wrote: a value coming back that equals it is our own echo, not an outside
  // change, and must not wipe a draft the user is still typing.
  const last = useRef<NumberFilterValue | null>(v)
  useEffect(() => {
    if (!sameNumber(v, last.current)) {
      last.current = v
      setDraft(draftOf(v))
    }
  })

  const commit = (next: typeof draft): void => {
    setDraft(next)
    const out = numberValue(next.op, next.a, next.b)
    last.current = out
    onChange(out)
  }
  const needsValue = draft.op !== 'empty' && draft.op !== 'set'
  const input = (key: 'a' | 'b', label: string) => (
    <span className='inline-flex items-center gap-1'>
      {field.prefix && <span className='text-label text-muted-foreground'>{field.prefix}</span>}
      <input
        type='number'
        inputMode='decimal'
        step={field.step}
        value={draft[key]}
        onChange={(e) => commit({ ...draft, [key]: e.target.value })}
        aria-label={label}
        className='h-7 w-20 rounded-md border border-border bg-bg px-2 text-body-sm text-text tabular-nums transition-colors outline-none hover:border-accent/40 focus:border-accent'
      />
      {field.unit && <span className='text-label text-muted-foreground'>{field.unit}</span>}
    </span>
  )
  return (
    <div className='flex flex-col gap-2 px-1.5 py-1'>
      <Select value={draft.op} onValueChange={(op) => op != null && commit({ ...draft, op: op as AnyNumberOp })} items={NUMBER_OPS}>
        <SelectTrigger aria-label={`${field.title}: comparison`} className='h-7 w-full'>
          <SelectValue>{(val) => NUMBER_OPS.find((o) => o.value === val)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {NUMBER_OPS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needsValue && (
        <div className='flex flex-wrap items-center gap-1.5'>
          {input('a', draft.op === 'between' ? `${field.title} from` : field.title)}
          {draft.op === 'between' && (
            <>
              <span className='text-label text-muted-foreground'>and</span>
              {input('b', `${field.title} to`)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---- text ---------------------------------------------------------------------------------------

/** Text anywhere in the field, any case. Commits 200ms after the last keystroke. */
export function TextFilter({ field, value, onChange }: FilterEditorProps<TextField>) {
  const v = normalizeFilter('text', value) ?? ''
  const [text, setText] = useState(v)
  // The value this editor last committed ('' for none). Compared on both sides so our own echo never
  // resets the field, and a field holding only spaces (which commits as none) never commits again.
  const committed = useRef(v)
  useEffect(() => {
    if (v !== committed.current) {
      committed.current = v
      setText(v)
    }
  }, [v])
  useEffect(() => {
    const out = text.trim() ? text : ''
    if (out === committed.current) return
    const t = setTimeout(() => {
      committed.current = out
      onChange(out || null)
    }, 200)
    return () => clearTimeout(t)
  }, [text, onChange])
  return (
    <div className='relative px-1.5 py-1'>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && text && (e.preventDefault(), setText(''))}
        placeholder={field.placeholder ?? 'Contains...'}
        aria-label={field.title}
        className='h-7 w-full rounded-md border border-border bg-bg pr-7 pl-2 text-body-sm text-text transition-colors outline-none placeholder:text-fg-4 hover:border-accent/40 focus:border-accent'
      />
      {text && (
        <button
          type='button'
          onClick={() => setText('')}
          aria-label={`Clear ${field.title}`}
          className='absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-text'>
          <X className='size-3' />
        </button>
      )}
    </div>
  )
}

// ---- boolean ------------------------------------------------------------------------------------

/** Any, on or off, with the field's own words for the two states. */
export function BooleanFilter({ field, value, onChange }: FilterEditorProps<BooleanField>) {
  const v = normalizeFilter('boolean', value)
  return (
    <div className='px-1.5 py-1'>
      <SegmentedControl
        value={v === null ? 'any' : v ? 'on' : 'off'}
        options={[
          { value: 'any', label: 'Any' },
          { value: 'on', label: field.onLabel ?? 'On' },
          { value: 'off', label: field.offLabel ?? 'Off' },
        ]}
        onChange={(next) => onChange(next === 'any' ? null : next === 'on')}
      />
    </div>
  )
}

// ---- any ----------------------------------------------------------------------------------------

/** The editor for a field of any type. */
export function FilterEditor({ field, value, onChange, today }: FilterEditorProps<FilterField>) {
  switch (field.type) {
    case 'options':
      return <OptionsFilter field={field} value={value} onChange={onChange} />
    case 'person':
      return <PersonFilter field={field} value={value} onChange={onChange} />
    case 'date':
      return <DateFilter field={field} value={value} onChange={onChange} today={today} />
    case 'number':
      return <NumberFilter field={field} value={value} onChange={onChange} />
    case 'text':
      return <TextFilter field={field} value={value} onChange={onChange} />
    case 'boolean':
      return <BooleanFilter field={field} value={value} onChange={onChange} />
  }
}
