import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, Popover, PopoverContent, PopoverTrigger } from '@silkweave/box-ui'
import { AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, Circle, FileDiff, GitBranch, LoaderCircle, Minus, RefreshCw, Save, ShieldCheck, Sparkles, X } from 'lucide-react'
import { checkpointBuilderReview, finishBuilderReview, loadBuilderReview, verifyBuilderReview, type BuilderReviewState, type BuilderVerificationState, type BuilderVerificationStep } from '../../lib/builderStore.ts'

/**
 * Wrap Up: the one guided path from "the Builder changed things" to "it is committed and live".
 * Review what changed, verify that exact Git state, then commit and integrate. Every step reads
 * the server's review fingerprint, so a file changed after a check sends the owner back to verify.
 */
type Step = 'review' | 'verify' | 'commit'
const STEPS: readonly { id: Step; label: string }[] = [
  { id: 'review', label: 'Review' },
  { id: 'verify', label: 'Verify' },
  { id: 'commit', label: 'Commit' },
]
const DIFF_LINES = 2500

export function BuilderWrapUp({ open, onOpenChange, cwd, unsaved, onUpdated, onOpenFile, onFinished, onAskAgent }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The session worktree, to turn a changed path into an editor path. */
  cwd: string
  unsaved: boolean
  onUpdated: () => Promise<void>
  onOpenFile: (path: string) => void
  onFinished: () => void
  /** Send a turn to the Builder session. Absent until a session exists. */
  onAskAgent?: (text: string) => Promise<void>
}) {
  const [step, setStep] = useState<Step>('review')
  const [data, setData] = useState<BuilderReviewState>()
  const [fetchedAt, setFetchedAt] = useState(0)
  const [error, setError] = useState<string>()
  const [action, setAction] = useState<string>()
  const [message, setMessage] = useState('')
  const [done, setDone] = useState<string>()
  // Between clicking Verify and the server's first running record.
  const [starting, setStarting] = useState(false)
  const polling = useRef(false)
  const refresh = useCallback(async () => {
    if (polling.current) return
    polling.current = true
    try { setData(await loadBuilderReview()); setFetchedAt(Date.now()); setError(undefined) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Review unavailable') }
    finally { polling.current = false }
  }, [])
  const running = data?.verification?.status === 'running'
  useEffect(() => {
    if (!open) return
    void refresh()
    const timer = setInterval(() => void refresh(), running || starting ? 1000 : 5000)
    return () => clearInterval(timer)
  }, [open, refresh, running, starting])
  // Every opening starts at the beginning: the owner looks at what changed before anything else.
  useEffect(() => { if (open) { setStep('review'); setDone(undefined); setError(undefined) } }, [open])

  const run = async (name: string, operation: () => Promise<unknown>): Promise<boolean> => {
    setAction(name); setError(undefined)
    try { await operation(); await refresh(); await onUpdated(); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : `${name} failed`); return false }
    finally { setAction(undefined) }
  }

  const review = data?.review
  const verification = data?.verification
  const current = !!verification && verification.fingerprint === review?.fingerprint
  const verified = current && verification.status === 'passed'
  const failed = current && verification.status === 'failed'
  const stale = !!verification && !current && verification.status !== 'running'
  const hasWork = !!review && (review.files.length > 0 || review.commits.length > 0)
  const busy = !!action || running
  const reached = (id: Step): boolean => id === 'review' || (id === 'verify' && hasWork) || (id === 'commit' && hasWork && verified)
  const steps = current || running ? verification?.steps ?? [] : []
  const failures = steps.filter(item => item.status === 'failed' || item.status === 'cancelled').length
  const warnings = steps.reduce((sum, item) => sum + item.warnings.length, 0)

  const verify = async (): Promise<boolean> => {
    setStarting(true)
    // The request lasts the whole chain; pick up the running record as soon as it exists.
    setTimeout(() => void refresh(), 300)
    try { return await run('Checking', () => verifyBuilderReview(review!.fingerprint)) }
    finally { setStarting(false) }
  }
  // Show the whole table at once: the last run's checks, queued, until the server reports its own.
  const shown: BuilderVerificationState | null | undefined = starting && !running
    ? { fingerprint: review?.fingerprint ?? '', status: 'running', output: '', checkedAt: '', warnings: false, elapsed: 0,
        steps: (verification?.steps ?? []).map(item => ({ ...item, status: 'pending', elapsed: 0, progress: undefined, cached: false, warnings: [], diagnostics: [], exitCode: null })) }
    : current || running ? verification : null
  const checkpoint = async (): Promise<void> => {
    if (!review || !message.trim()) return
    if (await run('Saving checkpoint', () => checkpointBuilderReview(review.fingerprint, message.trim()))) {
      setMessage(''); setDone('Checkpoint saved on the Builder branch. The session stays open.')
    }
  }
  const finish = async (): Promise<void> => {
    if (!review || !verified || !message.trim()) return
    if (await run('Finishing', () => finishBuilderReview(review.fingerprint, message.trim()))) onFinished()
  }
  // Hand an issue to the Builder agent and leave Wrap Up: the owner comes back to verify again.
  const askAgent = onAskAgent ? async (text: string): Promise<void> => {
    setAction('Sending to the Builder'); setError(undefined)
    try { await onAskAgent(text); onOpenChange(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reach the Builder session') }
    finally { setAction(undefined) }
  } : undefined

  return <Dialog open={open} onOpenChange={next => { if (!action) onOpenChange(next) }}>
    <DialogContent showClose={false} className='h-[min(42rem,90dvh)] max-w-3xl gap-0 p-0'>
      <header className='grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-border py-3 pr-3 pl-5'>
        <DialogTitle className='pr-0 text-lg'>Wrap Up</DialogTitle>
        <DialogDescription className='sr-only'>Review what changed, check it, then commit it to {review?.targetBranch ?? 'the Box'}.</DialogDescription>
        <ol className='flex items-center gap-1' aria-label='Wrap up steps'>
          {STEPS.map((item, index) => {
            const active = item.id === step
            const complete = STEPS.findIndex(s => s.id === step) > index
            return <li key={item.id} className='flex items-center gap-1'>
              {index > 0 && <ChevronRight className='size-3.5 text-fg-4' aria-hidden />}
              <button type='button' disabled={!reached(item.id) || busy} onClick={() => setStep(item.id)} aria-current={active ? 'step' : undefined}
                className={`flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-label font-medium transition-colors disabled:cursor-not-allowed ${active ? 'bg-accent/15 text-accent' : complete ? 'text-text hover:bg-surface-hover' : 'text-fg-3'}`}>
                <span className={`flex size-5 items-center justify-center rounded-full text-[11px] ${active ? 'bg-accent text-white' : complete ? 'bg-success/15 text-success' : 'bg-muted text-fg-3'}`}>{complete ? <Check className='size-3' /> : index + 1}</span>
                {item.label}
              </button>
            </li>
          })}
        </ol>
        <div className='flex items-center justify-end gap-2'>
          {running || starting ? <Badge variant='accent' size='sm'><LoaderCircle className='size-3 animate-spin' />Checking</Badge>
            : failures > 0 || failed ? <Badge variant='danger' size='sm'><AlertCircle className='size-3' />{failures > 0 ? `${failures} failed` : 'Failed'}</Badge>
            : warnings > 0 || (verified && verification.warnings) ? <Badge variant='warning' size='sm'><AlertTriangle className='size-3' />{warnings > 0 ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : 'Warnings'}</Badge>
            : verified ? <Badge variant='success' size='sm'><Check className='size-3' />Verified</Badge> : null}
          <DialogClose disabled={!!action} render={<Button variant='ghost' size='icon-sm' aria-label='Close'><X /></Button>} />
        </div>
      </header>

      <div className='min-h-0 flex-1 overflow-auto'>
        {error && <p role='alert' className='mx-5 mt-4 rounded-lg border border-danger/30 bg-danger-bg p-3 text-body-sm text-danger'>{error}</p>}
        {unsaved && <p className='mx-5 mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-body-sm text-warning'>An editor tab in Files has unsaved changes. Save or discard them first: checks and commits use the files on disk.</p>}
        {!review ? <p className='px-5 py-4 text-body-sm text-fg-3'>Reading changes…</p>
          : step === 'review' ? <ReviewStep data={data!} onOpenFile={path => { onOpenChange(false); onOpenFile(`${cwd}/${path}`) }} />
          : step === 'verify' ? <VerifyStep verification={shown} stale={stale && !starting} fetchedAt={fetchedAt} busy={busy} onAskAgent={askAgent} />
          : <section className='space-y-4 px-5 py-4'>
              {done ? <StatusLine tone='success' title={done} /> : <>
                <label className='block text-label font-medium text-fg-2' htmlFor='builder-wrapup-message'>Commit message
                  <input id='builder-wrapup-message' autoFocus value={message} onChange={e => setMessage(e.target.value)} maxLength={1000} placeholder='What changed and why?' className='mt-1.5 w-full rounded-lg border border-border bg-bg px-3 py-2 text-body-sm font-normal text-text' />
                </label>
                <p className='text-body-sm text-fg-3'>
                  <strong className='font-medium text-text'>Finish</strong> commits any remaining changes, moves {review.targetBranch ? <code>{review.targetBranch}</code> : 'the target branch'} forward, restarts the Box and ends this Builder session.
                  {' '}<strong className='font-medium text-text'>Checkpoint only</strong> commits on the Builder branch and keeps the session open.
                </p>
                {!review.targetBranch && <p className='text-body-sm text-warning'>This session has no integration branch, so it can only save checkpoints.</p>}
              </>}
            </section>}
      </div>

      <footer className='flex items-center gap-3 border-t border-border px-5 py-3'>
        {step !== 'review' && <Button variant='ghost' disabled={busy} onClick={() => setStep(step === 'commit' ? 'verify' : 'review')}><ArrowLeft />Back</Button>}
        {action && <span role='status' className='text-label text-accent'>{action}…</span>}
        <div className='ml-auto flex items-center gap-2'>
          {step === 'review' && <>
            <Button variant='ghost' disabled={busy} onClick={() => void refresh()}><RefreshCw />Refresh</Button>
            <Button disabled={!hasWork || busy} onClick={() => { setStep('verify'); if (!verified && !running && !unsaved) void verify() }}>{verified ? 'Next' : 'Verify'}<ArrowRight /></Button>
          </>}
          {step === 'verify' && <>
            {!verified && <Button variant={failed || stale ? 'default' : 'secondary'} disabled={busy || unsaved} onClick={() => void verify()}><RefreshCw className={running ? 'animate-spin' : ''} />{running ? 'Checking…' : failed || stale ? 'Run again' : 'Run checks'}</Button>}
            {verified && <Button disabled={busy} onClick={() => setStep('commit')}>Next<ArrowRight /></Button>}
          </>}
          {step === 'commit' && (done ? <Button onClick={() => onOpenChange(false)}>Close</Button> : <>
            <Button variant='secondary' disabled={busy || unsaved || !message.trim() || review?.files.length === 0} onClick={() => void checkpoint()}><Save />Checkpoint only</Button>
            <Button disabled={busy || unsaved || !verified || !review?.targetBranch || !message.trim()} onClick={() => void finish()}><Check />Finish</Button>
          </>)}
        </div>
      </footer>
    </DialogContent>
  </Dialog>
}

const seconds = (ms: number): string => ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round(ms % 60_000 / 1000)}s`
const fence = (lines: string[]): string => `\`\`\`\n${lines.join('\n')}\n\`\`\``
const failurePrompt = (item: BuilderVerificationStep): string => `The Wrap Up check "${item.name}" failed (\`${item.command}\`${item.exitCode !== null ? `, exit ${item.exitCode}` : ''}). Fix the cause, keep unrelated behaviour unchanged, and tell me when it is ready to verify again.\n\n${fence(item.diagnostics)}\n\nComplete log: ${item.log}`
const warningPrompt = (item: BuilderVerificationStep): string => `The Wrap Up check "${item.name}" passed but printed warnings (\`${item.command}\`). Fix them if our changes cause them; if they are expected, explain why and leave the code unchanged.\n\n${fence(item.warnings)}\n\nComplete log: ${item.log}`

const COLUMNS = 'grid grid-cols-[1.25rem_minmax(0,1fr)_10rem_7.5rem_4rem] items-center gap-4 px-5'

/** The validation chain as a task list: one row per check, then every failure and warning. */
function VerifyStep({ verification, stale, fetchedAt, busy, onAskAgent }: {
  verification: BuilderVerificationState | null | undefined
  stale: boolean
  fetchedAt: number
  busy: boolean
  onAskAgent?: (text: string) => Promise<void>
}) {
  const running = verification?.status === 'running'
  // Between polls, running rows keep counting from the last snapshot.
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [running])
  const drift = running ? Math.max(0, Math.min(3000, now - fetchedAt)) : 0
  const [showOutput, setShowOutput] = useState(false)

  if (!verification) return stale
    ? <StateScreen icon={FileDiff} tone='warning' title='Files changed after the last check' detail='The earlier result no longer matches these changes. Run the checks again to verify them.' />
    : <StateScreen icon={ShieldCheck} tone='accent' title='Ready to verify' detail='Runs the complete validation chain on these exact changes: build, types, lint, tests and schema.' />
  const steps = verification.steps ?? []
  // Records from before the task list, or a failure before any check started.
  if (!steps.length) return <section className='space-y-4 px-5 py-4'>
    <StatusLine tone={running ? 'running' : verification.status === 'passed' ? 'success' : 'danger'} title={running ? 'Starting the validation chain…' : verification.status === 'passed' ? 'Checks passed.' : 'Checks failed.'} />
    {verification.status === 'failed' && <IssueCard tone='danger' title='Verification stopped' lines={verification.output.trim().split('\n').slice(-12)} onAsk={onAskAgent && (() => onAskAgent(`The Wrap Up checks failed. Fix the reported issues, keep unrelated behaviour unchanged, and tell me when it is ready to verify again.\n\n${fence(verification.output.trim().split('\n').slice(-60))}`))} busy={busy} />}
    {verification.output && <RawOutput output={verification.output} />}
  </section>

  const passed = steps.filter(item => item.status === 'passed').length
  const failures = steps.filter(item => item.status === 'failed' || item.status === 'cancelled')
  const warned = steps.filter(item => item.warnings.length > 0)
  const elapsed = (verification.elapsed ?? 0) + drift
  // Supervisor failures (source changed mid-run, say) arrive after every check passed.
  const stopped = verification.status === 'failed' && !failures.length
  const title = running ? `Running ${steps.find(item => item.status === 'running')?.name ?? 'checks'}…`
    : failures.length ? `${failures.length} ${failures.length === 1 ? 'check' : 'checks'} failed`
    : stopped ? 'Verification stopped'
    : warned.length ? 'Passed with warnings' : 'All checks passed for these exact changes'
  const tone = running ? 'text-accent' : failures.length || stopped ? 'text-danger' : warned.length ? 'text-warning' : 'text-success'
  return <section>
    {/* Full-bleed: the dialog is already the card, so the table runs edge to edge under the header. */}
    <div>
      <div className='sticky top-0 z-10 bg-surface'>
        <div className='flex items-center gap-3 py-2 pr-3 pl-5'>
          <p className={`min-w-0 flex-1 truncate text-body-sm font-medium ${tone}`}>{title}</p>
          <span className='shrink-0 font-mono text-label text-fg-3 tabular-nums'>{passed}/{steps.length} checks · {seconds(elapsed)}</span>
          <PillToggle label='Output view' value={showOutput ? 'raw' : 'pretty'} onChange={id => setShowOutput(id === 'raw')} options={[{ id: 'pretty', label: 'Pretty' }, { id: 'raw', label: 'Raw' }]} />
        </div>
        <Bar value={passed / steps.length} tone={failures.length || stopped ? 'danger' : running ? 'accent' : warned.length ? 'warning' : 'success'} className='h-0.5 rounded-none' />
        {!showOutput && <div className={`${COLUMNS} border-b border-border bg-muted/40 py-1.5 text-[11px] font-medium tracking-wide text-fg-3 uppercase`} aria-hidden>
          <span /><span>Check</span><span>Progress</span><span className='text-right'>Tests</span><span className='text-right'>Time</span>
        </div>}
      </div>
      {showOutput ? <pre className='bg-bg px-5 py-3 font-mono text-xs leading-5 whitespace-pre-wrap text-fg-2'>{verification.output.trim() || (running ? 'The complete output appears here when the run finishes. Each check keeps its own log.' : 'No output was recorded.')}</pre>
      : <ul className='divide-y divide-border/60' aria-label='Checks'>
        {steps.map(item => <StepRow key={item.id} item={item} drift={item.status === 'running' ? drift : 0} busy={busy} onAsk={onAskAgent && (() => onAskAgent(warningPrompt(item)))} />)}
      </ul>}
    </div>
    {(stopped || failures.length > 0) && <div className='space-y-4 border-t border-border px-5 py-4'>
    {stopped && <IssueCard tone='danger' title='Verification stopped' lines={verification.output.trim().split('\n').slice(-4)} busy={busy} />}
    {failures.map(item => <IssueCard key={item.id} tone='danger' title={`${item.name} ${item.status === 'cancelled' ? 'was cancelled' : 'failed'}`} command={item.command} lines={item.diagnostics} onAsk={onAskAgent && (() => onAskAgent(failurePrompt(item)))} busy={busy} />)}
    </div>}
  </section>
}

