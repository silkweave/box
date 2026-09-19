import { Controller, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiProperty } from '@nestjs/swagger'
import { Mcp, Trpc } from '@silkweave/nestjs'
import { drain, executeRecorded, instanceRelative, listRestorePoints } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'
import { Admin } from '../auth/auth.decorators.js'

class OpResultDto {
  @ApiProperty({ description: 'One-line outcome of the maintenance op' }) summary!: string
}

class RestorePointDto {
  @ApiProperty({ description: 'Pass this to `box db restore <name>`' }) name!: string
  @ApiProperty({ description: 'Path under the Box instance dir' }) path!: string
  @ApiProperty({ enum: ['pre-migrate', 'manual', 'pre-restore', 'seed'] }) label!: string
  @ApiProperty({ description: 'ISO-8601 UTC' }) takenAt!: string
  @ApiProperty({ description: 'Size of the copy, including its WAL sidecar' }) bytes!: number
}
class RestorePointsDto {
  @ApiProperty({ type: [RestorePointDto] }) points!: RestorePointDto[]
}

/**
 * Warehouse backup: CORE, not a feature. A Box with zero features installed still has a warehouse
 * that an agent can restructure, so the safety net has to be reachable without installing anything.
 * (`warehouse-derive` is different - it belongs to the `data` feature and stays in its controller.)
 *
 * RESTORE IS DELIBERATELY NOT HERE. It overwrites the running server's own ground truth, and the
 * server would then need a restart anyway because the schema step is memoized per process. It is a
 * host command, `box db restore <name>`, where the person running it can see the machine.
 */
@Controller('warehouse')
@UseGuards(AuthGuard)
export class WarehouseController {
  /** tRPC mutation `warehouseBackup` / MCP tool `WarehouseBackup`. Runs the core action, so the run
   *  lands in `automation_runs` like every other op. */
  @ApiOperation({ summary: 'Copy the warehouse into <instance>/backups (and to GCS when configured)' })
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
  @ApiOperation({ summary: 'List the warehouse restore points, newest first' })
  @ApiOkResponse({ type: RestorePointsDto })
  @Admin()
  @Trpc({ kind: 'query' })
  @Mcp()
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
