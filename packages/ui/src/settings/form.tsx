// A settings form's draft, its footer and its Delete: one Save per page, in the footer, primary
// last; Reset or Cancel left of it; the note at the footer's left; Delete at the far left.

import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { Button } from '../components/Button.tsx'
import { confirm, type ConfirmOptions } from '../components/Confirm.tsx'
import { SettingsDraftContext, SettingsReadOnlyContext } from './internal.tsx'
import { SettingsActions } from './slots.tsx'

/** Structural equality for plain values: objects, arrays, dates and primitives. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** The draft of a settings form, what `useSettingsForm` returns and `SettingsSaveBar` reads. */
export interface SettingsForm<T> {
  values: T
  set: <K extends keyof T>(key: K, value: T[K]) => void
  patch: (patch: Partial<T>) => void
  /** The draft differs from what it was seeded with. */
  dirty: boolean
  /** The `validate` sentence, or null when valid. */
  invalid: string | null
  saving: boolean
  /** The readable message of the last failed save. */
  error: string | null
  /** True for 1.5 s after a save: drives the footer's "Saved". */
  saved: boolean
  /** The stored values changed underneath a dirty draft (someone else saved). */
  stale: boolean
  /** Back to the current stored values. */
  reset: () => void
  /** Drop the draft before leaving on purpose (Cancel): resets it and tells the navigation guard
   *  at once, so leaving right after does not ask. */
  discard: () => void
  /** Validate and save; true when it saved. */
  save: () => Promise<boolean>
  /** Spread on the `<form>`: Enter in a field saves. */
  formProps: { id: string; onSubmit: (e: React.FormEvent) => void; noValidate: true }
}

/**
 * The draft of a settings form: values seeded from what is stored, dirty tracking, validation and
 * save state.
 *
 * Use it for: every Form, Detail and Create page that saves several fields at once, with
 * `SettingsSaveBar` as its footer.
 * Not for: a single control whose effect is immediate (autosave it), a row that edits in place
 * (a `DataGrid` row with `editing`).
 * Props: `stored` is the saved values (changed values, compared structurally, reseed a clean draft and flag `stale` on a
 * dirty one); `validate` returns a sentence for the footer note or null; `equals` replaces the
 * structural compare; `create` lets a create page save without changes.
 * Rules: spread `formProps` on the `<form>`; a failed save keeps the draft and reports through
 * `error`. While dirty, the enclosing `SettingsTabs` asks before a tab switch and the browser asks
 * before the page closes or reloads; call it inside the tab that renders the form.
 */