function StepRow({ item, drift, busy, onAsk }: { item: BuilderVerificationStep; drift: number; busy: boolean; onAsk?: () => Promise<void> }) {
  const elapsed = item.elapsed + drift
  const counted = item.progress?.total ? Math.min(1, item.progress.done / item.progress.total) : undefined
  // Test counts only arrive once files finish, so the time estimate carries the bar until then.
  const timed = item.expected ? Math.min(0.95, elapsed / item.expected) : undefined
  const value = item.status === 'passed' ? 1
    : item.status === 'running' ? (counted === undefined && timed === undefined ? undefined : Math.min(0.97, Math.max(counted ?? 0, timed ?? 0)))
    : item.status === 'failed' ? counted ?? 1 : 0
  const barTone = item.status === 'failed' || item.status === 'cancelled' ? 'danger' : item.status === 'running' ? 'accent' : item.warnings.length ? 'warning' : 'success'
  const count = item.progress ? `${item.progress.done.toLocaleString()}${item.progress.total ? `/${item.progress.total.toLocaleString()}` : ''} ${item.progress.unit}` : ''
  const muted = item.status === 'pending' || item.status === 'skipped'
  return <li className={`${COLUMNS} py-2.5 ${item.status === 'running' ? 'bg-accent/5' : ''}`}>
    <StepIcon item={item} />
    <span className={`flex min-w-0 items-center gap-2 text-body-sm ${muted ? 'text-fg-3' : 'text-text'}`} title={item.command}>
      <span className='truncate'>{item.name}</span>
      {item.warnings.length > 0 && <WarningPopover item={item} busy={busy} onAsk={onAsk} />}
      {item.cached && item.status === 'passed' && <Badge variant='success' size='sm' className='shrink-0'>cached</Badge>}
    </span>
    {item.status === 'skipped' ? <span className='text-label text-fg-4'>Not run</span> : <Bar value={value} tone={barTone} />}
    <span className='truncate text-right font-mono text-label text-fg-3 tabular-nums'>{count}</span>
    <span className='text-right font-mono text-label text-fg-3 tabular-nums'>{item.status === 'pending' || item.status === 'skipped' ? '' : seconds(elapsed)}</span>
  </li>
}

