import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, StickyNote, Trash2 } from 'lucide-react'
import type { SignalPointRow, SignalPointsPayload, Signal } from '../../types.ts'
import { fetchSignalPoints, removeSignalPoint, saveSignalPoint, saveSignalPoints } from '../lib/useSignalsData.ts'
import { formatBucket, formatNumber } from '../../lib/format.ts'
import {
  ActionMenu,
  Badge,
  Button,
  DateInput,
  Field,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RelativeTime,
  SettingsGroup,
  SettingsHeaderActions,
  SettingsNotice,
  Textarea,
  UserChip,
  confirm,
  usePersonName,
  todayUtc,
} from '@silkweave/box-ui'
import { DataGrid } from '@silkweave/box-ui/list'
import { PAST_WINDOWS } from '@silkweave/box-ui/filters'
import { errorMessage } from '@silkweave/box-ui/lib'
import { canAccessArea, useAccess } from '@/lib/access'

/** Runs one write at a time; `busy` is true while one is in flight and every write control waits. */
type Run = (op: () => Promise<SignalPointsPayload>) => Promise<void>

/**
 * The manual-points surface on a signal detail page: a grid of the signal's manual
 * points (bucket, value, note, who, when) with add, edit and delete in place, plus a bulk paste
 * box - one `date[, time], value[, note]` line per row, previewed before commit, committed via the
 * bulk tool so twelve monthly points are one paste.
 *
 * A manual point a live value currently overrides renders as SHADOWED, not hidden - it resurfaces
 * if the live source retreats (the read-side merge, see docs/WAREHOUSE.md). Timestamps are UTC
 * throughout, matching the warehouse convention; buckets are floored server-side to the signal's
 * interval.
 */
