import { LogViewer, StatusBadge, type LogLine, type StatusTone } from '@silkweave/box-ui'
import type { ProgressChunk } from './useRuns.ts'

/**
 * The ops vocabulary, and how it maps onto the library's log viewer.
 *
 * `@silkweave/box-ui` used to own all of this: it exported a `Progress` interface that (by its own
 * admission) mirrored `@silkweave/box-core`'s `IngestProgress`, reached into `result.summary` to
 * decide what to print, and carried a status union - `done` vs `success` vs `skipped` - that is
 * this console's language, not a UI concept. A design system cannot hold a server wire type.
 *
 * So the wire type stays where it belongs (`ProgressChunk` in ./useRuns.ts), and this module is the
 * adapter: our statuses become a tone plus OUR word, and our chunks become plain lines.
 */

export type RunStatus = 'queued' | 'running' | 'done' | 'success' | 'error' | 'skipped'

const STATUS: Record<RunStatus, { tone: StatusTone; label: string }> = {
  queued: { tone: 'pending', label: 'queued' },
  running: { tone: 'busy', label: 'running' },
  done: { tone: 'neutral', label: 'done' },
  success: { tone: 'success', label: 'success' },
  error: { tone: 'error', label: 'error' },
  skipped: { tone: 'neutral', label: 'skipped' },
}

export function RunStatusBadge({ status }: { status: RunStatus | null }) {
  if (!status) return null
  const s = STATUS[status]
  return <StatusBadge tone={s.tone} label={s.label} />
}

/**
 * Flatten progress chunks into lines.
 *
 * The two emphasis rules are ours, and they used to live inside the library: the `done` chunk
 * prints its `result.summary` in the accent tone (it is the answer, not another step), and on a
 * failed run the LAST line is the error.
 */
export function runLogLines(chunks: ProgressChunk[], status: RunStatus | null): LogLine[] {
  const failed = status === 'error'
  return chunks.map((c, i) => {
    const summary = (c.result as { summary?: string } | undefined)?.summary
    const last = i === chunks.length - 1
    return {
      text: (c.phase === 'done' && summary) || c.message,
      tone: failed && last ? 'danger' : c.phase === 'done' && !failed ? 'accent' : undefined,
    }
  })
}

/** `LogViewer` with the console's defaults: our status words, and "steps" as the unit. */
export function RunLogPane({
  title,
  status,
  chunks,
  emptyNote,
  endRef,
  className,
}: {
  title?: string | null
  status: RunStatus | null
  chunks: ProgressChunk[]
  emptyNote: string
  endRef?: React.RefObject<HTMLDivElement | null>
  className?: string
}) {
  return (
    <LogViewer
      title={title}
      status={status ? STATUS[status] : null}
      lines={runLogLines(chunks, status)}
      emptyNote={emptyNote}
      countLabel={(n) => `${n} steps`}
      endRef={endRef}
      className={className}
    />
  )
}
