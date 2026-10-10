import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Autocomplete, Dialog, DialogContent, DialogDescription, DialogTitle, Button, confirm, SelectField, UserPicker } from '@silkweave/box-ui'
import { deleteSignal, upsertSignal, useSignalsData, type SignalUpsert } from '../lib/useSignalsData.ts'
import { useDataSources, useProviders } from '../lib/useSourcesData.ts'
import type { ProviderMeasure } from '../source-types.ts'
import {
  SIGNAL_ACCUMULATIONS,
  SIGNAL_DIRECTIONS,
  SIGNAL_INTERVALS,
  type SignalAccumulation,
  type SignalDirection,
  type SignalInterval,
  type Signal,
} from '../../types.ts'

/** title → slug: lowercase, non-alphanumerics → '-', trimmed. New curated signals get plain slugs
 *  (`mrr`); dotted ids stay a convention of the derived world. */
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

const inputCls =
  'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body-sm text-text transition-colors hover:border-accent/40 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60'

const INTERVAL_LABEL: Record<SignalInterval, string> = { hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly' }
const ACCUMULATION_LABEL: Record<SignalAccumulation, string> = {
  snapshot: 'Snapshot (whole value)',
  increment: 'Increment (per bucket)',
}
const DIRECTION_LABEL: Record<SignalDirection, string> = { up: 'Up is good', down: 'Down is good (churn-like)' }

/**
 * Create/edit a signal definition (admin-only surface - callers gate on canAdmin). With `signal`
 * it edits in place (id fixed); without, it creates a new `manual` signal with the id derived from
 * the label slug. Deleting removes only the definition - points are never deleted with it.
 */
export function SignalDialog({
  open,
  onOpenChange,
  signal,
  onSaved,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  signal?: Signal
  /** Called with (id, channel) after a save - detail views re-navigate if the channel moved. */
  onSaved?: (id: string, channel: string) => void
  onDeleted?: () => void
}) {
  const editing = !!signal
  const { data } = useSignalsData()
  // The catalogue is static and the sources list is small - both are cached stores, so opening the
  // dialog costs no round-trip once either has been read anywhere in the session.
  const { data: providers } = useProviders()
  const { data: sources } = useDataSources()
  const [f, setF] = useState(() => seed(signal))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setF(seed(signal))
    setError(null)
    setSaving(false)
  }, [open, signal])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  const id = editing ? signal.id : slugify(f.label)
  const duplicate = !editing && !!id && (data?.signals ?? []).some((s) => s.id === id)
  const derived = editing && signal.source === 'derived'
  const channels = [...new Set(['business', ...(data?.channels ?? [])])].sort()

  // --- the binding (source → measure) ---
  const source = (sources ?? []).find((s) => s.id === f.sourceId)
  const provider = providers?.find((p) => p.id === source?.provider)
  const measures = provider?.measures ?? []
  // A binding to a measure the provider no longer offers stays visible rather than silently
  // resetting - it is the row a human has to re-point.
  const deadMeasure = !!f.sourceId && !!f.measureKey && !!provider && !measures.some((s) => s.key === f.measureKey)
  const alsoBound = (data?.signals ?? []).filter(
    (s) => s.id !== id && s.data_source_id === f.sourceId && s.measure_key === f.measureKey,
  )

  /** Measure defaults PREFILL a new signal: the selects take the measure's semantics outright (they
   *  always hold a value, so "only if empty" is meaningless there), the free-text fields only fill
   *  when still blank. Every one stays an ordinary editable field - defaults, not locks. Editing an
   *  existing signal never touches curated values when the binding changes. */
  const pickMeasure = (key: string) => {
    const measure: ProviderMeasure | undefined = measures.find((s) => s.key === key)
    setF((p) => {
      const next = { ...p, measureKey: key }
      if (editing || !measure) return next
      return {
        ...next,
        label: p.label.trim() ? p.label : measure.label,
        group: p.group.trim() ? p.group : measure.group,
        unit: p.unit.trim() ? p.unit : (measure.unit ?? ''),
        description: p.description.trim() ? p.description : measure.description,
        // The provider id is the default channel: one dashboard section per provider, with every
        // space's signals grouped there. Freely overridable below.
        channel: provider ? provider.id : p.channel,
        interval: measure.interval,
        accumulation: measure.accumulation,
        direction: measure.direction,
      }
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.label.trim()) return setError('A label is required.')
    if (!id) return setError('Could not derive an id from that label.')
    if (duplicate) return setError(`Signal "${id}" already exists.`)
    if (f.sourceId && !f.measureKey) return setError('Pick a measure, or set the data source back to none.')
    if (f.sourceId && f.formula.trim()) return setError('A formula signal is computed - clear the data source or the formula.')
    const thresholds = parseThresholds(f.thresholds)
    if (!thresholds) return setError('Thresholds are numbers separated by commas, e.g. 1000, 5000.')

    const input: SignalUpsert = {
      id,
      label: f.label.trim(),
      signal_group: f.group.trim(),
      unit: f.unit.trim(), // '' clears
      channel: f.channel.trim() || 'business',
      interval: f.interval,
      accumulation: f.accumulation,
      direction: f.direction,
      owner: f.owner ?? '', // '' clears → ownership falls back to the chain
      description: f.description.trim(),
      depends_on: f.dependsOn,
      // '' on either field clears BOTH server-side (both-or-neither) - unbinding keeps the points.
      data_source_id: f.sourceId,
      measure_key: f.sourceId ? f.measureKey : '',
      thresholds,
    }
    // Only sent when it changes something: '' clears an existing formula; a fresh signal without
    // one, or a derived signal, never mentions it.
    if (!derived && (f.formula.trim() || signal?.formula)) input.formula = f.formula.trim()
    // A formula owns depends_on (the server derives it from the formula's ids).
    if (f.formula.trim()) delete input.depends_on
    // Editing keeps the signal's source: a derived signal stays the deriver's.
    if (editing) input.source = signal.source

    setSaving(true)
    void upsertSignal(input)
      .then(() => {
        onOpenChange(false)
        onSaved?.(id, input.channel ?? 'business')
      })
      .catch((err) => {
        setSaving(false)
        // `.message`, not String(err): the domain's refusals ("would create a dependency cycle",
        // "references unknown signal(s) …") ARE the useful text, and a "TRPCClientError: " prefix
        // in front of them just reads as a crash.
        setError(err instanceof Error ? err.message : String(err))
      })
  }

  const remove = async () => {
    if (!editing) return
    const ok = await confirm({
      title: `Delete signal "${signal.label}"?`,
      message:
        'Only the definition (identity + curation) is removed - data points are never deleted with it.\n' +
        (derived
          ? 'This signal is still written by a deriver: the next derive will re-register it. Deletion is for retired signal.\n'
          : '') +
        'Initiatives still binding the id keep showing it (as the raw id) until re-pointed.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setSaving(true)
    try {
      const report = await deleteSignal(signal.id)
      if (report.warnings.length > 0) console.warn(`signal-delete ${signal.id}:`, report.warnings)
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      setSaving(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-xl'>
        <div className='flex flex-col gap-1'>
          <DialogTitle>{editing ? 'Edit signal' : 'New signal'}</DialogTitle>
          <DialogDescription>
            {editing ? (
              <>
                <code className='text-label'>{id}</code>
                {derived && ' · derived - the id and its points come from the deriver; everything here is curation on top'}
              </>
            ) : (
              'A first-class signal. It can exist before any data does - bind it to initiatives right away. The id is derived from the label.'
            )}
          </DialogDescription>
        </div>

        <form onSubmit={submit} className='flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1'>
          {/* Source first: picking one prefills most of what follows. A derived signal is refused a
              binding server-side (a deriver already owns its rows), so it never sees this. */}
          {!derived && (sources ?? []).length > 0 && (
            <fieldset className='rounded-md border border-border p-3'>
              <legend className='px-1 text-label text-muted-foreground'>Source (optional)</legend>
              <div className='grid grid-cols-2 gap-3'>
                <Field label='Data source'>
                  <SelectField
                    value={f.sourceId}
                    onValueChange={(v) => setF((p) => ({ ...p, sourceId: v, measureKey: '' }))}
                    options={[
                      { value: '', label: 'None (manual entry)' },
                      ...[...new Set((sources ?? []).map((s) => s.provider))].map((pid) => ({
                        label: providers?.find((p) => p.id === pid)?.label ?? pid,
                        options: (sources ?? [])
                          .filter((s) => s.provider === pid)
                          .map((s) => ({ value: s.id, label: `${s.label}${s.status === 'disabled' ? ' (disabled)' : ''}` })),
                      })),
                    ]}
                  />
                </Field>
                {f.sourceId && (
                  <Field label='Measure'>
                    <SelectField
                      value={f.measureKey}
                      onValueChange={(v) => pickMeasure(v)}
                      options={[
                        { value: '', label: 'Pick a measure…' },
                        ...(deadMeasure ? [{ value: f.measureKey, label: `${f.measureKey} (no longer offered)` }] : []),
                        ...measures.map((s) => ({ value: s.key, label: s.label })),
                      ]}
                    />
                  </Field>
                )}
              </div>
              {f.sourceId && (
                <p className='mt-2 text-label text-muted-foreground'>
                  {deadMeasure ? (
                    <span className='text-warning'>
                      {source?.label ?? f.sourceId} no longer offers <code>{f.measureKey}</code>. The binding is kept
                      as-is - pick another measure or clear the source; the points stay either way.
                    </span>
                  ) : (
                    <>
                      This signal&rsquo;s live points come from {source?.label ?? f.sourceId}&rsquo;s sync. Occurrence
                      counting (<code>signal-event</code>) is refused while it is connected - hand-correct a bucket
                      below the chart instead.
                      {alsoBound.length > 0 && (
                        <span className='text-warning'>
                          {' '}
                          Also bound by {alsoBound.map((s) => s.label).join(', ')}.
                        </span>
                      )}
                    </>
                  )}
                </p>
              )}
            </fieldset>
          )}

          <Field label='Label'>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input autoFocus value={f.label} onChange={(e) => { set('label', e.target.value); setError(null) }} className={inputCls} />
          </Field>

          <div className='grid grid-cols-2 gap-3'>
            <Field label='Group (dashboard section)'>
              <input value={f.group} onChange={(e) => set('group', e.target.value)} placeholder='e.g. Finance' className={inputCls} />
            </Field>
            <Field label='Unit'>
              <input value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder='e.g. $ · optional' className={inputCls} />
            </Field>
            <Field label='Channel'>
              {/* Derived: the channel is the derive-machinery join - moving it would orphan the rows. */}
              <Autocomplete
                value={f.channel}
                onValueChange={(v) => set('channel', v)}
                disabled={derived}
                suggestions={channels.map((c) => ({ value: c }))}
              />
            </Field>
            <Field label='Owner'>
              <UserPicker value={f.owner} onChange={(uid) => set('owner', uid)} />
            </Field>
            <Field label='Interval'>
              <SelectField
                value={f.interval}
                onValueChange={(v) => set('interval', v as SignalInterval)}
                options={SIGNAL_INTERVALS.map((v) => ({ value: v, label: INTERVAL_LABEL[v] }))}
              />
            </Field>
            <Field label='Direction'>
              <SelectField
                value={f.direction}
                onValueChange={(v) => set('direction', v as SignalDirection)}
                options={SIGNAL_DIRECTIONS.map((v) => ({ value: v, label: DIRECTION_LABEL[v] }))}
              />
            </Field>
            <Field label='Accumulation'>
              <SelectField
                value={f.accumulation}
                onValueChange={(v) => set('accumulation', v as SignalAccumulation)}
                options={SIGNAL_ACCUMULATIONS.map((v) => ({ value: v, label: ACCUMULATION_LABEL[v] }))}
              />
            </Field>
          </div>

          <Field label='Description'>
            <textarea
              value={f.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              placeholder='What this number means, how it is gathered, what to watch for.'
              className={cn(inputCls, 'resize-y')}
            />
          </Field>

          <Field label='Thresholds (optional)'>
            <input
              value={f.thresholds}
              onChange={(e) => {
                set('thresholds', e.target.value)
                setError(null)
              }}
              placeholder='e.g. 1000, 5000, 10000'
              inputMode='decimal'
              className={inputCls}
            />
            <span className='text-label text-muted-foreground'>
              Reaching or crossing a level upward records a <code>signal.threshold</code> event, which triggers can act on.
            </span>
          </Field>

          {/* Formula signals compute their points from other signals on read. Not for derived or
              connected signals (a deriver or a sync already owns their points). */}
          {!derived && !f.sourceId && (
            <Field label='Formula (optional)'>
              <input
                value={f.formula}
                onChange={(e) => {
                  set('formula', e.target.value)
                  setError(null)
                }}
                placeholder='e.g. churned-mrr / start(mrr) * 100'
                spellCheck={false}
                className={cn(inputCls, 'font-mono')}
              />
              <span className='text-label text-muted-foreground'>
                Signal ids, numbers, <code>+ - * /</code> and parentheses; write minus with spaces (
                <code>a - b</code>). <code>x</code> is x in this signal&rsquo;s bucket, <code>start(x)</code> the
                level entering it, <code>prev(x)</code> x in the previous bucket. A missing input gives no point. A
                manual point overrides the computed value of its bucket.
              </span>
            </Field>
          )}

          {/* The circuit board's edges. A driver is a CAUSAL CLAIM - "moving this is how you move
              that" - never a calculation: the parent's value always comes from its own data. The
              server refuses unknown ids and cycles with a reason, which lands in `error` below. */}
          <fieldset className='rounded-md border border-border p-3'>
            <legend className='px-1 text-label text-muted-foreground'>Driven by (the circuit board&rsquo;s edges)</legend>
            {f.formula.trim() && (
              <p className='mb-2 text-label text-muted-foreground'>Set from the formula&rsquo;s signal ids on save.</p>
            )}
            {f.dependsOn.length > 0 && (
              <ul className='mb-2 flex flex-wrap gap-1.5'>
                {f.dependsOn.map((dep) => (
                  <li key={dep}>
                    <button
                      type='button'
                      title={`${dep} - click to remove`}
                      onClick={() => set('dependsOn', f.dependsOn.filter((d) => d !== dep))}
                      className='rounded-full border border-border px-2 py-0.5 text-label text-text transition-colors hover:border-danger hover:text-danger'>
                      {data?.signals.find((s) => s.id === dep)?.label ?? dep} ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <SelectField
              value=''
              aria-label='Add a driver'
              onValueChange={(v) => {
                if (v) set('dependsOn', [...f.dependsOn, v])
              }}
              options={[
                { value: '', label: 'Add a signal that drives this one…' },
                ...(data?.signals ?? [])
                  .filter((s) => s.id !== id && !f.dependsOn.includes(s.id))
                  .map((s) => ({ value: s.id, label: s.label })),
              ]}
            />
          </fieldset>

          {error && <p className='text-label text-danger'>{error}</p>}

          <div className='mt-1 flex items-center justify-between gap-2'>
            <span>
              {editing && (
                <Button type='button' variant='destructive' size='sm' disabled={saving} onClick={() => void remove()}>
                  Delete
                </Button>
              )}
            </span>
            <span className='flex items-center gap-2'>
              <Button type='button' variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type='submit' size='sm' disabled={saving || !f.label.trim() || duplicate}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create signal'}
              </Button>
            </span>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface Form {
  label: string
  group: string
  unit: string
  channel: string
  interval: SignalInterval
  accumulation: SignalAccumulation
  direction: SignalDirection
  owner: string | null
  description: string
  /** Signal ids this one is driven by - the board's incoming edges. */
  dependsOn: string[]
  /** The provider binding: both set, or both empty. '' on either clears both server-side. */
  sourceId: string
  measureKey: string
  /** The formula expression; '' = an ordinary signal. */
  formula: string
  /** Threshold levels as typed: numbers separated by commas. */
  thresholds: string
}

/** Comma-separated numbers to a list; null when any part is not a number. */
function parseThresholds(raw: string): number[] | null {
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
  const values = parts.map(Number)
  return values.every((v) => Number.isFinite(v)) ? values : null
}

function seed(s?: Signal): Form {
  return {
    label: s?.label ?? '',
    group: s?.group ?? '',
    unit: s?.unit ?? '',
    channel: s?.channel ?? 'business',
    interval: s?.interval ?? 'day',
    accumulation: s?.accumulation ?? 'snapshot',
    direction: s?.direction ?? 'up',
    owner: s?.owner ?? null,
    description: s?.description ?? '',
    dependsOn: s?.depends_on ?? [],
    sourceId: s?.data_source_id ?? '',
    measureKey: s?.measure_key ?? '',
    formula: s?.formula ?? '',
    thresholds: (s?.thresholds ?? []).join(', '),
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className='flex flex-col gap-1'>
      <span className='text-label text-muted-foreground'>{label}</span>
      {children}
    </label>
  )
}
