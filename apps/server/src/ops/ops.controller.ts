import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Min } from 'class-validator'
import { Mcp, Trpc } from '@silkweave/nestjs'
import { z } from 'zod/v4'
import { RUN_TRIGGERS, listAutomationActions, onChange, onRunLog, readRun, readRuns, startDetachedRun, type IngestProgress, type RunLogLine } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'
import { type PrincipalRequest } from '../auth/auth.decorators.js'

// Nested DTO arrays need explicit schemas for precise generated tRPC output types.
const actionsOutput = z.object({ actions: z.array(z.object({
  id: z.string(),
  label: z.string(),
  group: z.string(),
  description: z.string(),
  plugin: z.boolean().optional(),
  entryPath: z.string().optional(),
  parameterized: z.boolean().optional(),
})) })
const runsOutput = z.object({
  generatedAt: z.string(),
  runs: z.array(z.object({
    id: z.string(),
    schedule_id: z.string().nullable(),
    action_id: z.string(),
    trigger: z.enum(RUN_TRIGGERS),
    trigger_id: z.string().nullable(),
    event_id: z.string().nullable(),
    triggered_by: z.string().nullable(),
    status: z.enum(['queued', 'running', 'success', 'error', 'skipped']),
    started_at: z.string(),
    finished_at: z.string().nullable(),
    duration_ms: z.number().nullable(),
    summary: z.string().nullable(),
    error: z.string().nullable(),
    latest: z.string().optional(),
  })),
})
const runOutput = z.object({
  id: z.string(),
  schedule_id: z.string().nullable(),
  action_id: z.string(),
  trigger: z.enum(RUN_TRIGGERS),
  trigger_id: z.string().nullable(),
  event_id: z.string().nullable(),
  triggered_by: z.string().nullable(),
  status: z.enum(['queued', 'running', 'success', 'error', 'skipped']),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  log: z.array(z.object({
    ts: z.string(),
    channel: z.string(),
    phase: z.string(),
    message: z.string(),
    seq: z.number().optional(),
  })),
})

// DTOs document the REST/Swagger surface and drive the generated tRPC input/output types.
class PullResultDto {
  @ApiProperty() channel!: string
  @ApiProperty() date!: string
  @ApiProperty() summary!: string
}
class IngestProgressDto {
  @ApiProperty() channel!: string
  @ApiProperty({ enum: ['start', 'fetch', 'persist', 'done'] }) phase!: IngestProgress['phase']
  @ApiProperty() message!: string
  @ApiProperty({ required: false, type: PullResultDto, nullable: true }) result?: PullResultDto
}

class AutomationActionDto {
  @ApiProperty() id!: string
  @ApiProperty() label!: string
  @ApiProperty() group!: string
  @ApiProperty() description!: string
  @ApiProperty({ required: false }) plugin?: boolean
  @ApiProperty({ required: false }) entryPath?: string
  @ApiProperty({ required: false, description: 'Needs per-run params - not schedulable, hidden from the bare Run console' })
  parameterized?: boolean
}
class ActionsDto {
  @ApiProperty({ type: [AutomationActionDto] }) actions!: AutomationActionDto[]
}

class RunGetDto {
  @ApiProperty() @IsString() id!: string
  @ApiProperty({ required: false, description: 'Only log lines with a greater seq (poll a running run with the last seq you saw)' })
  @IsOptional() @IsInt() @Min(-1) after?: number
  @ApiProperty({ required: false, description: 'Only the last n log lines' })
  @IsOptional() @IsInt() @Min(0) tail?: number
}