export function SignalPointsEditor({ signal }: { signal: Signal }) {
  useAccess() // re-render when access changes
  // Points take write on the signal's owning area; a reader sees the list without its controls.
  const canWrite = canAccessArea(signal.area, 'write')
  const [data, setData] = useState<SignalPointsPayload | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    fetchSignalPoints(signal.id)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e)
      })
    return () => {
      cancelled = true
    }
  }, [signal.id, reload])

  /** Runs a write and shows its result. A failure propagates: the editing row or the paste box
   *  reports it where the person is looking. */
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const run: Run = useCallback(async (op) => {
    // Writes are serialized: a late answer to an earlier write could otherwise replace a newer list.
    if (busyRef.current) throw new Error('Another change to these points is still saving.')
    busyRef.current = true
    setBusy(true)
    try {
      setData(await op())
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  return (
    <>
      {signal.data_source_id && (
        <SettingsNotice title='Live buckets come from the data source'>
          Its sync owns them, so correcting one here shadows that value rather than replacing it.
        </SettingsNotice>
      )}
      {!canWrite && <SettingsNotice title='Your role can read this signal but not change its points.' />}
      <PointsList signal={signal} data={data} error={error && !data ? error : undefined} onRetry={() => setReload((n) => n + 1)} run={run} busy={busy} canWrite={canWrite} />
      {canWrite && data && <BulkPasteBox signal={signal} run={run} busy={busy} />}
    </>
  )
}

// --- the list + inline add/edit -------------------------------------------------------------------

/** The create row's id: the grid draws a row that does not exist yet under it. */
const ADD_ID = '__add__'

function PointsList({ signal, data, error, onRetry, run, busy, canWrite }: {
  signal: Signal
  data: SignalPointsPayload | null
  error: unknown
  onRetry: () => void
  run: Run
  busy: boolean
  canWrite: boolean
}) {
  const hourly = data?.interval === 'hour'
  const personName = usePersonName()
  const [editing, setEditing] = useState<string | null>(null) // bucket being edited
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [removeError, setRemoveError] = useState<string | null>(null)

  // The add row.
  const [adding, setAdding] = useState(false)
  const [addDate, setAddDate] = useState('')
  const [addTime, setAddTime] = useState('')
  const [addValue, setAddValue] = useState('')
  const [addNote, setAddNote] = useState('')

  const rows = useMemo(() => [...(data?.points ?? [])].sort((a, b) => b.bucket.localeCompare(a.bucket)), [data?.points])
  const draft: SignalPointRow = { bucket: ADD_ID, value: 0, note: null, shadowed_by: null, updated_at: '', created_by: null, updated_by: null }
  const bucketLabel = (p: SignalPointRow): string => (hourly ? formatBucket(p.bucket) : p.bucket.slice(0, 10))

  const startEdit = (p: SignalPointRow) => {
    setEditing(p.bucket)
    setValue(String(p.value))
    setNote(p.note ?? '')
    setAdding(false)
  }
  const validNumber = (raw: string) => raw.trim() !== '' && !Number.isNaN(Number(raw))
  const saveEdit = async (bucket: string) => {
    await run(() => saveSignalPoint(signal.id, bucket, Number(value), note))
    // Close only the row this save was for.
    setEditing((cur) => (cur === bucket ? null : cur))
  }
  const resetAdd = () => {
    setAdding(false)
    setAddDate('')
    setAddTime('')
    setAddValue('')
    setAddNote('')
  }
  const add = async () => {
    const at = hourly && addTime ? `${addDate}T${addTime}:00Z` : addDate
    await run(() => saveSignalPoint(signal.id, at, Number(addValue), addNote || undefined))
    resetAdd()
  }
  const remove = async (p: SignalPointRow) => {
    const ok = await confirm({
      title: `Delete the point for ${hourly ? formatBucket(p.bucket) : p.bucket.slice(0, 10)}?`,
      message: 'Only this manual point is removed. A live value for the same bucket stays.',
      confirmLabel: 'Delete point',
      danger: true,
    })
    if (!ok) return
    setRemoveError(null)
    try {
      await run(() => removeSignalPoint(signal.id, p.bucket))
    } catch (err) {
      setRemoveError(errorMessage(err))
    }
  }

  return (
    <>
      {canWrite && (
        <SettingsHeaderActions>
          <Button
            size='sm'
            disabled={adding || busy}
            onClick={() => {
              setEditing(null)
              setAdding(true)
            }}>
            <Plus /> Add point
          </Button>
        </SettingsHeaderActions>
      )}
      <DataGrid<SignalPointRow>
        variant='section'
        title='Manual points'
        rows={rows}
        muted={(p) => p.shadowed_by != null}
        getId={(p) => p.bucket}
        loading={!data && error == null}
        error={error}
        onRetry={onRetry}
        empty={canWrite ? 'No manual points yet. Add the first with Add point, or paste a batch.' : 'No manual points yet.'}
        bar={{ noun: 'points', fields: [{ key: 'when', title: 'Bucket', type: 'date', windows: PAST_WINDOWS, noneLabel: false }] }}
        searchText={(p) => `${bucketLabel(p)} ${p.value} ${p.note ?? ''} ${personName(p.updated_by ?? p.created_by)}`}
        filterValue={(p, key) => (key === 'when' ? p.bucket.slice(0, 10) : null)}
        rowLabel={bucketLabel}
        // The row starts editing; a write in flight holds every other write.
        onOpen={canWrite && !busy ? startEdit : undefined}
        openLabel={(p) => `Edit the point for ${bucketLabel(p)}`}
        editing={
          canWrite
            ? adding
              ? { id: ADD_ID, row: draft, saveLabel: 'Add point', canSave: !!addDate && validNumber(addValue) && !busy, onCancel: resetAdd, onSave: add }
              : editing === null
                ? undefined
                : { id: editing, canSave: validNumber(value) && !busy, onCancel: () => setEditing(null), onSave: () => saveEdit(editing) }
            : undefined
        }
        name={{
          label: 'Bucket (UTC)',
          render: (p) => <span className='text-body-sm tabular-nums text-muted-foreground'>{bucketLabel(p)}</span>,
          edit: (p) =>
            p.bucket === ADD_ID ? (
              <div className='flex items-center gap-1.5'>
                <DateInput value={addDate} onChange={setAddDate} ariaLabel='Point date (UTC)' today={todayUtc()} />
                {hourly && <Input type='time' size='sm' value={addTime} onChange={(e) => setAddTime(e.target.value)} aria-label='Point time (UTC)' className='w-24' />}
              </div>
            ) : (
              <span className='text-body-sm tabular-nums text-muted-foreground'>{bucketLabel(p)}</span>
            ),
        }}
        columns={[
          {
            key: 'value',
            label: 'Value',
            width: 128,
            render: (p) => (
              <span className='flex w-full items-center justify-end gap-2 text-right text-body-sm tabular-nums text-text'>
                {p.shadowed_by != null && (
                  <Badge
                    size='sm'
                    title={`A live value of ${formatNumber(p.shadowed_by)} currently wins this bucket; this manual point resurfaces if the live source retreats.`}>
                    Shadowed
                  </Badge>
                )}
                {formatNumber(p.value)}
              </span>
            ),
            edit: (p) =>
              p.bucket === ADD_ID ? (
                <Input type='number' step='any' size='sm' placeholder='Value' value={addValue} onChange={(e) => setAddValue(e.target.value)} aria-label='Point value' className='text-right' />
              ) : (
                <Input type='number' step='any' size='sm' value={value} onChange={(e) => setValue(e.target.value)} aria-label='Point value' className='text-right' />
              ),
          },
          {
            key: 'note',
            label: 'Note',
            width: 192,
            render: (p) => <NoteCell note={p.note} />,
            edit: (p) =>
              p.bucket === ADD_ID ? (
                <Input size='sm' placeholder='Note' value={addNote} onChange={(e) => setAddNote(e.target.value)} aria-label='Point note' />
              ) : (
                <Input size='sm' value={note} onChange={(e) => setNote(e.target.value)} placeholder='Note' aria-label='Point note' />
              ),
          },
          { key: 'by', label: 'By', width: 144, priority: 3, render: (p) => (p.bucket === ADD_ID ? null : <UserChip userId={p.updated_by ?? p.created_by} showName />) },
          { key: 'updated', label: 'Updated', width: 96, priority: 2, render: (p) => (p.bucket === ADD_ID ? null : <RelativeTime value={p.updated_at} className='text-body-sm text-muted-foreground' />) },
        ]}
        rowActions={canWrite ? (p) => <ActionMenu size='sm' label={`Actions for the point ${bucketLabel(p)}`} items={[{ label: 'Delete point', icon: <Trash2 />, danger: true, disabled: busy, onSelect: () => void remove(p) }]} /> : undefined}
      />
      {removeError && (
        <SettingsNotice tone='danger' title='The point was not deleted'>
          {removeError}
        </SettingsNotice>
      )}
    </>
  )
}

/**
 * A point's note as an icon that reveals the text on hover (or click/focus, which is what keeps it
 * reachable by keyboard and on touch). A sentence like a long import note would wrap the row onto
 * three lines; nothing is truncated: the full note is in the popover.
 */
function NoteCell({ note }: { note: string | null }) {
  if (!note) return <span className='text-fg-4'>-</span>
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={120}
        aria-label='Show note'
        title={note}
        className='inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent-tint hover:text-text focus-visible:text-text'>
        <StickyNote className='size-3.5' />
      </PopoverTrigger>
      <PopoverContent side='top' className='w-64 gap-0 p-3 text-body-sm leading-relaxed'>
        {note}
      </PopoverContent>
    </Popover>
  )
}

// --- bulk paste -----------------------------------------------------------------------------------

interface ParsedLine {
  line: number
  raw: string
  at?: string
  value?: number
  note?: string
  error?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/

/** Parse one pasted line: `date[, time], value[, note]` (comma- or tab-separated). */
function parseLine(raw: string, line: number): ParsedLine | null {
  const text = raw.trim()
  if (!text) return null
  const parts = text.split(/[,\t]/).map((s) => s.trim())
  if (parts.length < 2) return { line, raw, error: 'expected: date[, time], value[, note]' }
  const [date, ...rest] = parts
  if (!DATE_RE.test(date)) return { line, raw, error: `"${date}" is not a YYYY-MM-DD date` }
  let time: string | null = null
  if (TIME_RE.test(rest[0] ?? '')) {
    const [h, m, s] = rest.shift()!.split(':')
    time = `${h.padStart(2, '0')}:${m}:${s ?? '00'}`
  }
  if (rest.length === 0) return { line, raw, error: 'missing value' }
  const value = Number(rest.shift())
  if (Number.isNaN(value)) return { line, raw, error: 'value is not a number' }
  const note = rest.join(', ').trim()
  return {
    line,
    raw,
    at: time ? `${date}T${time}Z` : date,
    value,
    ...(note ? { note } : {}),
  }
}

function BulkPasteBox({ signal, run, busy }: { signal: Signal; run: Run; busy: boolean }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const parsed = useMemo(
    () => text.split('\n').map((raw, i) => parseLine(raw, i + 1)).filter((p): p is ParsedLine => p !== null),
    [text],
  )
  const bad = parsed.filter((p) => p.error)
  const good = parsed.filter((p) => !p.error)

  const commit = async () => {
    setError(null)
    try {
      await run(() =>
        saveSignalPoints(
          signal.id,
          good.map((p) => ({ at: p.at!, value: p.value!, ...(p.note ? { note: p.note } : {}) })),
        ),
      )
      setText('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const status = bad.length > 0 ? `${bad.length} ${bad.length === 1 ? 'line needs' : 'lines need'} fixing before you commit` : good.length > 0 ? `${good.length} ${good.length === 1 ? 'point' : 'points'} ready` : null

  return (
    <SettingsGroup title='Add several points' className='pb-6'>
      <Field
        label='Bulk paste'
        error={error}
        hint={
          <>
            One <code>date[, time], value[, note]</code> line per row (UTC), e.g. <code>2025-09-01, 118000</code>. Buckets are floored to the signal&apos;s {signal.interval} grain on commit.
          </>
        }>
        <Textarea
          mono
          rows={5}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          placeholder={'2025-09-01, 118000\n2025-10-01, 121500, after the annual invoice'}
        />
      </Field>
      {parsed.length > 0 && (
        <DataGrid<ParsedLine>
          variant='section'
          title='Paste preview'
          rows={parsed}
          getId={(p) => String(p.line)}
          bar={{ noun: 'lines' }}
          rowLabel={(p) => `line ${p.line}`}
          name={{
            label: 'Line',
            render: (p) =>
              p.error ? (
                <span className='truncate text-body-sm text-danger'>
                  Line {p.line}: {p.error}: <code className='text-label'>{p.raw}</code>
                </span>
              ) : (
                <span className='text-body-sm tabular-nums text-muted-foreground'>Line {p.line}</span>
              ),
          }}
          columns={[
            { key: 'at', label: 'At (UTC)', width: 144, render: (p) => (p.error ? null : <span className='text-body-sm tabular-nums text-text'>{formatBucket(p.at!)}</span>) },
            { key: 'value', label: 'Value', width: 112, render: (p) => (p.error ? null : <span className='block w-full text-right text-body-sm tabular-nums text-text'>{formatNumber(p.value!)}</span>) },
            { key: 'note', label: 'Note', width: 192, priority: 2, render: (p) => (p.error ? null : <span className='block truncate text-body-sm text-muted-foreground'>{p.note ?? ''}</span>) },
          ]}
        />
      )}
      <div className='flex items-center justify-between gap-2'>
        <span className='text-label text-fg-4'>{status}</span>
        <Button size='sm' disabled={busy || good.length === 0 || bad.length > 0} onClick={() => void commit()}>
          {busy ? 'Committing…' : good.length > 0 ? `Commit ${good.length} ${good.length === 1 ? 'point' : 'points'}` : 'Commit'}
        </Button>
      </div>
    </SettingsGroup>
  )
}
