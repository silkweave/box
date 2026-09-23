import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, confirm } from '@silkweave/box-ui'
import { CheckCircle2, GitBranch, RefreshCw, Save } from 'lucide-react'
import { checkpointBuilderReview, finishBuilderReview, loadBuilderReview, verifyBuilderReview, type BuilderControlState, type BuilderReviewState } from '../../lib/builderStore.ts'

export function BuilderReview({ state, unsaved, onUpdated, onOpenFile, onFinished }: {
  state: BuilderControlState; unsaved: boolean
  onUpdated: () => Promise<void>; onOpenFile: (path: string) => void; onFinished: () => void
}) {
  const [data, setData] = useState<BuilderReviewState>()
  const [error, setError] = useState<string>()
  const [action, setAction] = useState<string>()
  const [message, setMessage] = useState('')
  const polling = useRef(false)
  const refresh = useCallback(async () => {
    if (polling.current) return
    polling.current = true
    try { setData(await loadBuilderReview()) }
    catch (error) { setError(error instanceof Error ? error.message : 'Review unavailable') }
    finally { polling.current = false }
  }, [])
  useEffect(() => { if (!state.session) return; void refresh(); const t=setInterval(() => void refresh(), 5000); return () => clearInterval(t) }, [refresh, state.session?.id])
  const run = async (name: string, operation: () => Promise<unknown>): Promise<void> => {
    setAction(name); setError(undefined)
    try { await operation(); await refresh(); await onUpdated() }
    catch (error) { setError(error instanceof Error ? error.message : `${name} failed`) }
    finally { setAction(undefined) }
  }
  if (!state.session) return <div className='p-6 text-body-sm text-fg-3'>Start a Builder session to review its changes.</div>
  const verification = data?.verification
  const verified = verification?.status === 'passed' && verification.fingerprint === data?.review.fingerprint
  const locked = unsaved || !!action || verification?.status === 'running'
  const checkpoint = async (): Promise<void> => {
    if (!data || !message.trim()) return
    if (!await confirm({ title: 'Save checkpoint?', message: 'Commit the reviewed changes on the Builder branch. The shared session stays open.', confirmLabel: 'Save checkpoint' })) return
    await run('Saving checkpoint', () => checkpointBuilderReview(data.review.fingerprint, message))
  }
  const finish = async (): Promise<void> => {
    if (!data || !verified || !message.trim()) return
    if (!await confirm({ title: 'Finish and integrate?', message: `Commit pending reviewed changes and fast-forward ${data.review.targetBranch ?? 'the target branch'}, then end Builder after a healthy application restart. Changes are already live. ${verification?.warnings ? 'Verification passed with warnings; review the output before continuing.' : ''}`, confirmLabel: 'Finish & integrate' })) return
    await run('Finishing', async () => { await finishBuilderReview(data.review.fingerprint, message); onFinished() })
  }
  const verifying = action === 'Verifying' || verification?.status === 'running'
  return <div className='flex min-h-0 flex-1 flex-col'>
    <div className='min-h-0 flex-1 overflow-auto p-5 md:p-8'>
      <div className='mx-auto max-w-5xl space-y-6'>
        <div className='flex flex-wrap items-start justify-between gap-3'><div><p className='text-xs uppercase tracking-widest text-accent'>Make it yours</p><h2 className='mt-2 text-2xl font-semibold'>Review and finish</h2><p className='mt-2 text-body-sm text-fg-3'>Inspect what changed, check the current files, then save your work.</p></div><Button variant='ghost' onClick={() => void refresh()}><RefreshCw />Refresh review</Button></div>
        {error && <p role='alert' className='rounded-lg border border-danger/30 bg-danger-bg p-3 text-body-sm text-danger'>{error}</p>}
        {unsaved && <p className='text-body-sm text-warning'>Save or discard open editor changes before verifying or committing.</p>}
        {!data ? <p className='text-fg-3'>Reading changes…</p> : <>
          <div className='flex flex-wrap items-center gap-3 text-label'><GitBranch className='size-4 text-accent' /><code>{data.review.branch}</code><span className='text-fg-3'>→</span><code>{data.review.targetBranch ?? 'No integration branch'}</code><Badge variant={verified ? 'success' : 'neutral'}>{verified ? 'Verified current changes' : verifying ? 'Checking…' : 'Verification needed'}</Badge></div>
          <section className='overflow-hidden rounded-xl border border-border'><div className='border-b border-border bg-surface px-4 py-3 text-body-sm font-medium'>{data.review.files.length} changed files · {data.review.commits.length} checkpoints</div>
            <div className='max-h-52 overflow-auto'>{data.review.files.length ? data.review.files.map(file => <button key={file.path} className='flex w-full gap-3 border-b border-border/40 px-4 py-2 text-left font-mono text-label hover:bg-surface' onClick={() => onOpenFile(`${state.session!.cwd}/${file.path}`)}><span className='w-8 text-accent'>{file.status}</span><span className='truncate'>{file.path}</span></button>) : <p className='p-4 text-body-sm text-fg-3'>No source changes since this session began.</p>}</div>
            <details className='border-t border-border p-4'><summary className='cursor-pointer text-body-sm'>View diff</summary><pre className='mt-4 max-h-[32rem] overflow-auto text-xs leading-5'>{data.review.diff.split('\n').slice(0,2500).map((line,i)=><div key={i} className={line.startsWith('+') ? 'text-success' : line.startsWith('-') ? 'text-danger' : line.startsWith('@@') ? 'text-accent' : 'text-fg-2'}>{line || ' '}</div>)}</pre>{(data.review.truncated || data.review.diff.split('\n').length > 2500) && <p className='mt-2 text-label text-warning'>Diff preview is truncated. Inspect the complete changes in your local Git tools before finishing.</p>}</details>
          </section>
          <section className='overflow-hidden rounded-xl border border-border bg-surface/40'>
            <div className='flex flex-wrap items-center gap-4 p-4'>
              <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${verified ? 'bg-success/10 text-success' : verification?.status === 'failed' ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}><CheckCircle2 className={`size-5 ${verifying ? 'animate-pulse' : ''}`} /></div>
              <div className='min-w-52 flex-1'><h3 className='font-medium'>Verify changes</h3><p className='mt-1 text-label text-fg-3'>{verified ? 'Checks passed for the current Git state.' : verification?.status === 'failed' ? 'Checks failed. Review the output and fix the reported issues.' : verifying ? 'Running the complete validation chain…' : 'Run the complete validation chain for this exact Git state.'}</p></div>
              <Button variant={verified ? 'ghost' : 'secondary'} disabled={locked} onClick={() => void run('Verifying', () => verifyBuilderReview(data.review.fingerprint))}><RefreshCw className={verifying ? 'animate-spin' : ''} />{verified ? 'Verify again' : verifying ? 'Checking…' : 'Verify changes'}</Button>
            </div>
            {verification && <div className='border-t border-border bg-bg/60 px-4 py-3'>
              <div className={`mb-2 text-label font-medium ${verification.status === 'failed' ? 'text-danger' : verification.status === 'passed' ? 'text-success' : 'text-fg-3'}`}>{verification.status === 'running' ? 'Verification output' : verification.status === 'passed' ? `Passed${verification.warnings ? ' with warnings' : ''}` : 'Failed'}{verification.fingerprint !== data.review.fingerprint ? ' · source changed since this check' : ''}</div>
              <pre className='max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-fg-3'>{verification.output || (verifying ? 'Waiting for check output…' : 'No output was recorded.')}</pre>
            </div>}
          </section>
        </>}
      </div>
    </div>
    {data && <footer className='shrink-0 border-t border-border bg-bg/95 px-5 py-4 backdrop-blur md:px-8'>
      <div className='mx-auto flex max-w-5xl items-end gap-4'>
        <label className='min-w-0 flex-1 text-label font-medium text-fg-2' htmlFor='builder-commit-message'>Commit message
          <input id='builder-commit-message' value={message} onChange={e=>setMessage(e.target.value)} maxLength={1000} placeholder='What changed and why?' className='mt-1.5 w-full rounded-lg border border-border bg-bg px-3 py-2 text-body-sm font-normal text-text' />
        </label>
        <div className='flex shrink-0 items-center gap-3'>
          {action && <span role='status' className='text-label text-accent'>{action}…</span>}
          <Button variant='secondary' disabled={locked || !message.trim()} onClick={() => void checkpoint()}><Save />Save Checkpoint</Button>
          <Button disabled={locked || !verified || !data.review.targetBranch || !message.trim()} onClick={() => void finish()}>Finish and Integrate</Button>
        </div>
      </div>
    </footer>}
  </div>
}