export function useSettingsForm<T extends object>({ stored, onSave, validate, equals = sameValue, create = false }: {
  stored: T
  onSave: (values: T) => Promise<unknown>
  validate?: (values: T) => string | null
  equals?: (a: T, b: T) => boolean
  create?: boolean
}): SettingsForm<T> {
  const id = React.useId()
  const [values, setValues] = React.useState<T>(stored)
  // What the draft was seeded from (or last saved as): dirty is measured against it.
  const [base, setBase] = React.useState<T>(stored)
  const [stale, setStale] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)
  const dirty = !equals(values, base)

  // A changed `stored` reseeds a clean draft; a dirty one keeps the person's work and says so.
  // Compared by value, not reference: callers may build `stored` inline on every render.
  const [seen, setSeen] = React.useState<T>(stored)
  if (!equals(seen, stored)) {
    setSeen(stored)
    if (!equals(stored, base)) {
      if (dirty) setStale(true)
      else {
        setValues(stored)
        setBase(stored)
        setStale(false)
      }
    } else if (stale) setStale(false)
  } else if (stale && !dirty) {
    // The person undid a stale draft by hand: load what is stored now.
    setValues(stored)
    setBase(stored)
    setStale(false)
  }

  React.useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 1500)
    return () => clearTimeout(timer)
  }, [saved])

  // Tell the tabs around this form whether a switch would drop unsaved work.
  const drafts = React.useContext(SettingsDraftContext)
  const draftKey = React.useRef({}).current
  // While a save runs, `save` has reported its promise: leaving waits for it, so a page that
  // navigates when its save lands goes on, and a failed save keeps the page and its draft.
  React.useEffect(() => {
    if (!saving) drafts?.(draftKey, dirty)
  }, [drafts, draftKey, dirty, saving])
  React.useEffect(() => (drafts ? () => drafts(draftKey, false) : undefined), [drafts, draftKey])

  // Closing or reloading the browser tab with unsaved work: the browser asks first.
  React.useEffect(() => {
    if (!dirty) return
    const ask = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [dirty])

  const invalid = validate ? validate(values) : null
  const latest = React.useRef({ values, dirty, invalid, saving, create, onSave, equals })
  latest.current = { values, dirty, invalid, saving, create, onSave, equals }
  const storedRef = React.useRef(stored)
  storedRef.current = stored

  const edit = React.useCallback((next: (prev: T) => T) => {
    setValues(next)
    setError(null)
    setSaved(false)
  }, [])
  const set = React.useCallback(<K extends keyof T>(key: K, value: T[K]) => edit((prev) => ({ ...prev, [key]: value })), [edit])
  const patch = React.useCallback((p: Partial<T>) => edit((prev) => ({ ...prev, ...p })), [edit])
  const reset = React.useCallback(() => {
    setValues(storedRef.current)
    setBase(storedRef.current)
    setStale(false)
    setError(null)
  }, [])
  const discard = React.useCallback(() => {
    drafts?.(draftKey, false)
    reset()
  }, [drafts, draftKey, reset])
  const save = React.useCallback(async () => {
    const now = latest.current
    if (now.saving || now.invalid || (!now.create && !now.dirty)) return false
    const sent = now.values
    setSaving(true)
    setError(null)
    const run = (async () => {
      try {
        await now.onSave(sent)
        setBase(sent)
        setStale(false)
        setSaved(true)
        // Tell the hosts at once, before anyone waiting on this save goes on: still unsaved when
        // the person edited during the request.
        drafts?.(draftKey, !latest.current.equals(latest.current.values, sent))
        return true
      } catch (err) {
        setError(errorMessage(err))
        drafts?.(draftKey, true)
        return false
      } finally {
        setSaving(false)
      }
    })()
    drafts?.(draftKey, run)
    return run
  }, [drafts, draftKey])
  const formProps = React.useMemo(
    () => ({ id, noValidate: true as const, onSubmit: (e: React.FormEvent) => { e.preventDefault(); void save() } }),
    [id, save],
  )
  return { values, set, patch, dirty, invalid, saving, error, saved, stale, reset, discard, save, formProps }
}

/** Lets a `SettingsDeleteButton` in the bar's `start` report into the bar's note. */
const FooterNoteContext = React.createContext<((note: string | null) => void) | null>(null)

/**
 * A form's footer: `start` at the left, then the note, then Reset or Cancel, then the primary.
 *
 * Use it for: the footer of every Form, Detail and Create page, fed by `useSettingsForm`.
 * Not for: a page with nothing to save (a `SettingsActions` with Close), a confirmation.
 * Props: `create` turns it into a create page's bar, with that label on the primary ("Create
 * role", "Add server"); `onCancel` shows Cancel instead of Reset (detail and create pages);
 * `start` is a `SettingsDeleteButton` or Profile's Sign out.
 * Rules: it publishes itself to the pane footer, so a section only renders it, anywhere. It is
 * always there on a Form: Reset and Save stay disabled until something changed. The primary is
 * `Save`, configurable only through `create`. The note says "Saved", the save or delete error, the
 * `validate` sentence, or that the values changed elsewhere. Under an active `SettingsReadOnly` it
 * renders nothing.
 */
