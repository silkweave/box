import { Module, type OnModuleInit } from '@nestjs/common'
import { onRunOutcome, recordRunError } from '@silkweave/box-core'
import { OpsController } from './ops.controller.js'
import { WarehouseController } from './warehouse.controller.js'

/** Core: the action registry, run history, Run Now, the warehouse backup every Box has, and the
 *  `run.error` event a failed run records. */
@Module({ controllers: [OpsController, WarehouseController] })
export class OpsModule implements OnModuleInit {
  onModuleInit(): void {
    onRunOutcome(recordRunError)
  }
}
