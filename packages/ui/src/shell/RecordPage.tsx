// The app frame's page for one record (/crm/acme) and its modal (`RecordDialog`: a create form at
// /crm#new, a record's settings form). Same vocabulary as a Settings create or detail page
// (`Field`, `FieldGrid`, `SettingsGroup`, `useSettingsForm`, `SettingsSaveBar`), so fields look and
// behave the same in every frame; only the frame differs.

import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { confirm } from '../components/Confirm.tsx'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '../components/Dialog.tsx'
import { SETTINGS_GUTTER, SettingsFooterContext, SettingsInfoButton, useScrollEdges, type FooterHost, type SettingsFooter } from '../settings/SettingsPane.tsx'
import { FormColumnContext, SettingsCanvasContext, SettingsDraftContext, leaveState, type DraftHost, type DraftState, type SettingsLeaveState } from '../settings/internal.tsx'

const COLUMN = 'max-w-3xl'

/**
 * A record's own page in the app frame (`/crm/acme`, `/support/tickets/28`): one scrolling canvas
 * holding its fields in a readable column. Fields save one by one as they change (no footer, no
 * Save); the record's state and Delete sit in the top bar with `TopBarActions`, its name in the
 * last crumb and its explanation in that crumb's `info`.
 *
 * Not for: a create form or a record's settings form (a `RecordDialog`), Settings (a
 * `SettingsPage`), a list (`DataGrid`), a document editor or a graph (their own canvas; a record
 * page with a document puts this beside it in a `SplitPane`).
 * Props: `leaveCheck` is a ref the page fills with a check of its forms (`clean`, `dirty`, `failed`);
 * the route passes it to `askToLeave` from its router's navigation blocker.
 * Rules: a form's `useSettingsForm` runs in a child of the `RecordPage`, or its draft never reaches
 * `leaveCheck`. Put `SettingsGroup`s straight inside (they draw the gutter); no margins, gutters or
 * bare `FieldGrid`s.
 */
export function RecordPage({ leaveCheck, children }: {
  leaveCheck?: React.RefObject<(() => Promise<SettingsLeaveState>) | null>
  children: React.ReactNode
}) {
  return <RecordFrame leaveCheck={leaveCheck} column={COLUMN} className='h-full'>{children}</RecordFrame>
}

/**
 * A modal about one record over the page it was opened from: its create form ("New sprint" over
 * the sprints list) or its settings form ("Room settings" over the room). Same vocabulary and
 * footer as a `RecordPage`: `SettingsGroup`s with `Field`s inside, `useSettingsForm`, and a
 * `SettingsSaveBar` (Create or Save, Cancel) in the dialog's footer.
 *
 * Use it for: every create form of the app and a record's settings that are edited as one form.
 * Not for: a record's own page (a `RecordPage`), Settings (a `SettingsPage`), a question (`confirm`).
 * Props: `open` and `onClose` come from the route (the app opens it from the URL hash, `#new`, so a
 * reload or a shared link opens it again); X, Escape and the backdrop call `onClose`. `leaveCheck`
 * is the ref the route's navigation blocker passes to `askToLeave`, so closing a dirty form asks.
 * `title` names it ("New sprint"); `info` is its explanation, behind the info icon.
 * Rules: the form's `useSettingsForm` runs in a child of the `RecordDialog`, as on a `RecordPage`.
 * Create opens the new record (navigating away closes the dialog); Cancel closes it without asking.
 */
export function RecordDialog({ open, onClose, title, info, leaveCheck, children }: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  info?: React.ReactNode
  leaveCheck?: React.RefObject<(() => Promise<SettingsLeaveState>) | null>
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        showClose={false}
        className='h-dvh w-screen max-w-none gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[min(48rem,90dvh)] sm:w-[min(44rem,calc(100vw-4rem))] sm:rounded-xl'>
        <header className={cn('relative z-10 flex h-14 shrink-0 items-center gap-2 bg-surface', SETTINGS_GUTTER)}>
          <DialogTitle className='min-w-0 truncate pr-0 font-serif text-lg'>{title}</DialogTitle>
          {info != null && <SettingsInfoButton>{info}</SettingsInfoButton>}
          <button
            type='button'
            aria-label='Close'
            onClick={onClose}
            className='ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-text'>
            <X className='size-4' />
          </button>
        </header>
        {open && <RecordFrame leaveCheck={leaveCheck} column={null} className='min-h-0 flex-1'>{children}</RecordFrame>}
      </DialogContent>
    </Dialog>
  )
}

/** The canvas and footer host shared by `RecordPage` (a capped column) and `RecordDialog`. */
function RecordFrame({ leaveCheck, column, className, children }: {
  leaveCheck?: React.RefObject<(() => Promise<SettingsLeaveState>) | null>
  column: string | null
  className: string
  children: React.ReactNode
}) {
  const drafts = React.useRef(new Map<object, DraftState>())
  const draftHost = React.useCallback<DraftHost>((key, state) => {
    if (state === false) drafts.current.delete(key)
    else drafts.current.set(key, state)
  }, [])
  React.useEffect(() => {
    if (!leaveCheck) return
    leaveCheck.current = () => leaveState(() => drafts.current.values())
    return () => { leaveCheck.current = null }
  }, [leaveCheck])
  const footers = React.useRef(new Map<object, SettingsFooter>())
  const [, setVersion] = React.useState(0)
  const publish = React.useCallback<FooterHost>((key, next) => {
    if (next === null) footers.current.delete(key)
    else footers.current.set(key, next)
    setVersion((v) => v + 1)
  }, [])
  const footer = [...footers.current.values()].at(-1) ?? null
  const { mainRef, bodyRef, edges, measure } = useScrollEdges()
  return (
    <SettingsFooterContext.Provider value={publish}>
      <SettingsDraftContext.Provider value={draftHost}>
        <FormColumnContext.Provider value={column}>
          <div className={cn('flex min-h-0 flex-col bg-surface', className)}>
            <div ref={mainRef} className='min-h-0 flex-1 overflow-y-auto' onScroll={measure}>
              <div ref={bodyRef} className={cn('flex w-full min-w-0 flex-col', column ? cn('mx-auto pt-4 pb-8', column) : 'pt-1 pb-6')}>
                <SettingsCanvasContext.Provider value='canvas'>{children}</SettingsCanvasContext.Provider>
              </div>
            </div>
            {typeof footer === 'function' ? footer(edges.below) : footer}
          </div>
        </FormColumnContext.Provider>
      </SettingsDraftContext.Provider>
    </SettingsFooterContext.Provider>
  )
}

/**
 * The navigation blocker's question for a page with forms (`RecordPage`, `SettingsPane`): resolves
 * `true` to stay. Clean leaves; a failed save stays (its form says why); unsaved changes ask
 * "Discard changes?".
 * Use it as `useBlocker({ enableBeforeUnload: false, shouldBlockFn: () => askToLeave(leaveCheck) })`.
 */
export async function askToLeave(leaveCheck: React.RefObject<(() => Promise<SettingsLeaveState>) | null>): Promise<boolean> {
  const state = (await leaveCheck.current?.()) ?? 'clean'
  if (state === 'clean') return false
  if (state === 'failed') return true
  return !(await confirm({ title: 'Discard changes?', message: 'This page has changes that are not saved yet.', confirmLabel: 'Discard', danger: true }))
}