export function SettingsSaveBar({ form, create, onCancel, start }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: SettingsForm<any>
  create?: string
  onCancel?: () => void
  start?: React.ReactNode
}) {
  const readOnly = React.useContext(SettingsReadOnlyContext)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  if (readOnly) return null
  const isCreate = create != null
  const canSave = !form.saving && !form.invalid && (isCreate || form.dirty)
  const note =
    deleteError != null ? { text: deleteError, tone: 'text-danger' }
    : form.error != null ? { text: form.error, tone: 'text-danger' }
    : form.invalid != null && (form.dirty || isCreate) ? { text: form.invalid, tone: 'text-muted-foreground' }
    : form.stale ? { text: 'Changed elsewhere. Reset to load it.', tone: 'text-warning' }
    : form.saved ? { text: 'Saved', tone: 'text-success' }
    : null
  return (
    <SettingsActions>
      <div className='mr-auto flex min-w-0 items-center gap-3'>
        {start != null && <FooterNoteContext.Provider value={setDeleteError}>{start}</FooterNoteContext.Provider>}
        <p role='status' aria-live='polite' className={cn('min-w-0 truncate text-body-sm', note?.tone)} title={note?.text}>
          {note?.text}
        </p>
      </div>
      {onCancel && form.stale && (
        <Button variant='ghost' size='sm' onClick={form.reset} disabled={form.saving}>Reset</Button>
      )}
      {onCancel ? (
        <Button variant='ghost' size='sm' onClick={() => { form.discard(); onCancel() }} disabled={form.saving}>Cancel</Button>
      ) : (
        !isCreate && <Button variant='ghost' size='sm' onClick={form.reset} disabled={form.saving || (!form.dirty && !form.stale)}>Reset</Button>
      )}
      <Button type='submit' size='sm' form={form.formProps.id} disabled={!canSave}>
        {isCreate ? create : form.saving ? 'Saving…' : 'Save'}
      </Button>
    </SettingsActions>
  )
}

/**
 * The Delete of a detail page: ghost, danger on hover, at the footer's left.
 *
 * Use it for: deleting the thing a detail page shows, as `SettingsSaveBar`'s `start` (or inside a
 * `SettingsActions` on a page with nothing to save).
 * Not for: a row (Delete goes in the row's "..." menu), a bulk removal.
 * Props: `label` is the act ("Delete role"), repeated on the confirm button; `confirm` is the
 * question and what else changes ('Delete role "Sales"?'); `disabledReason` disables it and says
 * why in its title ("Move its holders first").
 * Rules: always confirms in the danger tone; a failure is reported in the save bar's note (in
 * place outside one). Under an active `SettingsReadOnly` it renders nothing.
 */
export function SettingsDeleteButton({ label, confirm: question, onDelete, disabledReason }: {
  label: string
  confirm: Pick<ConfirmOptions, 'title' | 'message' | 'typed'>
  onDelete: () => Promise<unknown>
  disabledReason?: string
}) {
  const readOnly = React.useContext(SettingsReadOnlyContext)
  const report = React.useContext(FooterNoteContext)
  const [busy, setBusy] = React.useState(false)
  const [ownError, setOwnError] = React.useState<string | null>(null)
  if (readOnly) return null
  const say = (note: string | null) => (report ? report(note) : setOwnError(note))
  const run = async () => {
    say(null)
    if (!(await confirm({ ...question, danger: true, confirmLabel: label }))) return
    setBusy(true)
    try {
      await onDelete()
    } catch (err) {
      say(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className='inline-flex min-w-0 items-center gap-3' title={disabledReason}>
      <Button
        variant='ghost'
        size='sm'
        disabled={busy || !!disabledReason}
        onClick={() => void run()}
        className='text-muted-foreground hover:bg-danger/10 hover:text-danger'>
        {label}
      </Button>
      {!report && ownError && <span role='alert' className='truncate text-body-sm text-danger'>{ownError}</span>}
    </span>
  )
}