/** The triangle beside a check opens its warning lines, with the option to hand them to the agent. */
function WarningPopover({ item, busy, onAsk }: { item: BuilderVerificationStep; busy: boolean; onAsk?: () => Promise<void> }) {
  const label = `${item.warnings.length} ${item.warnings.length === 1 ? 'warning' : 'warnings'} in ${item.name}`
  return <Popover>
    <PopoverTrigger render={<button type='button' className='flex shrink-0 items-center gap-1 rounded px-1 text-[11px] font-medium text-warning transition-colors hover:bg-warning/10' aria-label={`Show ${label}`} />}>
      <AlertTriangle className='size-3.5' />{item.warnings.length}
    </PopoverTrigger>
    <PopoverContent align='start' className='w-[28rem] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0'>
      <header className='flex items-center gap-2.5 border-b border-border/60 px-3 py-2'>
        <AlertTriangle className='size-4 shrink-0 text-warning' />
        <div className='min-w-0 flex-1'>
          <p className='text-body-sm font-medium text-text'>{label}</p>
          <p className='truncate font-mono text-[11px] text-fg-3'>{item.command}</p>
        </div>
        {onAsk && <Button size='sm' variant='outline' disabled={busy} onClick={() => void onAsk()}><Sparkles />Ask Agent to Fix</Button>}
      </header>
      <ul className='max-h-60 space-y-1 overflow-auto bg-bg/60 px-3 py-2 font-mono text-xs leading-5 text-fg-2'>
        {item.warnings.map((line, index) => <li key={index} className='break-words whitespace-pre-wrap'>{line}</li>)}
      </ul>
    </PopoverContent>
  </Popover>
}

