import * as React from 'react'
import { AlertCircle, Check, ChevronDown, ChevronRight, FileText, Hammer, LogOut, Pause, Play, RefreshCw, RotateCcw, Rocket, ShieldCheck, Square } from 'lucide-react'
import { ContextDialog, ModelSelect, PermissionModeSelect, ProgressRing, SessionPanel, UsageDialog, formatTokens, type SessionControls, type SessionVitals } from '@workerdeck/ui'
import type { UsageWindowRow } from '@workerdeck/protocol'
import { BuilderFiles } from '../components/builder/BuilderFiles.tsx'
import { BuilderWrapUp } from '../components/builder/BuilderWrapUp.tsx'
import { useBuilderBrowser } from '../lib/useBuilderBrowser.ts'
import { builderModelOptions } from '../lib/builderModels.ts'
import { safePreviewPath } from '../lib/builderPreview.ts'
import { BUILDER_BRIEF_MESSAGE, clearPendingBrief, readPendingBrief, storePendingBrief, validBrief } from '../lib/builderBrief.ts'
import { Badge, Button, Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, confirm } from '@silkweave/box-ui'
import { configureBuilderMonacoWorker } from '../lib/monacoWorker.ts'
import {
  builderClient,
  loadBuilderControlState,
  loadBuilderPendingChanges,
  promoteBuilderWeb,
  restoreBuilder,
  restartBuilder,
  sendBuilderMessage,
  setBuilderMaintenance,
  startBuilderSession,
  stopBuilder,
  takeBuilderBackup,
  type BuilderApplicationStatus,
  type BuilderControlState,
  type BuilderPendingChanges,
} from '../lib/builderStore.ts'

configureBuilderMonacoWorker()

const applicationCopy: Record<BuilderApplicationStatus, string> = {
  starting: 'Starting',
  running: 'Running',
  stopped: 'Stopped',
  failed: 'Failed',
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className='flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-body-sm text-danger' role='alert'>
      <AlertCircle className='mt-0.5 size-4 shrink-0' />
      <span>{message}</span>
    </div>
  )
}

function BuilderStatus({ state }: { state: BuilderControlState }) {
  const status = state.application.status === 'failed' || state.session?.status === 'failed'
    ? { label: 'Error', color: 'bg-danger' }
    : !state.session
      ? { label: 'Pending', color: 'bg-fg-4' }
      : state.session.status === 'starting'
        ? { label: 'Starting', color: 'bg-info' }
        : state.session.status === 'running'
          ? { label: 'Working', color: 'bg-accent' }
          : state.session.status === 'awaiting_approval'
            ? { label: 'Attention', color: 'bg-warning' }
            : state.session.status === 'parked'
              ? { label: 'Paused', color: 'bg-warning' }
              : state.session.status === 'closed'
                ? { label: 'Ended', color: 'bg-fg-4' }
                : { label: 'Ready', color: 'bg-success' }
  return (
    <Popover>
      <PopoverTrigger render={<Button variant='outline' size='sm' className='rounded-r-none border-r-0 px-2.5' aria-label={`Builder status: ${status.label}`} />}>
        <span className={`size-2 rounded-full ${status.color}`} />{status.label}
      </PopoverTrigger>
      <PopoverContent align='end' className='w-[min(22rem,calc(100vw-1rem))] gap-3'>
        <div>
          <p className='text-body-sm font-medium text-text'>Builder session</p>
          <p className='mt-1 text-label leading-relaxed text-fg-3'>{state.session ? 'The shared workspace is open for this Box.' : 'No shared Builder session is open.'}</p>
        </div>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-border pt-3 text-label'>
          <dt className='text-fg-3'>Status</dt><dd className='text-right text-fg-1'>{status.label}</dd>
          <dt className='text-fg-3'>Application</dt><dd className='text-right text-fg-1'>{applicationCopy[state.application.status]}</dd>
          <dt className='text-fg-3'>Branch</dt><dd className='truncate text-right font-mono text-fg-2' title={state.branch ?? 'Not reported'}>{state.branch ?? 'Not reported'}</dd>
          <dt className='text-fg-3'>Base</dt><dd className='truncate text-right font-mono text-fg-2' title={state.baseRevision ?? 'Not reported'}>{state.baseRevision?.slice(0, 12) ?? 'Not reported'}</dd>
          {state.web.mode === 'built' && <><dt className='text-fg-3'>Live release</dt><dd className='truncate text-right font-mono text-fg-2' title={state.web.release ? `${state.web.release.version} · ${new Date(state.web.release.createdAt).toLocaleString()}` : 'Not promoted yet'}>{state.web.promoting ? 'Promoting…' : state.web.release ? `${state.web.release.sourceSha?.slice(0, 12) ?? state.web.release.version.slice(0, 8)}${state.web.release.dirty ? ' + changes' : ''}` : 'Not promoted yet'}</dd></>}
          <dt className='text-fg-3'>Latest backup</dt><dd className='truncate text-right text-fg-2'>{state.backups[0] ? new Date(state.backups[0].createdAt).toLocaleString() : 'None'}</dd>
        </dl>
      </PopoverContent>
    </Popover>
  )
}

