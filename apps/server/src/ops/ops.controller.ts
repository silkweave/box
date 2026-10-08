import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Min } from 'class-validator'
import { Mcp, Trpc } from '@silkweave/nestjs'
import { z } from 'zod/v4'
import { RUN_TRIGGERS, listAutomationActions, readRun, readRuns, startDetachedRun, type IngestProgress } from '@silkweave/box-core'
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