function StepIcon({ item }: { item: BuilderVerificationStep }) {
  if (item.status === 'running') return <LoaderCircle className='size-4 animate-spin text-accent' aria-label='Running' />
  if (item.status === 'passed') return <span className={`flex size-4 items-center justify-center rounded-full ${item.warnings.length ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`} aria-label='Passed'><Check className='size-3' /></span>
  if (item.status === 'failed' || item.status === 'cancelled') return <span className='flex size-4 items-center justify-center rounded-full bg-danger/15 text-danger' aria-label={item.status === 'failed' ? 'Failed' : 'Cancelled'}><X className='size-3' /></span>
  if (item.status === 'skipped') return <Minus className='size-4 text-fg-4' aria-label='Not run' />
  return <Circle className='size-4 text-fg-4' aria-label='Queued' />
}

/** `value` in 0..1; undefined draws an indeterminate bar. */
function Bar({ value, tone, className = '' }: { value: number | undefined; tone: 'accent' | 'success' | 'warning' | 'danger'; className?: string }) {
  const fill = { accent: 'bg-accent', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone]
  return <div className={`h-1.5 overflow-hidden rounded-full bg-muted ${className}`} role='progressbar' aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === undefined ? undefined : Math.round(value * 100)}>
    {value === undefined
      ? <div className={`h-full w-full animate-pulse ${fill} opacity-50`} />
      : <div className={`h-full ${fill} transition-[width] duration-500 ease-out`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />}
  </div>
}

