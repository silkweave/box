import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Circle, ListChecks, LoaderCircle } from 'lucide-react'
import type { BuilderTask, BuilderTaskPlan } from '../../lib/builderStore.ts'

const MINUTE = 60_000

/** "about 12 min", "about 1 h 20 min". */
export function formatMinutes(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes))
  if (rounded < 60) return `${rounded} min`
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/**
 * Time left on a plan: the estimates of every task not done, less what the running task has used
 * (it never counts below one minute while it runs). Null when no open task carries an estimate.
 */
export function remainingMinutes(tasks: readonly BuilderTask[], now: number): number | null {
  const open = tasks.filter(task => task.status !== 'done')
  if (!open.some(task => task.estimateMinutes !== undefined)) return null
  return open.reduce((sum, task) => {
    const estimate = task.estimateMinutes ?? 0
    if (task.status !== 'running' || !task.startedAt) return sum + estimate
    const used = (now - Date.parse(task.startedAt)) / MINUTE
    return sum + Math.max(estimate ? 1 : 0, estimate - used)
  }, 0)
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

const statusIcon = (task: BuilderTask) =>
  task.status === 'done' ? <Check className='size-3.5 text-success' aria-label='Done' />
    : task.status === 'running' ? <LoaderCircle className='size-3.5 animate-spin text-accent' aria-label='Running' />
    : <Circle className='size-3.5 text-fg-4' aria-label='Pending' />

/**
 * The agent's task plan, pinned above the Builder conversation: the task now running, progress,
 * time elapsed since the plan arrived and the time the open estimates leave. Expands to the list.
 * The agent sends and re-sends it with `box builder tasks`.
 */
export function BuilderTasks({ plan }: { plan: BuilderTaskPlan }) {
  const [open, setOpen] = useState(false)
  const now = useNow(30_000)
  const done = plan.tasks.filter(task => task.status === 'done').length
  const total = plan.tasks.length
  const running = plan.tasks.find(task => task.status === 'running')
  const allDone = done === total
  const elapsed = (now - Date.parse(plan.startedAt)) / MINUTE
  const finishedAt = allDone ? Math.max(...plan.tasks.map(task => (task.doneAt ? Date.parse(task.doneAt) : 0))) : 0
  const left = remainingMinutes(plan.tasks, now)
  const headline = allDone ? 'All tasks done' : running ? running.title : `${total - done} tasks left`
  const timing = allDone
    ? `took ${formatMinutes(((finishedAt || now) - Date.parse(plan.startedAt)) / MINUTE)}`
    : `${formatMinutes(elapsed)} elapsed${left !== null ? ` · about ${formatMinutes(left)} left` : ''}`
  return (
    <section aria-label='Session tasks' className='mx-2 mb-2 shrink-0 rounded-lg border border-border bg-bg'>
      <button type='button' onClick={() => setOpen(value => !value)} aria-expanded={open} className='flex w-full items-center gap-2 px-3 py-2 text-left'>
        <ListChecks className={`size-4 shrink-0 ${allDone ? 'text-success' : 'text-accent'}`} />
        <span className='min-w-0 flex-1'>
          <span className='flex items-baseline gap-2'>
            <span className='truncate text-label font-medium text-text'>{headline}</span>
            <span className='ml-auto shrink-0 text-label tabular-nums text-fg-3'>{done}/{total}</span>
          </span>
          <span className='mt-1 block h-1 overflow-hidden rounded-full bg-muted' role='progressbar' aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label='Tasks done'>
            <span className={`block h-full rounded-full transition-[width] ${allDone ? 'bg-success' : 'bg-accent'}`} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </span>
          <span className='mt-1 block text-xs tabular-nums text-fg-3'>{timing}</span>
        </span>
        {open ? <ChevronDown className='size-3.5 shrink-0 text-fg-4' /> : <ChevronRight className='size-3.5 shrink-0 text-fg-4' />}
      </button>
      {open && (
        <ol className='max-h-56 overflow-y-auto border-t border-border/60 px-3 py-1.5'>
          {plan.tasks.map(task => (
            <li key={task.title} className='flex items-center gap-2 py-0.5 text-label'>
              {statusIcon(task)}
              <span className={`min-w-0 flex-1 truncate ${task.status === 'done' ? 'text-fg-3' : 'text-fg-1'}`}>{task.title}</span>
              {task.estimateMinutes !== undefined && <span className='shrink-0 tabular-nums text-fg-4'>{formatMinutes(task.estimateMinutes)}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
