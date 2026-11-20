import { useMemo, type ReactNode } from 'react'
import {
  Autocomplete,
  Field,
  FieldGrid,
  Input,
  SelectField,
  Textarea,
  TokenPicker,
  UserPicker,
  useSettingsForm,
  type SettingsForm,
} from '@silkweave/box-ui'
import { missingTrackerParams, trackerParamsPayload, TRACKER_SINCE_PARAM, useTrackers, type TrackerInfo } from '../lib/useTrackers.ts'
import { TrackerParams } from './TrackerParams.tsx'
import { deleteSignal, upsertSignal, useSignalsData, useSignalsDataWithArchived, type SignalUpsert } from '../lib/useSignalsData.ts'
import { useDataSources, useProviders } from '../lib/useSourcesData.ts'
import type { ProviderTracker } from '../source-types.ts'
import {
  SIGNAL_ACCUMULATIONS,
  SIGNAL_DIRECTIONS,
  SIGNAL_INTERVALS,
  type SignalAccumulation,
  type SignalDirection,
  type SignalInterval,
  type Signal,
  type SignalsData,
} from '../../types.ts'

// A signal definition's editor: the draft and its rules (`useSignalEditor`) and its fields
// (`SignalFields`). The Settings pages `signals/new` and `signals/<id>/edit` frame it
// with a `SettingsSaveBar`; a milestone's "New signal" frames it in `SignalCreateDialog`.

/** title → slug: lowercase, non-alphanumerics → '-', trimmed. New curated signals get plain slugs
 *  (`mrr`); dotted ids stay a convention of the derived world. */
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/** Which field a refusal belongs to; 'form' is a sentence under the fields. */
type ErrorField = 'label' | 'source' | 'tracker' | 'thresholds' | 'form'
interface FormError {
  field: ErrorField
  message: string
}