function IssueCard({ tone, title, command, lines, onAsk, busy }: {
  tone: 'danger' | 'warning'
  title: string
  command?: string
  lines: string[]
  onAsk?: () => Promise<void>
  busy: boolean
}) {
  const colours = tone === 'danger' ? 'border-danger/30 bg-danger-bg/40' : 'border-warning/30 bg-warning/5'
  const Icon = tone === 'danger' ? AlertCircle : AlertTriangle
  return <article className={`overflow-hidden rounded-lg border ${colours}`}>
    <header className='flex items-center gap-2.5 px-3 py-2'>
      <Icon className={`size-4 shrink-0 ${tone === 'danger' ? 'text-danger' : 'text-warning'}`} />
      <div className='min-w-0 flex-1'>
        <p className='text-body-sm font-medium text-text'>{title}</p>
        {command && <p className='truncate font-mono text-[11px] text-fg-3'>{command}</p>}
      </div>
      {onAsk && <Button size='sm' variant='outline' disabled={busy} onClick={() => void onAsk()}><Sparkles />Ask Agent to Fix</Button>}
    </header>
    {lines.length > 0 && <ul className='max-h-48 space-y-1 overflow-auto border-t border-border/60 bg-bg/60 px-3 py-2 font-mono text-xs leading-5 text-fg-2'>
      {lines.map((line, index) => <li key={index} className='break-words whitespace-pre-wrap'>{line}</li>)}
    </ul>}
  </article>
}

