import { Controller, UseGuards } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { ApiProperty } from '@nestjs/swagger'
import { Trpc } from '@silkweave/nestjs'
import { onChange, type ChangeEvent } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'

// Identifies this server process. The first event of every subscription is a `hello` carrying it;
// a client that sees a second hello (SSE auto-reconnect, server restart) knows events may have been
// missed and reloads all its loaded stores instead of replaying.
const BOOT_ID = randomUUID()

/** Keepalive cadence: an event with scope `ping` when the bus is quiet, so idle SSE connections
 *  aren't reaped by intermediaries and dead ones surface to the client's EventSource. */
const PING_MS = 45_000

class ChangeEventDto {
  @ApiProperty({ description: 'Monotonic per-process sequence (hello is 0)' }) seq!: number
  @ApiProperty({ description: 'ISO-8601 emit time' }) ts!: string
  @ApiProperty({
    description: "What changed: 'hello' | 'ping' | 'warehouse' | 'table:<name>' | 'docs:<section>' | 'config:<file>'",
  })
  scope!: string
  @ApiProperty({ required: false, nullable: true, description: 'Refinement, e.g. the instance-relative file path' })
  detail!: string | null
}

/**
 * changes controller: the dashboard's live-refresh feed. One long-lived tRPC subscription
 * (`changesFeed`, over the SSE link) streams invalidation hints from the core change bus - fed by
 * the warehouse write layer for in-process mutations and by ChangesWatcher for out-of-process file
 * edits. Events carry NO data, only scopes; clients map scopes onto their data stores and reload.
 */
@Controller('changes')
@UseGuards(AuthGuard)
export class ChangesController {
  /** tRPC subscription `changesFeed` - hello first, then every change event, pings when idle. */
  @Trpc({ kind: 'subscription', chunk: ChangeEventDto })
  async *feed(): AsyncGenerator<ChangeEvent> {
    yield { seq: 0, ts: new Date().toISOString(), scope: 'hello', detail: BOOT_ID }
    const queue: ChangeEvent[] = []
    let wake: (() => void) | undefined
    const off = onChange((ev) => {
      queue.push(ev)
      wake?.()
    })
    try {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, PING_MS)
            wake = () => {
              clearTimeout(timer)
              resolve()
            }
          })
          wake = undefined
        }
        if (queue.length === 0) {
          yield { seq: 0, ts: new Date().toISOString(), scope: 'ping', detail: null }
          continue
        }
        while (queue.length > 0) yield queue.shift()!
      }
    } finally {
      off() // client disconnected (generator return/throw) - stop listening
    }
  }
}
