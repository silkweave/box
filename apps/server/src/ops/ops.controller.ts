import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { Mcp, Trpc } from '@silkweave/nestjs'
import { listAutomationActions, readRun, readRuns, startDetachedRun, type IngestProgress } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'
import { type PrincipalRequest } from '../auth/auth.decorators.js'

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

class IdDto {
  @ApiProperty() @IsString() id!: string
}

class RunDto {
  @ApiProperty() id!: string
  @ApiProperty({ required: false, nullable: true }) schedule_id!: string | null
  @ApiProperty() action_id!: string
  @ApiProperty({ enum: ['schedule', 'manual'] }) trigger!: string
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
  @ApiProperty({ required: false, description: 'Schedule this run belongs to (links it in history)' })
  @IsOptional() @IsString() schedule_id?: string
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
  @Trpc()
  actions(): ActionsDto {
    return { actions: listAutomationActions() }
  }

  /** tRPC query `opsRuns` - the latest run history (no logs; fetch one via opsRun). */
  @Get('runs')
  @ApiOkResponse({ type: RunsDto })
  @Trpc()
  async runs(): Promise<RunsDto> {
    const runs = (await readRuns(100)) as RunDto[]
    return { generatedAt: new Date().toISOString(), runs }
  }

  /**
   * tRPC mutation `opsRun` / MCP `run-get` - one run including its full log. Modeled as a
   * mutation because it carries an input (repo convention for input-carrying reads).
   */
  @Post('run')
  @ApiOkResponse({ type: RunWithLogDto })
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'run-get' })
  async run(@Body() body: IdDto): Promise<RunWithLogDto> {
    const run = await readRun(body.id)
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
      scheduleId: body.schedule_id,
      triggeredBy: body.triggered_by ?? req.principal?.id ?? null,
      date: body.date,
      params: body.params ? (JSON.parse(body.params) as Record<string, string>) : undefined,
    })
    yield* run.tail()
  }
}