class RunDto {
  @ApiProperty() id!: string
  @ApiProperty({ required: false, nullable: true }) schedule_id!: string | null
  @ApiProperty() action_id!: string
  @ApiProperty({ enum: RUN_TRIGGERS }) trigger!: string
  @ApiProperty({ required: false, nullable: true, description: 'The automation trigger that started the run' }) trigger_id!: string | null
  @ApiProperty({ required: false, nullable: true, description: 'The event that fired an event trigger' }) event_id!: string | null
  @ApiProperty({ required: false, nullable: true, description: 'users.id for attributed manual runs' })
  triggered_by!: string | null
  @ApiProperty({ enum: ['queued', 'running', 'success', 'error', 'skipped'] }) status!: string
  @ApiProperty() started_at!: string
  @ApiProperty({ required: false, nullable: true }) finished_at!: string | null
  @ApiProperty({ required: false, nullable: true }) duration_ms!: number | null
  @ApiProperty({ required: false, nullable: true }) summary!: string | null
  @ApiProperty({ required: false, nullable: true }) error!: string | null
  @ApiProperty({ required: false, description: 'The newest live log line of an active run (runs list only)' }) latest?: string
}
class RunLogLineDto {
  @ApiProperty() ts!: string
  @ApiProperty() channel!: string
  @ApiProperty() phase!: string
  @ApiProperty() message!: string
  @ApiProperty({ required: false, description: 'Per-run line sequence, for `after`' }) seq?: number
}
class RunWithLogDto extends RunDto {
  @ApiProperty({ type: [RunLogLineDto] }) log!: RunLogLineDto[]
}
class RunsDto {
  @ApiProperty() generatedAt!: string
  @ApiProperty({ type: [RunDto] }) runs!: RunDto[]
}

class RunTailDto {
  @ApiProperty() @IsString() id!: string
  @ApiProperty({ required: false, description: 'Only log lines with a greater seq (resume after a drop)' })
  @IsOptional() @IsInt() @Min(-1) after?: number
}

class RunTailChunkDto {
  @ApiProperty({ type: [RunLogLineDto], description: 'New log lines, in seq order (empty on a keepalive)' }) lines!: RunLogLineDto[]
  @ApiProperty({ enum: ['queued', 'running', 'success', 'error', 'skipped'] }) status!: string
  @ApiProperty({ description: 'The run has settled; this is the last chunk' }) done!: boolean
  @ApiProperty({ required: false, nullable: true }) summary!: string | null
  @ApiProperty({ required: false, nullable: true }) error!: string | null
}

/** Keepalive cadence of a quiet tail, and how often it re-reads the row as a fallback. */
const TAIL_PING_MS = 30_000

class RunNowDto {
  @ApiProperty({ description: 'Automation action id (see automationActions)' }) @IsString() action_id!: string
  @ApiProperty({ required: false, description: 'Automation trigger this run belongs to (links it in history)' })
  @IsOptional() @IsString() trigger_id?: string
  @ApiProperty({ required: false, description: 'users.id triggering the run (audit attribution; defaults to the authenticated principal)' })
  @IsOptional() @IsString() triggered_by?: string
  @ApiProperty({ required: false, description: 'Snapshot date YYYY-MM-DD (plugin actions only)' })
  @IsOptional() @IsString() date?: string
  @ApiProperty({ required: false, description: 'JSON object string of per-run params for parameterized actions, e.g. {"content_id":"…","user_id":"…"} for verify-engagement' })
  @IsOptional() @IsString() params?: string
}


/**
 * The ops surface - core's action registry (every feature's runnable actions), the persisted run
 * history every execution funnels into (ops/run.ts in core), and Run Now. Present in every Box;
 * the cron scheduler over the same registry is the automation feature.
 */
@Controller('ops')
@UseGuards(AuthGuard)
export class OpsController {
  /** tRPC query `opsActions` - every schedulable/runnable action (fresh plugin discovery). */
  @Get('actions')
  @ApiOkResponse({ type: ActionsDto })
  @Trpc({ output: actionsOutput })
  actions(): ActionsDto {
    return { actions: listAutomationActions() }
  }

  /** tRPC query `opsRuns` - the latest run history (no logs; fetch one via opsRun). */
  @Get('runs')
  @ApiOkResponse({ type: RunsDto })
  @Trpc({ output: runsOutput })
  async runs(): Promise<RunsDto> {
    const runs = (await readRuns(100)) as RunDto[]
    return { generatedAt: new Date().toISOString(), runs }
  }