const INTERVAL_LABEL: Record<SignalInterval, string> = { hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly' }
const ACCUMULATION_LABEL: Record<SignalAccumulation, string> = {
  snapshot: 'Snapshot (whole value)',
  increment: 'Increment (per bucket)',
}
const DIRECTION_LABEL: Record<SignalDirection, string> = { up: 'Up is good', down: 'Down is good (churn-like)' }

/** What the draft refuses, and the field it belongs to ('form' is a sentence for the footer). */
function checkSignal(v: Form, ctx: { editing: boolean; id: string; taken: boolean; boxTracker?: TrackerInfo }): FormError | null {
  if (!v.label.trim()) return { field: 'label', message: 'A label is required.' }
  if (!ctx.id) return { field: 'label', message: 'Could not derive an id from that label.' }
  if (!ctx.editing && ctx.taken) return { field: 'label', message: `Signal "${ctx.id}" already exists.` }
  if (v.mode === 'source' && !v.sourceId) return { field: 'source', message: 'Pick the data source, or choose another way to get the numbers.' }
  if (v.mode === 'source' && !v.trackerKey) return { field: 'tracker', message: 'Pick a tracker, or choose another way to get the numbers.' }
  if (v.mode === 'box') {
    if (!v.trackerKey) return { field: 'tracker', message: 'Pick what the Box should track.' }
    const missing = ctx.boxTracker ? missingTrackerParams(ctx.boxTracker, v.trackerParams) : []
    if (missing.length > 0) return { field: 'form', message: `Set ${missing.join(', ')}.` }
  }
  if (!parseThresholds(v.thresholds)) return { field: 'thresholds', message: 'Thresholds are numbers separated by commas, e.g. 1000, 5000.' }
  return null
}

/** The editor `useSignalEditor` returns and `SignalFields` renders. */
export interface SignalEditor {
  form: SettingsForm<Form>
  /** Editing an existing signal (its id is fixed), not creating one. */
  editing: boolean
  /** The id the signal has, or will have (the label's slug on create). */
  id: string
  /** Deriver-owned: no binding choice, a fixed channel, no formula. */
  derived: boolean
  /** The draft's refusal for this field, once the person has changed something. */
  fieldError: (field: ErrorField) => string | undefined
  /** Deletes the signal (and its points); throws the server's refusal. */
  remove: () => Promise<void>
  /** The confirm question for deleting it. */
  deleteQuestion: { title: string; message: string }
  /** Context the fields read: the lists behind the pickers. */
  ctx: {
    data: SignalsData | null
    everySignal: SignalsData | null
    boxTracker?: TrackerInfo
    boxTrackers: TrackerInfo[] | null
  }
}

/**
 * The draft of a signal definition (write on the signal's area creates or edits one). With
 * `signal` it edits it (id fixed); without, it creates a `manual` signal whose id is the label's
 * slug. `onSaved(id, channel)` runs after a save, so a page can follow the signal if its channel
 * or id moved.
 */
export function useSignalEditor({
  signal,
  defaults,
  onSaved,
}: {
  signal?: Signal
  /** A new signal's starting values (e.g. a milestone's title and the planning channel). */
  defaults?: Partial<Pick<Form, 'label' | 'channel' | 'group' | 'description'>>
  onSaved?: (id: string, channel: string) => void | Promise<void>
}): SignalEditor {
  const editing = !!signal
  const { data } = useSignalsData()
  // Ids are taken by archived signals too (an upsert would silently rewrite one), and a formula may
  // still name one: both read the list with archived signals in it. The dependency picker stays live.
  const { data: everySignal } = useSignalsDataWithArchived()
  const { data: boxTrackers } = useTrackers()
  // `defaults` is read once: a caller's fresh object each render must not reseed the draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stored = useMemo(() => seed(signal, defaults), [signal])
  const derived = editing && signal.source === 'derived' && !signal.tracker_key
  const idOf = (v: Form) => (editing ? signal.id : slugify(v.label))
  const ctxOf = (v: Form) => {
    const id = idOf(v)
    return {
      editing,
      id,
      taken: !!id && (everySignal ?? data)?.signals.some((s) => s.id === id) === true,
      boxTracker: v.mode === 'box' ? boxTrackers?.find((t) => t.key === v.trackerKey) : undefined,
    }
  }

  const form = useSettingsForm<Form>({
    stored,
    create: !editing,
    validate: (v) => checkSignal(v, ctxOf(v))?.message ?? null,
    onSave: async (f) => {
      const { id } = ctxOf(f)
      const input: SignalUpsert = {
        id,
        label: f.label.trim(),
        signal_group: f.group.trim(),
        unit: f.unit.trim(), // '' clears
        channel: f.channel.trim() || 'business',
        interval: f.interval,
        accumulation: f.accumulation,
        direction: f.direction,
        owner: f.owner ?? '', // '' clears: ownership falls back to the chain
        description: f.description.trim(),
        depends_on: f.dependsOn,
        // The whole binding, every save: a data source and its tracker, a Box tracker with its
        // params, or neither ('' clears; unbinding keeps the points). Never '' by default for a Box
        // tracker signal: that unbinds it and its live points stop.
        ...(f.mode === 'source'
          ? { data_source_id: f.sourceId, tracker_key: f.trackerKey }
          : f.mode === 'box'
            ? { data_source_id: '', tracker_key: f.trackerKey, tracker_params: JSON.stringify(trackerParamsPayload(f.trackerParams)) }
            : { data_source_id: '', tracker_key: '' }),
        thresholds: parseThresholds(f.thresholds) ?? [],
      }
      // Only sent when it changes something: '' clears an existing formula; a fresh signal without
      // one, or a derived signal, never mentions it.
      if (!derived && (f.formula.trim() || signal?.formula)) input.formula = f.formula.trim()
      // A formula owns depends_on (the server derives it from the formula's ids).
      if (f.formula.trim()) delete input.depends_on
      // A deriver-owned signal stays the deriver's. Otherwise the server sets the source from the
      // binding (a Box tracker makes it derived, leaving one makes it manual again).
      if (derived) input.source = signal.source
      // The domain's refusals ("would create a dependency cycle", "references unknown signal(s)")
      // are the useful text; the save bar shows them as they are.
      await upsertSignal(input)
      await onSaved?.(id, input.channel ?? 'business')
    },
  })

  const problem = checkSignal(form.values, ctxOf(form.values))
  return {
    form,
    editing,
    id: idOf(form.values),
    derived,
    fieldError: (field) => (form.dirty && problem?.field === field && field !== 'form' ? problem.message : undefined),
    remove: async () => {
      if (!signal) return
      const report = await deleteSignal(signal.id)
      if (report.warnings.length > 0) console.warn(`signal-delete ${signal.id}:`, report.warnings)
    },
    deleteQuestion: {
      title: `Delete signal "${signal?.label ?? ''}"?`,
      message:
        'The definition and all its data points are removed. This cannot be undone.\n' +
        (derived ? 'This signal is still written by a deriver: the next derive will re-register it. Deletion is for a retired signal.\n' : '') +
        'Initiatives still binding the id keep showing it (as the raw id) until re-pointed.',
    },
    ctx: { data, everySignal, boxTracker: ctxOf(form.values).boxTracker, boxTrackers },
  }
}

/**
 * A signal's fields in three named parts: Data (where the numbers come from), Details, Driven by.
 * `Group` frames each part: `SettingsGroup` on a Settings page, `FieldSection` in a dialog.
 */
export function SignalFields({
  editor,
  Group,
  autoFocus = false,
}: {
  editor: SignalEditor
  Group: (props: { title: string; children: ReactNode }) => ReactNode
  autoFocus?: boolean
}) {
  const { form, editing, id, derived, fieldError } = editor
  const { data, everySignal, boxTracker, boxTrackers } = editor.ctx
  const f = form.values
  const set = form.set
  const { data: providers } = useProviders()
  const { data: sources } = useDataSources()
  const channels = [...new Set(['business', ...(data?.channels ?? [])])].sort()

  // --- the binding: typed by hand, a Box tracker, or a data source's tracker ---
  const deadBoxTracker = f.mode === 'box' && !!f.trackerKey && !!boxTrackers && !boxTracker
  const hasSources = (sources ?? []).length > 0
  const pickMode = (mode: Mode): void => {
    form.patch({ mode, sourceId: '', trackerKey: '', trackerParams: {}, formula: mode === 'manual' ? f.formula : '' })
  }
  /** A Box tracker picked: a new signal takes its semantics like a provider tracker's (free-text
   *  fields only when blank); `since` carries over, the other params belonged to the old tracker. */
  const pickBoxTracker = (key: string): void => {
    const tracker: TrackerInfo | undefined = boxTrackers?.find((t) => t.key === key)
    const since = f.trackerParams[TRACKER_SINCE_PARAM]
    const next: Partial<Form> = { trackerKey: key, trackerParams: since ? { [TRACKER_SINCE_PARAM]: since } : {} }
    if (editing || !tracker) return form.patch(next)
    form.patch({
      ...next,
      label: f.label.trim() ? f.label : tracker.label,
      group: f.group.trim() ? f.group : (tracker.group ?? ''),
      unit: f.unit.trim() ? f.unit : (tracker.unit ?? ''),
      description: f.description.trim() ? f.description : (tracker.description ?? ''),
      channel: key.split('.')[0] || f.channel,
      interval: tracker.interval as SignalInterval,
      accumulation: tracker.accumulation as SignalAccumulation,
      direction: tracker.direction as SignalDirection,
    })
  }

  const source = (sources ?? []).find((s) => s.id === f.sourceId)
  const provider = providers?.find((p) => p.id === source?.provider)
  const trackers = provider?.trackers ?? []
  // A binding to a tracker the provider no longer offers stays visible rather than silently
  // resetting - it is the row a human has to re-point.
  const deadTracker = !!f.sourceId && !!f.trackerKey && !!provider && !trackers.some((s) => s.key === f.trackerKey)
  const alsoBound = (data?.signals ?? []).filter((s) => s.id !== id && s.data_source_id === f.sourceId && s.tracker_key === f.trackerKey)

  /** Tracker defaults PREFILL a new signal: the selects take the tracker's semantics outright (they
   *  always hold a value, so "only if empty" is meaningless there), the free-text fields only fill
   *  when still blank. Every one stays an ordinary editable field - defaults, not locks. Editing an
   *  existing signal never touches curated values when the binding changes. */
  const pickTracker = (key: string) => {
    const tracker: ProviderTracker | undefined = trackers.find((s) => s.key === key)
    if (editing || !tracker) return form.patch({ trackerKey: key })
    form.patch({
      trackerKey: key,
      label: f.label.trim() ? f.label : tracker.label,
      group: f.group.trim() ? f.group : tracker.group,
      unit: f.unit.trim() ? f.unit : (tracker.unit ?? ''),
      description: f.description.trim() ? f.description : tracker.description,
      // The provider id is the default channel: one dashboard section per provider, with every
      // space's signals grouped there. Freely overridable below.
      channel: provider ? provider.id : f.channel,
      interval: tracker.interval,
      accumulation: tracker.accumulation,
      direction: tracker.direction,
    })
  }

  const dependencyLabel = (dep: string) => (everySignal ?? data)?.signals.find((s) => s.id === dep)?.label ?? dep
  const sourceHint = deadTracker ? (
    <span className='text-warning'>
      {source?.label ?? f.sourceId} no longer offers <code>{f.trackerKey}</code>. The binding is kept as it is: pick another tracker or clear the source; the points stay either way.
    </span>
  ) : (
    <>
      Live points come from {source?.label ?? f.sourceId}&rsquo;s sync. Counting occurrences (<code>signal-event</code>) is refused while it is connected; correct a bucket by hand in Manual points instead.
      {alsoBound.length > 0 && <span className='text-warning'> Also bound by {alsoBound.map((s) => s.label).join(', ')}.</span>}
    </>
  )
  const boxHint = deadBoxTracker ? (
    <span className='text-warning'>
      This Box no longer registers <code>{f.trackerKey}</code>. The binding and the points are kept; pick another tracker or type the numbers by hand.
    </span>
  ) : boxTracker ? (
    <>{boxTracker.description} The Box recomputes it when its data changes; typing a point by hand overrides one bucket.</>
  ) : (
    'The Box computes the numbers from its own data, so nobody has to type them.'
  )

  return (
    <>
    {/* Where the numbers come from, first: picking a tracker prefills most of what follows. A
        deriver-owned signal is refused a binding server-side, so it never sees this. */}
    {!derived && (
      <Group title='Data'>
        <FieldGrid columns={2}>
          <Field label='Where the numbers come from' span='full'>
            <SelectField
              value={f.mode}
              onValueChange={(v) => pickMode(v as Mode)}
              options={[
                { value: 'manual', label: 'Typed by hand (or recorded by an agent)' },
                { value: 'box', label: 'Tracked automatically by the Box' },
                ...(hasSources || f.mode === 'source' ? [{ value: 'source', label: 'From a connected data source' }] : []),
              ]}
            />
          </Field>

          {f.mode === 'box' && (
            <>
              <Field label='Tracker' span='full' hint={boxHint} error={fieldError('tracker')}>
                <SelectField
                  value={f.trackerKey}
                  onValueChange={pickBoxTracker}
                  options={[
                    { value: '', label: boxTrackers?.length === 0 ? 'Nothing to track yet' : 'Pick one…' },
                    ...(deadBoxTracker ? [{ value: f.trackerKey, label: `${f.trackerKey} (no longer registered)` }] : []),
                    ...(boxTrackers ?? []).map((t) => ({ value: t.key, label: t.label })),
                  ]}
                />
              </Field>
              {boxTracker && (
                <div className='col-span-full'>
                  <TrackerParams tracker={boxTracker} value={f.trackerParams} onChange={(v) => set('trackerParams', v)} />
                </div>
              )}
            </>
          )}

          {f.mode === 'source' && (
            <>
              <Field label='Data source' error={fieldError('source')}>
                <SelectField
                  value={f.sourceId}
                  onValueChange={(v) => form.patch({ sourceId: v, trackerKey: '' })}
                  options={[
                    { value: '', label: 'Pick one…' },
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
                <Field label='Tracker' error={fieldError('tracker')}>
                  <SelectField
                    value={f.trackerKey}
                    onValueChange={(v) => pickTracker(v)}
                    options={[
                      { value: '', label: 'Pick a tracker…' },
                      ...(deadTracker ? [{ value: f.trackerKey, label: `${f.trackerKey} (no longer offered)` }] : []),
                      ...trackers.map((s) => ({ value: s.key, label: s.label })),
                    ]}
                  />
                </Field>
              )}
              {f.sourceId && (
                <p className='col-span-full text-label text-fg-4'>{sourceHint}</p>
              )}
            </>
          )}
        </FieldGrid>
      </Group>
    )}

    <Group title='Details'>
      <FieldGrid columns={2}>
        <Field label='Label' span='full' error={fieldError('label')}>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <Input autoFocus={autoFocus} value={f.label} onChange={(e) => set('label', e.target.value)} />
        </Field>
        <Field label='Group' hint='The dashboard section it appears in.'>
          <Input value={f.group} onChange={(e) => set('group', e.target.value)} placeholder='e.g. Finance' />
        </Field>
        <Field label='Unit'>
          <Input value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder='e.g. $' />
        </Field>
        <Field label='Channel' hint={derived ? 'Fixed: the deriver joins its rows by channel.' : undefined}>
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
        <Field label='Accumulation' span='full'>
          <SelectField
            value={f.accumulation}
            onValueChange={(v) => set('accumulation', v as SignalAccumulation)}
            options={SIGNAL_ACCUMULATIONS.map((v) => ({ value: v, label: ACCUMULATION_LABEL[v] }))}
          />
        </Field>
        <Field label='Description' span='full'>
          <Textarea
            value={f.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            placeholder='What this number means, how it is gathered, what to watch for.'
          />
        </Field>
        <Field
          label='Thresholds'
          span='full'
          error={fieldError('thresholds')}
          hint={<>Reaching or crossing a level upward records a <code>signal.threshold</code> event, which triggers can act on.</>}>
          <Input
            value={f.thresholds}
            onChange={(e) => set('thresholds', e.target.value)}
            placeholder='e.g. 1000, 5000, 10000'
            inputMode='decimal'
          />
        </Field>
        {/* Formula signals compute their points from other signals on read. Not for derived or
            connected signals (a deriver or a sync already owns their points). */}
        {!derived && f.mode === 'manual' && (
          <Field
            label='Formula'
            span='full'
            hint={
              <>
                Signal ids, numbers, <code>+ - * /</code> and parentheses; write minus with spaces (<code>a - b</code>). <code>x</code> is x in this signal&rsquo;s bucket, <code>start(x)</code> the level entering it, <code>prev(x)</code> x in the previous bucket. A missing input gives no point. A manual point overrides the computed value of its bucket.
              </>
            }>
            <Input
              mono
              value={f.formula}
              onChange={(e) => set('formula', e.target.value)}
              placeholder='e.g. churned-mrr / start(mrr) * 100'
              spellCheck={false}
            />
          </Field>
        )}
      </FieldGrid>
    </Group>

              {/* The circuit board's edges. A driver is a CAUSAL CLAIM - "moving this is how you move
        that" - never a calculation: the parent's value always comes from its own data. The
        server refuses unknown ids and cycles with a reason, which lands in the form error. */}
    <Group title='Driven by'>
      <Field
        label='Drivers'
        hint={f.formula.trim() ? 'Set from the formula’s signal ids on save.' : 'Signals whose movement moves this one. A causal claim, not a calculation.'}>
        <TokenPicker
          value={f.dependsOn}
          onChange={(v) => set('dependsOn', v)}
          options={[
            ...(data?.signals ?? []).filter((s) => s.id !== id).map((s) => ({ value: s.id, label: s.label })),
            // An archived driver is not offered, but keeps its name on its chip.
            ...f.dependsOn.map((dep) => ({ value: dep, label: dependencyLabel(dep) })),
          ]}
          allowCreate={false}
          placeholder='Add a signal that drives this one…'
          emptyLabel='No other signal matches.'
        />
      </Field>
    </Group>

    </>
  )
}

export type Mode = 'manual' | 'box' | 'source'

/** The draft's values. */
export interface Form {
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
  /** Where the numbers come from; it decides which of the binding fields below are sent. */
  mode: Mode
  /** `source`: the data source and its provider tracker. `box`: the Box tracker and its params. */
  sourceId: string
  trackerKey: string
  trackerParams: Record<string, string>
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

function seed(s?: Signal, defaults?: Partial<Form>): Form {
  const base: Form = {
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
    mode: s?.data_source_id ? 'source' : s?.tracker_key ? 'box' : 'manual',
    sourceId: s?.data_source_id ?? '',
    trackerKey: s?.tracker_key ?? '',
    trackerParams: { ...s?.tracker_params },
    formula: s?.formula ?? '',
    thresholds: (s?.thresholds ?? []).join(', '),
  }
  return s ? base : { ...base, ...defaults }
}