function RawOutput({ output }: { output: string }) {
  return <details className='rounded-lg border border-border'>
    <summary className='cursor-pointer px-3 py-2 text-label text-fg-3'>Full output</summary>
    <pre className='max-h-72 overflow-auto border-t border-border p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-fg-3'>{output}</pre>
  </details>
}

// Porcelain status to one letter and colour: added, deleted, renamed, otherwise modified.
function fileStatus(status: string): { letter: string; title: string; tone: string } {
  const code = status === '??' ? 'A' : status.trim().charAt(0) || 'M'
  if (code === 'A') return { letter: 'A', title: 'Added', tone: 'bg-success/15 text-success' }
  if (code === 'D') return { letter: 'D', title: 'Deleted', tone: 'bg-danger/15 text-danger' }
  if (code === 'R') return { letter: 'R', title: 'Renamed', tone: 'bg-info/15 text-info' }
  return { letter: code, title: 'Modified', tone: 'bg-accent/15 text-accent' }
}

/** What changed, full-bleed like the Verify table: a files/diff pill switches the view. */
function ReviewStep({ data, onOpenFile }: { data: BuilderReviewState; onOpenFile: (path: string) => void }) {
  const { review } = data
  const [view, setView] = useState<'files' | 'diff'>('files')
  const lines = review.diff.split('\n')
  const empty = review.files.length === 0 && review.commits.length === 0
  return <section>
    <div className='sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface py-2 pr-3 pl-5'>
      <p className='flex min-w-0 flex-1 items-center gap-1.5 text-label'>
        <GitBranch className='size-3.5 shrink-0 text-accent' />
        <code className='truncate'>{review.branch}</code><span className='text-fg-4'>→</span><code className='truncate'>{review.targetBranch ?? 'no integration branch'}</code>
      </p>
      <span className='shrink-0 font-mono text-label text-fg-3 tabular-nums'>
        {review.files.length} {review.files.length === 1 ? 'file' : 'files'}{review.commits.length ? ` · ${review.commits.length} ${review.commits.length === 1 ? 'checkpoint' : 'checkpoints'}` : ''}
      </span>
      <PillToggle label='Review view' value={view} onChange={setView} options={[{ id: 'files', label: 'Files', disabled: empty }, { id: 'diff', label: 'Diff', disabled: empty || !review.diff }]} />
    </div>
    {empty ? <StateScreen icon={Check} tone='muted' title='Nothing to wrap up' detail='No source changes since this session began.' />
      : view === 'diff' ? <>
          <pre className='bg-bg px-5 py-3 font-mono text-xs leading-5'>{lines.slice(0, DIFF_LINES).map((line, i) => <div key={i} className={line.startsWith('+') ? 'text-success' : line.startsWith('-') ? 'text-danger' : line.startsWith('@@') ? 'text-accent' : 'text-fg-2'}>{line || ' '}</div>)}</pre>
          {(review.truncated || lines.length > DIFF_LINES) && <p className='border-t border-border px-5 py-2 text-label text-warning'>The diff preview is truncated. Inspect the complete changes in Files or your Git tools.</p>}
        </>
      : <>
          {review.files.length > 0 && <ul className='divide-y divide-border/60' aria-label='Changed files'>
            {review.files.map(file => {
              const status = fileStatus(file.status)
              const slash = file.path.lastIndexOf('/')
              return <li key={file.path}>
                <button type='button' onClick={() => onOpenFile(file.path)} title='Open in Files' className='flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-surface-hover'>
                  <span className={`flex size-5 shrink-0 items-center justify-center rounded font-mono text-[11px] font-medium ${status.tone}`} title={status.title}>{status.letter}</span>
                  <span className='min-w-0 truncate font-mono text-label'><span className='text-fg-3'>{file.path.slice(0, slash + 1)}</span><span className='text-text'>{file.path.slice(slash + 1)}</span></span>
                </button>
              </li>
            })}
          </ul>}
          {review.commits.length > 0 && <>
            <div className='border-y border-border bg-muted/40 px-5 py-1.5 text-[11px] font-medium tracking-wide text-fg-3 uppercase'>Checkpoints already saved</div>
            <ul className='divide-y divide-border/60'>{review.commits.map(commit => <li key={commit.sha} className='flex gap-3 px-5 py-2 text-label'><code className='shrink-0 text-fg-4'>{commit.sha.slice(0, 7)}</code><span className='truncate text-fg-2'>{commit.message}</span></li>)}</ul>
          </>}
        </>}
  </section>
}

