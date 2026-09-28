import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@silkweave/box-ui'
import { AlertCircle, ArrowLeft, ArrowRight, Check, GitBranch, MessageSquareText, RefreshCw, Save } from 'lucide-react'
import { checkpointBuilderReview, finishBuilderReview, loadBuilderReview, verifyBuilderReview, type BuilderReviewState } from '../../lib/builderStore.ts'

/**
 * Wrap Up: the one guided path from "the Builder changed things" to "it is committed and live".
 * Review what changed, verify that exact Git state, then commit and integrate. Every step reads
 * the server's review fingerprint, so a file changed after a check sends the owner back to verify.
 */
type Step = 'review' | 'verify' | 'commit'
const STEPS: readonly { id: Step; label: string }[] = [
  { id: 'review', label: 'Review changes' },
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
  /** Put a prompt into the Builder composer (not sent). Absent until the session panel is ready. */
  onAskAgent?: (text: string) => void
}) {
  const [step, setStep] = useState<Step>('review')
  const [data, setData] = useState<BuilderReviewState>()
  const [error, setError] = useState<string>()
  const [action, setAction] = useState<string>()
  const [message, setMessage] = useState('')
  const [done, setDone] = useState<string>()
  const polling = useRef(false)
  const output = useRef<HTMLPreElement>(null)
  const refresh = useCallback(async () => {
    if (polling.current) return
    polling.current = true
    try { setData(await loadBuilderReview()); setError(undefined) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Review unavailable') }
    finally { polling.current = false }
  }, [])
  const running = data?.verification?.status === 'running'
  useEffect(() => {
    if (!open) return
    void refresh()
    const timer = setInterval(() => void refresh(), running ? 1500 : 5000)
    return () => clearInterval(timer)
  }, [open, refresh, running])
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
  // Follow the live output like a terminal while the chain runs.
  useEffect(() => { if (running && output.current) output.current.scrollTop = output.current.scrollHeight }, [running, verification?.output])
  const current = !!verification && verification.fingerprint === review?.fingerprint
  const verified = current && verification.status === 'passed'
  const failed = current && verification.status === 'failed'
  const stale = !!verification && !current && verification.status !== 'running'
  const hasWork = !!review && (review.files.length > 0 || review.commits.length > 0)
  const busy = !!action || running
  const reached = (id: Step): boolean => id === 'review' || (id === 'verify' && hasWork) || (id === 'commit' && hasWork && verified)

  const verify = (): Promise<boolean> => run('Starting checks', () => verifyBuilderReview(review!.fingerprint))
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
  const askAgent = (): void => {
    if (!onAskAgent || !verification) return
    const tail = verification.output.split('\n').slice(-60).join('\n')
    onAskAgent(`The Wrap Up checks failed. Fix the reported issues, keep unrelated behaviour unchanged, and tell me when it is ready to verify again.\n\n\`\`\`\n${tail}\n\`\`\``)
    onOpenChange(false)
  }

  return <Dialog open={open} onOpenChange={next => { if (!action) onOpenChange(next) }}>
    <DialogContent className='max-h-[90dvh] max-w-3xl gap-0 p-0'>
      <div className='border-b border-border px-6 pt-5 pb-4'>
        <DialogTitle>Wrap up</DialogTitle>
        <DialogDescription className='mt-1'>Review what changed, check it, then commit it to {review?.targetBranch ? <code>{review.targetBranch}</code> : 'the Box'}.</DialogDescription>
        <ol className='mt-4 flex items-center gap-2' aria-label='Wrap up steps'>
          {STEPS.map((item, index) => {
            const active = item.id === step
            const complete = STEPS.findIndex(s => s.id === step) > index
            return <li key={item.id} className='flex items-center gap-2'>
              {index > 0 && <span className='h-px w-6 bg-border' aria-hidden />}
              <button type='button' disabled={!reached(item.id) || busy} onClick={() => setStep(item.id)} aria-current={active ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-label font-medium transition-colors disabled:cursor-not-allowed ${active ? 'bg-accent/15 text-accent' : complete ? 'text-text hover:bg-surface-hover' : 'text-fg-3'}`}>
                <span className={`flex size-5 items-center justify-center rounded-full text-[11px] ${active ? 'bg-accent text-white' : complete ? 'bg-success/15 text-success' : 'bg-muted text-fg-3'}`}>{complete ? <Check className='size-3' /> : index + 1}</span>
                {item.label}
              </button>
            </li>
          })}
        </ol>
      </div>

      <div className='min-h-0 flex-1 overflow-auto px-6 py-5'>
        {error && <p role='alert' className='mb-4 rounded-lg border border-danger/30 bg-danger-bg p-3 text-body-sm text-danger'>{error}</p>}
        {unsaved && <p className='mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-body-sm text-warning'>An editor tab in Files has unsaved changes. Save or discard them first: checks and commits use the files on disk.</p>}
        {!review ? <p className='text-body-sm text-fg-3'>Reading changes…</p>
          : step === 'review' ? <ReviewStep data={data!} onOpenFile={path => { onOpenChange(false); onOpenFile(`${cwd}/${path}`) }} />
          : step === 'verify' ? <section className='space-y-4'>
              <StatusLine tone={verified ? 'success' : failed ? 'danger' : running ? 'running' : 'neutral'} title={verified ? 'Checks passed for these exact changes.' : running ? 'Running the complete validation chain…' : failed ? 'Checks failed.' : stale ? 'Files changed after the last check. Run the checks again.' : 'Run the complete validation chain: build, types, lint, tests and schema.'}>
                {verified && verification.warnings && <Badge variant='warning'>With warnings</Badge>}
              </StatusLine>
              {failed && <p className='text-body-sm text-fg-3'>Ask the Builder to fix what the output reports, then run the checks again.</p>}
              {verification && <pre ref={output} className='max-h-80 overflow-auto rounded-lg border border-border bg-bg p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-fg-3'>{verification.output || (running ? 'Waiting for output…' : 'No output was recorded.')}</pre>}
            </section>
          : <section className='space-y-4'>
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

      <footer className='flex items-center gap-3 border-t border-border px-6 py-4'>
        {step !== 'review' && <Button variant='ghost' disabled={busy} onClick={() => setStep(step === 'commit' ? 'verify' : 'review')}><ArrowLeft />Back</Button>}
        {action && <span role='status' className='text-label text-accent'>{action}…</span>}
        <div className='ml-auto flex items-center gap-2'>
          {step === 'review' && <>
            <Button variant='ghost' disabled={busy} onClick={() => void refresh()}><RefreshCw />Refresh</Button>
            <Button disabled={!hasWork || busy} onClick={() => { setStep('verify'); if (!verified && !running && !unsaved) void verify() }}>{verified ? 'Next' : 'Verify'}<ArrowRight /></Button>
          </>}
          {step === 'verify' && <>
            {failed && onAskAgent && <Button variant='secondary' disabled={busy} onClick={askAgent}><MessageSquareText />Ask Builder to fix</Button>}
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

function ReviewStep({ data, onOpenFile }: { data: BuilderReviewState; onOpenFile: (path: string) => void }) {
  const { review } = data
  const lines = review.diff.split('\n')
  return <section className='space-y-4'>
    <div className='flex flex-wrap items-center gap-2 text-label'>
      <GitBranch className='size-4 text-accent' /><code>{review.branch}</code><span className='text-fg-3'>→</span><code>{review.targetBranch ?? 'no integration branch'}</code>
    </div>
    {review.files.length === 0 && review.commits.length === 0
      ? <p className='text-body-sm text-fg-3'>Nothing to wrap up: no source changes since this session began.</p>
      : <>
          <p className='text-body-sm text-fg-3'>{review.files.length} changed {review.files.length === 1 ? 'file' : 'files'}{review.commits.length ? ` · ${review.commits.length} ${review.commits.length === 1 ? 'checkpoint' : 'checkpoints'} already saved` : ''}. Select a file to open it in Files.</p>
          {review.files.length > 0 && <div className='max-h-56 overflow-auto rounded-lg border border-border'>
            {review.files.map(file => <button type='button' key={file.path} onClick={() => onOpenFile(file.path)} className='flex w-full gap-3 border-b border-border/40 px-3 py-1.5 text-left font-mono text-label last:border-b-0 hover:bg-surface-hover'>
              <span className='w-6 shrink-0 text-accent' title={file.status === '??' ? 'New file' : undefined}>{file.status === '??' ? 'A' : file.status}</span><span className='truncate'>{file.path}</span>
            </button>)}
          </div>}
          {review.commits.length > 0 && <ul className='space-y-1 text-label text-fg-3'>{review.commits.map(commit => <li key={commit.sha} className='truncate'><code className='text-fg-4'>{commit.sha.slice(0, 7)}</code> {commit.message}</li>)}</ul>}
          {review.diff && <details className='rounded-lg border border-border'>
            <summary className='cursor-pointer px-3 py-2 text-body-sm'>View diff</summary>
            <pre className='max-h-96 overflow-auto border-t border-border p-3 text-xs leading-5'>{lines.slice(0, DIFF_LINES).map((line, i) => <div key={i} className={line.startsWith('+') ? 'text-success' : line.startsWith('-') ? 'text-danger' : line.startsWith('@@') ? 'text-accent' : 'text-fg-2'}>{line || ' '}</div>)}</pre>
            {(review.truncated || lines.length > DIFF_LINES) && <p className='border-t border-border px-3 py-2 text-label text-warning'>The diff preview is truncated. Inspect the complete changes in Files or your Git tools.</p>}
          </details>}
        </>}
  </section>
}

function StatusLine({ tone, title, children }: { tone: 'success' | 'danger' | 'running' | 'neutral'; title: string; children?: ReactNode }) {
  const colour = tone === 'success' ? 'bg-success/10 text-success' : tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'
  return <div className='flex items-center gap-3'>
    <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${colour}`}>{tone === 'danger' ? <AlertCircle className='size-4' /> : tone === 'running' ? <RefreshCw className='size-4 animate-spin' /> : tone === 'success' ? <Check className='size-4' /> : <ArrowRight className='size-4' />}</span>
    <p className='text-body-sm font-medium'>{title}</p>
    {children}
  </div>
}
