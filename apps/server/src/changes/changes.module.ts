import { Module } from '@nestjs/common'
import { ChangesController } from './changes.controller.js'
import { ChangesWatcher } from './changes.watcher.js'

@Module({
  controllers: [ChangesController],
  providers: [ChangesWatcher],
})
export class ChangesModule {}