function BuilderMore({ state, busy, onBackup, onRestart, onRestore, onMaintenance, onStop, onClose }: {
  state: BuilderControlState
  busy: boolean
  onBackup: () => void
  onRestart: () => void
  onRestore: (id: string) => void
  onMaintenance: () => void
  onStop: () => void
  onClose: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [selectedBackup, setSelectedBackup] = React.useState(state.backups[0]?.id ?? '')

  React.useEffect(() => {
    if (!state.backups.some((backup) => backup.id === selectedBackup)) {
      setSelectedBackup(state.backups[0]?.id ?? '')
    }
  }, [selectedBackup, state.backups])

  const menuItem = 'w-full justify-start px-2.5 font-normal'
  const runAndClose = (action: () => void): void => { setOpen(false); action() }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant='outline' size='sm' className='rounded-l-none px-2' aria-label='More Builder actions' />}>More<ChevronDown /></PopoverTrigger>
      <PopoverContent align='end' className='max-h-[min(75vh,38rem)] w-[min(18rem,calc(100vw-1rem))] gap-1 p-1.5'>
        <p className='px-2.5 pb-1 pt-1 text-xs font-medium uppercase tracking-wider text-fg-4'>Box controls</p>
        <Button variant='ghost' size='sm' className={menuItem} disabled={busy} onClick={() => runAndClose(onMaintenance)}>
          {state.maintenance ? <Play /> : <Pause />}{state.maintenance ? 'End maintenance mode' : 'Start maintenance mode'}
        </Button>
        <Button variant='ghost' size='sm' className={menuItem} disabled={busy} onClick={() => runAndClose(onBackup)}><ShieldCheck />Create backup</Button>
        <Button variant='ghost' size='sm' className={menuItem} disabled={busy} onClick={() => runAndClose(onRestart)}><RotateCcw />Check and restart Box</Button>
        {state.backups.length > 0 && <div className='mt-1 border-t border-border px-2 py-2'>
          <p className='mb-2 text-xs font-medium uppercase tracking-wider text-fg-4'>Restore backup</p>
          <div className='flex flex-col gap-2'>
            <Select value={selectedBackup} onValueChange={(value) => value != null && setSelectedBackup(value)}>
              <SelectTrigger aria-label='Backup snapshot' className='w-full'>
                <SelectValue>
                  {(value) => {
                    const backup = state.backups.find((candidate) => candidate.id === value)
                    return backup ? new Date(backup.createdAt).toLocaleString() : 'Select a snapshot'
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {state.backups.map((backup) => (
                  <SelectItem key={backup.id} value={backup.id}>
                    {new Date(backup.createdAt).toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant='destructive' size='sm' disabled={busy || !selectedBackup} onClick={() => runAndClose(() => onRestore(selectedBackup))}><RotateCcw />Restore selected backup</Button>
          </div>
        </div>}
        <div className='mt-1 border-t border-border pt-1'>
          {state.session && <Button variant='ghost' size='sm' className={menuItem} disabled={busy} onClick={() => runAndClose(onStop)}><Square />End Builder session</Button>}
          <Button variant='ghost' size='sm' className={menuItem} onClick={() => runAndClose(onClose)}><LogOut />Close Builder</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ProviderPills({ value, onChange, state }: { value: string; onChange: (value: string) => void; state: BuilderControlState }) {
  return <div className='inline-flex rounded-full border border-border bg-bg p-1' aria-label='Builder provider'>
    {(['claude', 'codex'] as const).map(provider => {
      const configured = state.profiles.some(profile => profile.engine.toLowerCase() === provider)
      return <button key={provider} type='button' disabled={!configured} aria-pressed={value === provider} onClick={() => onChange(provider)} className={`rounded-full px-4 py-1.5 text-label font-medium capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${value === provider ? 'bg-accent text-white shadow-sm' : 'text-fg-3 hover:text-text'}`}>{provider}</button>
    })}
  </div>
}

function SessionEmpty({ state, engine, setEngine, busy, brief, onDiscardBrief, onStart, onStop }: { state: BuilderControlState; engine: string; setEngine: (engine: string) => void; busy: boolean; brief: string | null; onDiscardBrief: () => void; onStart: () => void; onStop: () => void }) {
  const unavailable = state.unavailableSession !== null
  const selectedProfile = state.profiles.find(profile => profile.engine.toLowerCase() === engine)
  const canStart = !busy && !unavailable && selectedProfile !== undefined
  return (
    <div className='flex min-h-full flex-col items-center justify-center px-5 py-10 text-center'>
      <div className='flex size-16 items-center justify-center rounded-2xl bg-accent-tint text-accent'><Hammer className='size-8' /></div>
      <h2 className='mt-5 text-heading-2 font-semibold tracking-tight text-text'>{unavailable ? 'The previous Builder runner is unavailable' : 'Open the shared Builder session'}</h2>
      <p className='mt-2 max-w-md text-body leading-relaxed text-muted-foreground'>{unavailable ? 'The saved session could not be resumed after the runner stopped. End it before starting another session.' : 'Start one shared Box session for the team. Administrators can work with the agent and Preview together.'}</p>
      {brief && !unavailable && <BriefWaiting brief={brief} onDiscard={onDiscardBrief} />}
      {unavailable && <div className='mt-4 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-label text-danger'>Previous runner could not be resumed. End that session before starting another.</div>}
      {!unavailable && selectedProfile?.available !== true && <div className='mt-4 rounded-lg border border-border bg-bg px-3 py-2 text-label text-fg-3'>{selectedProfile?.unavailableReason ?? 'This provider is not currently available.'} You can still start the session and finish connecting before sending a turn.</div>}
      {unavailable ? (
        <Button className='mt-5' variant='destructive' disabled={busy} onClick={onStop}><Square />End unavailable session</Button>
      ) : (
        <><div className='mt-5'><ProviderPills value={engine} onChange={setEngine} state={state} /></div>
        <Button className='mt-4' disabled={!canStart} onClick={onStart}><Play />{busy ? 'Connecting…' : 'Start Builder session'}</Button></>
      )}
    </div>
  )
}

/** A handed-over brief waits here until a session exists; it is then inserted, never sent. */
function BriefWaiting({ brief, onDiscard }: { brief: string; onDiscard: () => void }) {
  return <div className='mt-5 w-full max-w-md rounded-lg border border-accent/30 bg-accent-tint p-3 text-left'>
    <div className='flex items-center gap-2 text-label font-medium text-text'><FileText className='size-3.5 text-accent' />Draft brief ready<Button variant='ghost' size='xs' className='ml-auto' onClick={onDiscard}>Discard</Button></div>
    <p className='mt-1.5 line-clamp-4 text-label leading-relaxed text-fg-3'>{brief}</p>
    <p className='mt-2 text-label text-fg-3'>It is placed in the composer when the session starts. You review and send it.</p>
  </div>
}

const pendingStatusLabel = (status: string): string =>
  status === '??' ? 'New' : status.includes('D') ? 'Deleted' : status.includes('R') ? 'Renamed' : status.includes('A') ? 'Added' : status.includes('U') ? 'Conflict' : 'Modified'

/** Rendered inside the confirm description, so it uses phrasing elements only. */
function PendingChangesMessage({ changes }: { changes: BuilderPendingChanges }) {
  const count = changes.files.length
  return <>
    <span className='block'>The live checkout has {changes.truncated ? `more than ${count}` : count} uncommitted {count === 1 ? 'change' : 'changes'}. Starting Builder moves {count === 1 ? 'it' : 'them'} onto the new Builder branch, where {count === 1 ? 'it appears' : 'they appear'} in Wrap Up with the session's work.</span>
    <span className='mt-3 block max-h-56 overflow-y-auto rounded-md border border-border bg-bg py-1 font-mono text-label'>
      {changes.files.map(file => <span key={`${file.status}:${file.path}`} className='flex items-center gap-2 px-2 py-0.5' title={file.path}>
        <span className='w-14 shrink-0 text-fg-4'>{pendingStatusLabel(file.status)}</span>
        <span className='truncate text-fg-2'>{file.path}</span>
      </span>)}
      {changes.truncated && <span className='block px-2 py-0.5 text-fg-4'>More files not shown</span>}
    </span>
  </>
}

function BuilderSessionBar({ vitals, controls }: { vitals?: SessionVitals; controls?: SessionControls }) {
  const [contextOpen, setContextOpen] = React.useState(false)
  const [usageOpen, setUsageOpen] = React.useState(false)
  if (!vitals) return <div className='h-9 shrink-0' />

  const windows: UsageWindowRow[] = Object.entries(vitals.rateLimits ?? {}).flatMap(([key, info]) =>
    info.utilization === undefined ? [] : [{ key, info, updatedAt: vitals.rateLimitsUpdatedAt }],
  )
  const preferredKey = vitals.engine === 'codex' && vitals.rateLimits?.seven_day ? 'seven_day' : 'five_hour'
  const limit = windows.find(window => window.key === preferredKey) ?? windows[0]
  const ended = vitals.status === 'failed' || vitals.status === 'closed'
  const permissionModes = vitals.permissionModes.map(mode => mode.value)
  const models = builderModelOptions(vitals.engine, vitals.models, vitals.model)

  return <>
    <div data-slot='builder-session-status' className='flex h-9 shrink-0 items-center overflow-x-auto border-t border-border px-1.5 text-label'>
      <div className='flex min-w-max items-center gap-2'>
        {vitals.contextUsage && <button type='button' onClick={() => setContextOpen(true)} className='whitespace-nowrap rounded px-1 py-0.5 font-mono text-fg-3 hover:bg-surface-hover hover:text-text'>Ctx {formatTokens(vitals.contextUsage.totalTokens)}</button>}
        {limit && <button type='button' onClick={() => setUsageOpen(true)} className='inline-flex items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 font-mono text-fg-3 hover:bg-surface-hover hover:text-text' aria-label={`Plan usage ${limit.info.utilization?.toFixed(0)}%`}>
          <ProgressRing value={limit.info.utilization ?? 0} />{limit.info.utilization?.toFixed(0)}%
        </button>}
        {vitals.tasks.length > 0 && <span className='whitespace-nowrap text-fg-3'>{vitals.tasks.length} {vitals.tasks.length === 1 ? 'task' : 'tasks'}</span>}
        {controls && models.length > 0 && <ModelSelect models={models} model={vitals.model} onModelChange={controls.setModel} disabled={ended} className='h-6 max-w-40' />}
        {controls && vitals.permissionMode && <PermissionModeSelect mode={vitals.permissionMode} modes={permissionModes} onModeChange={controls.setPermissionMode} disabled={ended} className='h-6 max-w-32' />}
      </div>
    </div>
    <ContextDialog usage={vitals.contextUsage} engine={vitals.engine} open={contextOpen} onOpenChange={setContextOpen} />
    <UsageDialog rateLimits={windows} engine={vitals.engine ?? 'claude'} updatedAt={vitals.rateLimitsUpdatedAt} open={usageOpen} onOpenChange={setUsageOpen} />
  </>
}

export function BuilderView() {
  const [state, setState] = React.useState<BuilderControlState>()
  const [loading, setLoading] = React.useState(true)
  const [action, setAction] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [view, setView] = React.useState<'preview' | 'files'>('preview')
  const [wrapUp, setWrapUp] = React.useState(false)
  const [previewLocation, setPreviewLocation] = React.useState(() => safePreviewPath(new URLSearchParams(location.search).get('preview')))
  const [initialPreview] = React.useState(previewLocation)
  const [openFile, setOpenFile] = React.useState<string>()
  const [unsaved, setUnsaved] = React.useState(false)
  const [panelWidth, setPanelWidth] = React.useState(460)
  const [pickedEngine, setEngine] = React.useState<string>()
  const configuredEngine = (id: string): boolean => state?.profiles.some(profile => profile.engine.toLowerCase() === id) ?? false
  // Claude is the default provider; fall back to Codex only when Claude has no profile.
  const engine = pickedEngine ?? (configuredEngine('claude') || !configuredEngine('codex') ? 'claude' : 'codex')
  const [sessionVitals, setSessionVitals] = React.useState<SessionVitals>()
  const [sessionControls, setSessionControls] = React.useState<SessionControls>()
  const [brief, setBrief] = React.useState(readPendingBrief)
  const iframe = React.useRef<HTMLIFrameElement>(null)
  const [loadedUiVersion] = React.useState(() => document.querySelector<HTMLMetaElement>('meta[name="box-builder-ui"]')?.content ?? null)
  const polling = React.useRef(false)
  const refresh = React.useCallback(async () => {
    if (polling.current) return
    polling.current = true
    try { setState(await loadBuilderControlState()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Builder is unavailable.') }
    finally { polling.current = false; setLoading(false) }
  }, [])
  React.useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 4000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [refresh])
  React.useEffect(() => {
    const receive = (event: MessageEvent): void => {
      if (event.origin !== location.origin || event.source !== iframe.current?.contentWindow) return
      if (event.data?.type === BUILDER_BRIEF_MESSAGE) {
        const text = event.data.v === 1 ? validBrief(event.data.text) : null
        if (text) { storePendingBrief(text); setBrief(text) }
        return
      }
      if (event.data?.type !== 'box:preview-location') return
      const path = safePreviewPath(event.data.path)
      setPreviewLocation(path)
      const url = new URL(location.href)
      url.searchParams.set('preview', path)
      history.replaceState(null, '', url)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])
  const discardBrief = (): void => { clearPendingBrief(); setBrief(null) }
  // Insert a handed-over brief once the composer exists. Insertion only: the owner sends the turn.
  React.useEffect(() => {
    if (!brief || !sessionControls) return
    let tries = 0
    const timer = window.setInterval(() => {
      const ready = document.querySelector('[aria-label="Shared Builder conversation"] [data-slot="composer"] [contenteditable="true"]')
      if (!ready && ++tries < 60) return
      window.clearInterval(timer)
      if (!ready) return
      sessionControls.insertComposerText(brief)
      sessionControls.focusComposer()
      discardBrief()
    }, 150)
    return () => window.clearInterval(timer)
  }, [brief, sessionControls])
  const run = async (name: string, operation: () => Promise<void>): Promise<void> => {
    setAction(name); setError(null)
    try { await operation(); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : `${name} failed.`) }
    finally { setAction(null) }
  }
  const busy = action !== null
  const browser = useBuilderBrowser(iframe, !!state)
  const maintenance = async (): Promise<void> => {
    if (!state) return
    if (!await confirm({ title: state.maintenance ? 'End maintenance?' : 'Enable maintenance?', message: 'Maintenance blocks members and pauses configured background work.', confirmLabel: 'Continue' })) return
    await run('maintenance', () => setBuilderMaintenance(!state.maintenance))
  }
  const backup = (): Promise<void> => run('backup', takeBuilderBackup)
  const restart = async (): Promise<void> => {
    if (!await confirm({ title: 'Check and restart the Box?', message: 'The application will restart after successful checks. Builder stays connected.', confirmLabel: 'Restart' })) return
    await run('restart', () => restartBuilder(true))
  }
  const start = (): Promise<void> => run('start', async () => {
    const changes = await loadBuilderPendingChanges()
    if (changes.fingerprint && !await confirm({ title: 'Adopt uncommitted changes?', message: <PendingChangesMessage changes={changes} />, confirmLabel: 'Adopt and start' })) return
    await startBuilderSession(engine, changes.fingerprint ?? undefined)
  })
  const stop = async (): Promise<void> => {
    if (!await confirm({ title: 'End without integrating?', message: 'Changes and the Builder branch remain on disk. Use Wrap Up to verify and integrate completed work.', confirmLabel: 'End session', danger: true })) return
    await run('stop', stopBuilder)
  }
  const promote = async (): Promise<void> => {
    if (!await confirm({ title: 'Promote to everyone?', message: 'Checks types, then builds the current web source and publishes it to everyone outside Builder. Open tabs are offered a reload. Backend changes go live with each application restart, not here.', confirmLabel: 'Promote' })) return
    await run('promote', () => promoteBuilderWeb(true))
  }
  const restore = async (id: string): Promise<void> => {
    if (!await confirm({ title: 'Restore instance data?', message: 'The selected backup replaces current data and configuration. Source must be clean at the matching revision; a safety backup is created first.', confirmLabel: 'Restore', danger: true })) return
    await run('restore', () => restoreBuilder(id))
  }
  const reloadPreview = (): void => {
    try { iframe.current?.contentWindow?.location.reload() }
    catch { if (iframe.current) iframe.current.src = previewLocation }
  }
  const revealFile = (path: string): void => { setOpenFile(path); setView('files') }
  const resize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = event.clientX, width = panelWidth
    const move = (next: PointerEvent): void => setPanelWidth(Math.max(340, Math.min(800, width + start - next.clientX)))
    const stop = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true })
  }
  if (loading || !state) return <main className='grid min-h-dvh place-items-center bg-bg p-6 text-text'><div className='max-w-lg space-y-4'><h1 className='text-2xl font-semibold'>Box Builder</h1>{error ? <><ErrorNotice message={error} /><a className='text-accent underline' href='/'>Open Box to sign in</a><Button onClick={() => void refresh()}>Retry</Button></> : <p>Connecting to your Builder host…</p>}</div></main>
  const breadcrumb = view === 'preview' ? previewLocation : view === 'files' ? (openFile ?? 'Select a file') : null
  return <div className='flex h-dvh flex-col gap-3 overflow-hidden bg-sidebar p-3 text-text lg:flex-row'>
    <main className='frame-shine flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-(--frame-shadow)'>
      <header className='flex h-12 shrink-0 items-center gap-3 border-b border-border px-4'>
        <div className='flex min-w-0 items-center gap-1.5 text-body-sm'>
          <span className='shrink-0 font-medium capitalize'>{view}</span>
          {breadcrumb && <><ChevronRight className='size-3.5 shrink-0 text-fg-4' /><span className='truncate font-mono text-label text-fg-3' title={breadcrumb}>{breadcrumb}</span></>}
        </div>
        <div className='ml-auto flex shrink-0 items-center gap-2'>
          {state.maintenance && <Badge variant='warning'>Maintenance</Badge>}
          <nav className='flex rounded-full border border-border bg-surface p-1' aria-label='Builder workspace views'>
            {(['preview', 'files'] as const).map(item => {
              const selected = view === item
              const disabled = item !== 'preview' && !state.session
              return <div key={item} className={`flex items-center rounded-full ${selected ? 'bg-accent/15 text-accent' : 'text-fg-3'}`}>
                <button type='button' disabled={disabled} onClick={() => setView(item)} aria-current={selected ? 'page' : undefined} className='rounded-full px-3 py-1 text-label font-medium transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-40'>{item === 'preview' ? 'Preview' : 'Files'}</button>
                {item === 'preview' && selected && <button type='button' onClick={reloadPreview} className='mr-1 flex size-6 items-center justify-center rounded-full text-accent transition-colors hover:bg-accent/10' aria-label='Refresh preview' title='Refresh preview'><RefreshCw className='size-3.5' /></button>}
              </div>
            })}
          </nav>
          {state.web.mode === 'built' && <Button variant='outline' size='sm' disabled={busy || unsaved || state.web.promoting} onClick={() => void promote()} title='Publish the current web source to everyone outside Builder'><Rocket />{state.web.promoting || action === 'promote' ? 'Promoting…' : 'Promote'}</Button>}
          <Button size='sm' disabled={!state.session} onClick={() => setWrapUp(true)} title='Review, verify and commit this session'><Check />Wrap Up</Button>
        </div>
      </header>
      <div className={view === 'preview' ? 'relative min-h-0 flex-1' : 'hidden'}>
        {state.application.status === 'failed' && <div className='absolute inset-x-0 top-0 z-10 bg-danger-bg p-3 text-body-sm text-danger'>The Box needs repair. Builder is still available.</div>}
        <iframe ref={iframe} onLoad={browser.reset} name='box-builder-preview' title='Live Box preview' src={initialPreview} className='h-full w-full border-0 bg-bg' />
      </div>
      {state.session && <div className={view === 'files' ? 'min-h-0 flex-1' : 'hidden'}><BuilderFiles key={state.session.id} cwd={state.session.cwd} readOnly={false} openPath={openFile} onUnsaved={setUnsaved} /></div>}
      {state.session && <BuilderWrapUp open={wrapUp} onOpenChange={setWrapUp} cwd={state.session.cwd} unsaved={unsaved} onUpdated={refresh} onOpenFile={revealFile} onFinished={() => location.assign(previewLocation)}
        onAskAgent={text => sendBuilderMessage(state.session!.id, text)} />}
    </main>
    <div role='separator' aria-label='Resize Builder conversation' aria-orientation='vertical' tabIndex={0} aria-valuemin={340} aria-valuemax={800} aria-valuenow={panelWidth} onPointerDown={resize} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPanelWidth(w => Math.max(340, Math.min(800, w + (e.key === 'ArrowLeft' ? 20 : -20)))) } }} className='hidden w-1 shrink-0 cursor-col-resize touch-none rounded bg-border/40 hover:bg-accent lg:block' />
    <aside style={{ '--builder-width': `${panelWidth}px` } as React.CSSProperties} className='flex h-[45vh] min-h-0 shrink-0 flex-col lg:h-full lg:w-(--builder-width)' aria-label='Shared Builder conversation'>
      <header className='flex h-12 shrink-0 items-center gap-2 px-2'><Hammer className='size-4 text-accent' /><h1 className='text-body-sm font-semibold'>Box Builder</h1><Badge variant='neutral'>Shared</Badge><div className='ml-auto flex items-center'><BuilderStatus state={state} /><BuilderMore state={state} busy={busy} onBackup={() => void backup()} onRestart={() => void restart()} onRestore={id => void restore(id)} onMaintenance={() => void maintenance()} onStop={() => void stop()} onClose={() => location.assign(previewLocation)} /></div></header>
      {error && <ErrorNotice message={error} />}
      <div className='flex shrink-0 flex-wrap items-center gap-2 px-2 pb-2 text-label' role='status'>
        {state.ui.building ? <span>Refreshing Builder UI…</span> : state.ui.version && state.ui.version !== loadedUiVersion ? <Button variant='secondary' size='sm' disabled={unsaved} onClick={() => location.reload()}>Builder updated · Reload</Button> : null}
        {state.ui.error && <span className='text-danger'>Refresh failed; previous UI retained.</span>}
        {state.web.mode === 'built' && state.web.error && <span className='text-danger' title={state.web.error}>Promote failed; everyone keeps the previous release.</span>}
      </div>
      {state.session ? <>
        <SessionPanel key={state.session.id} client={builderClient} sessionId={state.session.id} readOnly={false} peerMentions={false} transcriptVariant='terminal' statusSurface='external' controlsSurface='external' onVitals={setSessionVitals} onControls={setSessionControls} onOpenFile={revealFile} className='builder-transcript min-h-0 flex-1 bg-transparent' />
        <BuilderSessionBar vitals={sessionVitals} controls={sessionControls} />
      </> : <div className='min-h-0 flex-1 overflow-y-auto'><SessionEmpty state={state} engine={engine} setEngine={setEngine} busy={busy} brief={brief} onDiscardBrief={discardBrief} onStart={() => void start()} onStop={() => void stop()} /></div>}
    </aside>
  </div>
}
