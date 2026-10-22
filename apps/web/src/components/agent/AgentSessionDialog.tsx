import { useEffect, useRef, useState } from 'react'
import { WorkerDeckError } from '@workerdeck/client'
import type { SessionInfo } from '@workerdeck/protocol'
import { SessionPanel } from '@workerdeck/ui'
import { Button, Dialog, DialogContent, DialogTitle } from '@silkweave/box-ui'
import { cn } from '@/lib/utils'
import { agentClient } from '../../lib/agentStore.ts'

/**
 * A read-only window onto one agent worker session: chat's room turns and other features' agent jobs.
 * Each surface passes its own words for an ended or forgotten session. Who may read a session is
 * the server's call (core agent-session.ts and the rules features register), never this dialog's.
 */

export interface AgentSessionDialogProps {
  /** The worker session to show, or null for closed. */
  sessionId: string | null
  onClose: () => void
  /** The dialog's title (default "Agent session"). */
  title?: string
  /** Why the session is closed, in the surface's own terms (default: a plain "has ended"). */
  endedNote?: string
  /** Why the worker has no such session any more, in the surface's own terms. */
  goneNote?: string
}

const ENDED_NOTE = 'This session has ended; below is what it did while it ran.'
const GONE_NOTE = 'This session is no longer on the worker: a finished session is forgotten on the next restart. It is also what you would see for a session you are not allowed to read.'

/**
 * What the dialog found out about the session before deciding whether to mount the panel.
 *
 * The panel alone cannot tell a viewer WHY it is not showing anything: its socket answers 404 for
 * a session that has been forgotten, for one the viewer may not read, and (before the relay in
 * agent.mount.ts) for every room session at all, and its client turns all of them into
 * "Reconnecting…" and then "Offline" - indistinguishable from a network problem. So the dialog asks
 * the REST route first, which answers in HTTP, and only mounts the panel on a session that exists.
 */
type SessionView =
  | { kind: 'loading' }
  | { kind: 'found'; session: SessionInfo }
  /** 404: the worker has no such session, or will not show it to this viewer. */
  | { kind: 'gone' }
  /** 401/403: not signed in, or not an internal user. */
  | { kind: 'refused'; status: number }
  | { kind: 'unreachable'; message: string }

const viewFor = (error: unknown): SessionView => {
  if (error instanceof WorkerDeckError) {
    if (error.status === 404) return { kind: 'gone' }
    if (error.status === 401 || error.status === 403) return { kind: 'refused', status: error.status }
    return { kind: 'unreachable', message: error.message }
  }
  return { kind: 'unreachable', message: error instanceof Error ? error.message : 'request failed' }
}

/**
 * The line above the transcript for a session that is no longer running, or the whole body when
 * there is nothing to show. An ENDED session is the NORMAL state of an older turn, not a fault:
 * the chat agent retires a room's session an hour after the room goes quiet, and the copy has to
 * read that way - a person clicking yesterday's answer has not broken anything.
 */
function sessionNote(view: Exclude<SessionView, { kind: 'loading' }>, notes: { ended: string; gone: string }): string | null {
  switch (view.kind) {
    case 'found':
      if (view.session.status === 'closed') {
        return notes.ended
      }
      if (view.session.status === 'failed') return 'This session failed. Below is what it did before it stopped.'
      if (view.session.status === 'parked') return 'This session is parked, so there is nothing live to watch.'
      return null
    case 'gone':
      return notes.gone
    case 'refused':
      return view.status === 401 ? 'Sign in to view agent sessions.' : 'Agent sessions are only shown to internal users.'
    case 'unreachable':
      return `Could not reach the agent worker: ${view.message}`
  }
}

/** The auth-gated half of the split: the full transcript, arguments included. */
export function AgentSessionDialog({ sessionId, onClose, title = 'Agent session', endedNote = ENDED_NOTE, goneNote = GONE_NOTE }: AgentSessionDialogProps) {
  const [view, setView] = useState<SessionView>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // One re-check per opening when the panel's own socket gives up: a session that was found and
  // then forgotten (a restart between the click and the attach) flips to `gone` with its
  // explanation instead of sitting on "Offline". Once, because the re-check remounts the panel,
  // and a persistent failure should settle on the panel's own indicator rather than cycle.
  const rechecked = useRef(false)

  useEffect(() => {
    if (sessionId === null) return
    let cancelled = false
    setView({ kind: 'loading' })
    agentClient.getSession(sessionId).then(
      (session) => {
        if (!cancelled) setView({ kind: 'found', session })
      },
      (error: unknown) => {
        if (!cancelled) setView(viewFor(error))
      },
    )
    return () => {
      cancelled = true
    }
  }, [sessionId, attempt])

  useEffect(() => {
    rechecked.current = false
  }, [sessionId])

  const note = view.kind === 'loading' ? null : sessionNote(view, { ended: endedNote, gone: goneNote })
  // A closed or failed runner keeps its event log until the worker restarts, so an ended turn's
  // transcript is still readable; only a parked one has nothing to attach to (see agent.mount.ts).
  const showPanel = view.kind === 'found' && view.session.status !== 'parked'

  return (
    <Dialog
      open={sessionId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}>
      <DialogContent className='h-[80vh] w-[calc(100%-2rem)] max-w-4xl gap-2 p-0'>
        <DialogTitle className='px-5 pt-5 text-body font-medium'>{title}</DialogTitle>
        {view.kind === 'loading' && <p className='px-5 text-label text-muted-foreground'>Opening the session…</p>}
        {note !== null && (
          <div
            className={cn(
              'mx-5 flex items-start gap-2 rounded-md border px-3 py-2 text-label',
              view.kind === 'unreachable' ? 'border-destructive/40 text-destructive' : 'border-border text-muted-foreground',
            )}>
            <span className='min-w-0 flex-1'>{note}</span>
            {view.kind === 'unreachable' && (
              <Button variant='outline' size='xs' className='shrink-0' onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </Button>
            )}
          </div>
        )}
        {/* readOnly hides the composer, the approval prompts and the session controls (checked
            against @workerdeck/ui's own source - SessionPanel.tsx lines 490/631/666), and
            toolHost={false} refuses to run this session's tool calls in this browser. Neither is
            the control, though: a room reader's socket is a server-side relay that forwards
            nothing inbound (apps/server/src/agent/session-relay.ts). This is a WINDOW onto
            somebody else's turn, not a second place to drive it. */}
        {sessionId !== null && showPanel && (
          <SessionPanel
            key={`${sessionId}:${attempt}`}
            client={agentClient}
            sessionId={sessionId}
            readOnly
            toolHost={false}
            onVitals={(vitals) => {
              if (vitals.connection !== 'offline' || rechecked.current) return
              rechecked.current = true
              setAttempt((n) => n + 1)
            }}
            className='min-h-0 flex-1'
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