  /**
   * tRPC mutation `opsRun` / MCP `run-get` - one run including its log. A queued or running run
   * returns its log so far; poll it with `after` (the last seq seen) for only the new lines.
   * Modeled as a mutation because it carries an input (repo convention for input-carrying reads).
   */
  @Post('run')
  @ApiOkResponse({ type: RunWithLogDto })
  @Trpc({ kind: 'mutation', output: runOutput })
  @Mcp({ name: 'run-get' })
  async run(@Body() body: RunGetDto): Promise<RunWithLogDto> {
    const run = await readRun(body.id, { after: body.after, tail: body.tail })
    if (!run) throw new Error(`no run "${body.id}"`)
    return run as RunWithLogDto
  }

  /**
   * tRPC subscription `opsRunTail` - follow one run live: its log so far (or after `after`), then
   * each new line as the run writes it, then a final chunk with `done: true` and the outcome. Any
   * client may attach or detach at any time; the run does not depend on it. Same access as opsRun
   * (every signed-in principal; owner decision 2026-10-09). A settled run yields one chunk.
   */
  @Trpc({ kind: 'subscription', chunk: RunTailChunkDto })
  async *runTail(@Body() body: RunTailDto): AsyncGenerator<RunTailChunkDto> {
    const queue: RunLogLine[] = []
    let poke = false
    let wake: (() => void) | undefined
    const rouse = () => {
      poke = true
      wake?.()
    }
    // Listen first, then read, so no line falls between the read and the first event.
    const offLog = onRunLog(body.id, (ev) => {
      if (ev.type === 'closed') return rouse()
      queue.push(ev.line)
      wake?.()
    })
    // finalizeRun announces the settled row (closeRunLog fires just before it is written).
    const offChange = onChange((ev) => {
      if (ev.scope === 'table:automation_runs' && (ev.detail === body.id || ev.detail === null)) rouse()
    })
    try {
      const first = await readRun(body.id, { after: body.after })
      if (!first) throw new Error(`no run "${body.id}"`)
      let last = first.log.at(-1)?.seq ?? body.after ?? -1
      const settled = (status: string) => status !== 'queued' && status !== 'running'
      yield { lines: first.log, status: first.status, done: settled(first.status), summary: first.summary, error: first.error }
      if (settled(first.status)) return
      let status: string = first.status
      for (;;) {
        if (queue.length === 0 && !poke) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              poke = true
              resolve()
            }, TAIL_PING_MS)
            wake = () => {
              clearTimeout(timer)
              resolve()
            }
          })
          wake = undefined
        }
        const fresh = queue.splice(0).filter((l) => (l.seq ?? -1) > last)
        if (fresh.length > 0) last = fresh.at(-1)!.seq ?? last
        if (!poke) {
          yield { lines: fresh, status, done: false, summary: null, error: null }
          continue
        }
        poke = false
        // A state change, a closed log or a quiet spell: the row says where the run stands.
        const run = await readRun(body.id, { after: last })
        if (!run) return
        const more = run.log.filter((l) => (l.seq ?? -1) > last)
        if (more.length > 0) last = more.at(-1)!.seq ?? last
        status = run.status
        yield { lines: [...fresh, ...more], status, done: settled(status), summary: run.summary, error: run.error }
        if (settled(status)) return
      }
    } finally {
      offLog()
      offChange()
    }
  }

  /**
   * tRPC subscription `opsRunNow` / MCP `run-now` - run any action immediately, streaming
   * progress, recorded in history as trigger:'manual' with optional user attribution. Execution is
   * detached from the stream: unsubscribing (navigating away, closing the tab) only stops the
   * live tail - the run continues to completion and finalizes normally.
   */
  @Trpc({ kind: 'subscription', chunk: IngestProgressDto })
  @Mcp({ name: 'run-now' })
  async *runNow(@Body() body: RunNowDto, @Req() req: PrincipalRequest): AsyncGenerator<IngestProgress> {
    const run = startDetachedRun(body.action_id, {
      trigger: 'manual',
      triggerId: body.trigger_id,
      triggeredBy: body.triggered_by ?? req.principal?.id ?? null,
      date: body.date,
      params: body.params ? (JSON.parse(body.params) as Record<string, string>) : undefined,
    })
    yield* run.tail()
  }
}
