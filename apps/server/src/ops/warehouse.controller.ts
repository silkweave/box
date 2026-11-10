import { Controller, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiProperty } from '@nestjs/swagger'
import { Mcp, Trpc } from '@silkweave/nestjs'
import { z } from 'zod/v4'
import { drain, executeRecorded, instanceRelative, listRestorePoints } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'
import { Admin, Read } from '../auth/auth.decorators.js'

class OpResultDto {
  @ApiProperty({ description: 'One-line outcome of the maintenance op' }) summary!: string
}

class RestorePointDto {
  @ApiProperty({ description: 'Pass this to `box db restore <name>`' }) name!: string
  @ApiProperty({ description: 'Path under the Box instance dir' }) path!: string
  @ApiProperty({ enum: ['pre-migrate', 'manual', 'pre-restore', 'pre-switch', 'seed'] }) label!: string
  @ApiProperty({ description: 'ISO-8601 UTC' }) takenAt!: string
  @ApiProperty({ description: 'Size of the copy, including its WAL sidecar' }) bytes!: number
}
class RestorePointsDto {
  @ApiProperty({ type: [RestorePointDto] }) points!: RestorePointDto[]
}
const restorePointsOutput = z.object({
  points: z.array(z.object({
    name: z.string(),
    path: z.string(),
    label: z.enum(['pre-migrate', 'manual', 'pre-restore', 'pre-switch', 'seed']),
    takenAt: z.string(),
    bytes: z.number(),
  })),
})

/**
 * Database backup: CORE, not a feature. A Box with zero features installed still has a database
 * that an agent can restructure, so the safety net has to be reachable without installing anything.
 * (`warehouse-derive` re-derives Data Sync's pulls and belongs to that recipe.)
 *
 * RESTORE IS DELIBERATELY NOT HERE. It replaces the running server's database with a fresh cluster
 * and is offline maintenance: a host command, `box db restore <name>`, run with Box stopped.
 */
@Controller('warehouse')
@UseGuards(AuthGuard)
export class WarehouseController {
  /** tRPC mutation `warehouseBackup` / MCP tool `WarehouseBackup`. Runs the core action, so the run
   *  lands in `automation_runs` like every other op. */
  @ApiOperation({ summary: 'Take a database restore point into <instance>/backups/db (and to GCS when configured)' })
  @ApiOkResponse({ type: OpResultDto })
  @Admin()
  @Trpc({ kind: 'mutation' })
  @Mcp()
  async backup(): Promise<OpResultDto> {
    const result = await drain(executeRecorded('warehouse-backup', { trigger: 'manual' }))
    return { summary: result.summary }
  }

  /** tRPC query `warehouseRestorePoints` / MCP tool `WarehouseRestorePoints` - what could be
   *  restored, newest first. Read-only on purpose: knowing the net exists is the point. */
  @ApiOperation({ summary: 'List the database restore points, newest first' })
  @ApiOkResponse({ type: RestorePointsDto })
  @Admin()
  @Trpc({ kind: 'query', output: restorePointsOutput })
  @Mcp()
  @Read()
  restorePoints(): RestorePointsDto {
    return {
      points: listRestorePoints().map((p) => ({
        name: p.name,
        path: instanceRelative(p.path),
        label: p.label,
        takenAt: p.takenAt.toISOString(),
        bytes: p.bytes,
      })),
    }
  }
}
