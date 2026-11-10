import { Controller, UseGuards } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { ApiProperty } from '@nestjs/swagger'
import { Trpc } from '@silkweave/nestjs'
import { currentScope, onChange, requestClosed, visibleChange, type ChangeEvent } from '@silkweave/box-core'
import { onPolicyRevision } from '@silkweave/box-core/auth/policy-revision'
import { admitFrame } from '@silkweave/box-core/warehouse/core-command'
import { AuthGuard } from '../auth/auth.guard.js'
import { Authenticated, Read } from '../auth/auth.decorators.js'

// Identifies this server process. The first event of every subscription is a `hello` carrying it;
// a client that sees a second hello (a reconnect, server restart) knows events may have been
// missed and reloads all its loaded stores instead of replaying.
const BOOT_ID = randomUUID()

/** Keepalive cadence: an event with scope `ping` when the bus is quiet, so idle connections
 *  aren't reaped by intermediaries and dead ones surface to the client. */
const PING_MS = 45_000

class ChangeEventDto {
  @ApiProperty({ description: 'Monotonic per-process sequence (hello is 0)' }) seq!: number
  @ApiProperty({ description: 'ISO-8601 emit time' }) ts!: string
  @ApiProperty({
    description: "What changed: 'hello' | 'ping' | 'policy' (refetch your access) | 'table:<name>' | 'docs:<section>' | 'config:<file>'",
  })
  scope!: string
  @ApiProperty({ required: false, nullable: true, description: 'Refinement, e.g. the instance-relative file path' })
  detail!: string | null
}

/**
 * changes controller: the dashboard's live-refresh feed. One long-lived tRPC subscription
 * (`changesFeed`: the web app's live-feed WebSocket, mobile's SSE) streams invalidation hints from the core change bus - fed by
 * the warehouse write layer for in-process mutations and by ChangesWatcher for out-of-process file
 * edits. Events carry NO data, only scopes; clients map scopes onto their data stores and reload.
 * Each subscriber gets only the scopes of areas it reads (core change-access.ts).
 */
@Controller('changes')
@UseGuards(AuthGuard)
export class ChangesController {
  /** tRPC subscription `changesFeed` - hello first, then every change event, pings when idle. */
  @Trpc({ kind: 'subscription', chunk: ChangeEventDto })
  @Authenticated()
  @Read()
  async *feed(): AsyncGenerator<ChangeEvent> {
    // Both listeners are registered before hello is yielded (BOX-Review 0bfd114 finding 2): a
    // change or policy move published while the consumer holds hello is queued, not lost.
    const queue: ChangeEvent[] = []
    let wake: (() => void) | undefined
    const off = onChange((ev) => {
      queue.push(ev)
      wake?.()
    })
    // A published policy move wakes the feed at once, so `policy` reaches the client without
    // waiting for the next change event or ping. Another process's move arrives with its next
    // event or ping (admission reads the committed revision).
    let policyMoved = false
    const offPolicy = onPolicyRevision(() => {
      policyMoved = true
      wake?.()
    })
    const revisionOf = () => {
      const scope = currentScope()
      return scope.kind === 'principal' ? scope.access.revision : null
    }
    let revision = revisionOf()
    // The caller going away wakes the wait below, so a closed subscriber releases its listeners at
    // once instead of at the next event or ping.
    const closed = requestClosed()
    const onClosed = () => wake?.()
    closed?.addEventListener('abort', onClosed)
    // The first pass after hello admits before it ever waits: a policy move committed between the
    // frame's resolution and the listeners' registration (or in another process) reaches the client
    // now, not at the first ping.
    let first = true
    try {
      yield { seq: 0, ts: new Date().toISOString(), scope: 'hello', detail: BOOT_ID }
      for (;;) {
        if (closed?.aborted) return
        if (!first && queue.length === 0 && !policyMoved) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, PING_MS)
            wake = () => {
              clearTimeout(timer)
              resolve()
            }
          })
          wake = undefined
          if (closed?.aborted) return
        }
        // Every delivery is admitted against the committed policy (PERMISSIONS 9.2; BOX-Review
        // d7f5f4e finding 2): one core read re-resolves a frame whose policy moved, even one this
        // process has not heard of yet, or ends the feed when the principal can no longer act. Each
        // yield is one delivery: an event queued while the consumer paused is judged at its own
        // admission, not at a check shared with the events before it.
        policyMoved = false
        await admitFrame()
        // The policy moved since the last delivery: tell the client to refetch its access first.
        const now = revisionOf()
        if (now !== revision) {
          revision = now
          yield { seq: 0, ts: new Date().toISOString(), scope: 'policy', detail: null }
          continue
        }
        const ev = queue.shift()
        if (!ev) {
          if (first) {
            first = false
            continue
          }
          yield { seq: 0, ts: new Date().toISOString(), scope: 'ping', detail: null }
          continue
        }
        first = false
        const out = visibleChange(ev)
        if (out) yield out
      }
    } finally {
      closed?.removeEventListener('abort', onClosed)
      off() // client disconnected (generator return/throw) - stop listening
      offPolicy()
    }
  }
}
