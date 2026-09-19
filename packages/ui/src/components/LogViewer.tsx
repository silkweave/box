import { CheckCircle2, CircleSlash, Clock, Loader2, Terminal, XCircle } from 'lucide-react'
import { cn } from '../lib/utils.ts'

/*
 * A terminal-styled pane that draws a sequence of lines, and the status chip that goes with it.
 *
 * This was `RunLog` until 2026-09-14, and it was the package's worst contract breach: it exported a
 * `Progress` interface whose own comment admitted it "mirrors @silkweave/box-core IngestProgress" -
 * a SERVER WIRE TYPE, with `channel` and `phase: 'start'|'fetch'|'persist'|'done'`, living in the
 * design system. It reached into `result.summary` to decide what to print, and its status vocabulary
 * ('done' vs 'success' vs 'skipped') was the ops console's, not a UI concept.
 *
 * What it actually draws is lines of text, some of which are emphasised. So that is what it takes.
 * Mapping a run, a deploy, a build or an SSE stream onto `LogLine[]` is the caller's job.
 */

/** A line of output. `tone` is emphasis, not meaning - the caller decides what deserves it. */
export interface LogLine {
  text: string
  tone?: 'default' | 'muted' | 'accent' | 'danger'
}

const TONE: Record<NonNullable<LogLine['tone']>, string> = {
  default: '',
  muted: 'text-muted-foreground',
  accent: 'text-accent',
  danger: 'text-destructive',
}

/**
 * How a status READS, not what it means. `busy` spins, `success` is green, `error` is red - and a
 * caller with a vocabulary of its own ("skipped", "partial", "cancelled") picks the tone that fits
 * and passes its own word as the label.
 */
export type StatusTone = 'pending' | 'busy' | 'neutral' | 'success' | 'error'

const TONE_BADGE: Record<StatusTone, { icon: typeof Loader2; cls: string; spin?: boolean }> = {
  pending: { icon: Clock, cls: 'text-muted-foreground' },
  busy: { icon: Loader2, cls: 'text-accent', spin: true },
  neutral: { icon: CircleSlash, cls: 'text-muted-foreground' },
  success: { icon: CheckCircle2, cls: 'text-success' },
  error: { icon: XCircle, cls: 'text-destructive' },
}

/** Icon + word. The word is the caller's - the badge supplies the shape and the colour. */
export function StatusBadge({ tone, label }: { tone: StatusTone | null; label: string }) {
  if (!tone) return null
  const b = TONE_BADGE[tone]
  const Icon = b.icon
  return (
    <span className={cn('inline-flex items-center gap-1 text-label', b.cls)}>
      <Icon className={cn('size-3', b.spin && 'animate-spin')} /> {label}
    </span>
  )
}

interface LogViewerProps {
  /** Header title. Falls back to "Output". */
  title?: string | null
  /** Status chip beside the title. Both halves are required together, or omit the pair. */
  status?: { tone: StatusTone; label: string } | null
  lines: LogLine[]
  /** What to say when there is nothing yet. Required - the library does not know your verb. */
  emptyNote: string
  /** Counted in the header, e.g. `(n) => \`${n} steps\``. Defaults to a bare count. */
  countLabel?: (count: number) => string
  /** Scroll anchor, so the caller owns the follow-the-tail behaviour. */
  endRef?: React.RefObject<HTMLDivElement | null>
  className?: string
}

export function LogViewer({
  title,
  status,
  lines,
  emptyNote,
  countLabel = (n) => String(n),
  endRef,
  className,
}: LogViewerProps) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface',
        className,
      )}>
      <header className='flex items-center gap-2 border-b border-border px-4 py-2.5 text-body-sm'>
        <Terminal className='size-4 text-muted-foreground' />
        <span className='font-medium text-text'>{title ?? 'Output'}</span>
        {status ? <StatusBadge tone={status.tone} label={status.label} /> : null}
        <span className='ml-auto text-label text-muted-foreground tabular-nums'>{countLabel(lines.length)}</span>
      </header>
      <div className='min-h-[12rem] flex-1 overflow-y-auto bg-bg px-4 py-3 font-mono text-label leading-relaxed'>
        {lines.length === 0 ? (
          <p className='text-muted-foreground'>{emptyNote}</p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={cn('whitespace-pre-wrap break-words', TONE[l.tone ?? 'default'])}>
              {l.text}
            </div>
          ))
        )}
        {endRef && <div ref={endRef} />}
      </div>
    </section>
  )
}