/** Two or more mutually exclusive views, as one rounded pill. */
function PillToggle<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (id: T) => void; options: { id: T; label: string; disabled?: boolean }[] }) {
  return <div className='flex shrink-0 rounded-full border border-border p-0.5' role='group' aria-label={label}>
    {options.map(option => <button key={option.id} type='button' aria-pressed={value === option.id} disabled={option.disabled} onClick={() => onChange(option.id)}
      className={`rounded-full px-3 py-0.5 text-label font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${value === option.id ? 'bg-accent/15 text-accent' : 'text-fg-3 hover:text-text'}`}>
      {option.label}
    </button>)}
  </div>
}

/** A centred empty or waiting state: icon, title, one line of detail. */
function StateScreen({ icon: Icon, tone, title, detail }: { icon: typeof Check; tone: 'accent' | 'warning' | 'muted'; title: string; detail: string }) {
  const colours = { accent: 'bg-accent/10 text-accent', warning: 'bg-warning/10 text-warning', muted: 'bg-muted text-fg-3' }[tone]
  return <div className='flex min-h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center'>
    <span className={`flex size-12 items-center justify-center rounded-full ${colours}`}><Icon className='size-6' /></span>
    <p className='text-body font-medium text-text'>{title}</p>
    <p className='max-w-sm text-body-sm text-fg-3'>{detail}</p>
  </div>
}

function StatusLine({ tone, title, children }: { tone: 'success' | 'danger' | 'running' | 'neutral'; title: string; children?: ReactNode }) {
  const colour = tone === 'success' ? 'bg-success/10 text-success' : tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'
  return <div className='flex items-center gap-3'>
    <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${colour}`}>{tone === 'danger' ? <AlertCircle className='size-4' /> : tone === 'running' ? <RefreshCw className='size-4 animate-spin' /> : tone === 'success' ? <Check className='size-4' /> : <ArrowRight className='size-4' />}</span>
    <p className='text-body-sm font-medium'>{title}</p>
    {children}
  </div>
}
