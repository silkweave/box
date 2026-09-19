import { Module } from '@nestjs/common'
import { OpsController } from './ops.controller.js'
import { WarehouseController } from './warehouse.controller.js'

/** Core: the action registry, run history, Run Now, and the warehouse backup every Box has. */
@Module({ controllers: [OpsController, WarehouseController] })
export class OpsModule {}
