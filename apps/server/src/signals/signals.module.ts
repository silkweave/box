import { Module, type OnModuleInit } from '@nestjs/common'
import { evaluateSignalEvents, onEvent, onRunOutcome, refreshEventSignals, watchSignalWrites } from '@silkweave/box-core'
import { BrowserController } from './browser.controller.js'
import { PresetsController } from './presets.controller.js'
import { SignalsController } from './signals.controller.js'
import { SourcesController } from './sources.controller.js'

/** Core's signals: definitions and points, data sources, saved views (presets), the signal events
 *  on the spine, and the browser lease's diagnostic. Boards come from a recipe (core's board ports). */
@Module({
  controllers: [SignalsController, SourcesController, PresetsController, BrowserController],
})
export class SignalsModule implements OnModuleInit {
  onModuleInit(): void {
    // A successful run that wrote signals records `signal.increase` / `signal.threshold` events.
    watchSignalWrites()
    onRunOutcome(async (outcome) => {
      if (outcome.status === 'success') await evaluateSignalEvents()
    })
    // Event-derived signals stay current on every fresh event, whoever recorded it.
    onEvent(refreshEventSignals)
  }
}
