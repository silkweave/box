import { Module, type OnModuleInit } from '@nestjs/common'
import { evaluateSignalEvents, onEvent, onRunOutcome, refreshEventSignals, registerBoardNodeKind, SIGNAL_BOARD_KIND, watchSignalWrites } from '@silkweave/box-core'
import { BoardsController } from './boards.controller.js'
import { BrowserController } from './browser.controller.js'
import { PresetsController } from './presets.controller.js'
import { SignalsController } from './signals.controller.js'
import { SourcesController } from './sources.controller.js'

/** Core's signals: definitions and points, data sources, circuit boards, saved views (presets),
 *  the signal events on the spine, and the browser lease's diagnostic. */
@Module({
  controllers: [SignalsController, SourcesController, BoardsController, PresetsController, BrowserController],
})
export class SignalsModule implements OnModuleInit {
  onModuleInit(): void {
    // The built-in node kind; features register theirs (planning: goals, initiatives) the same way.
    registerBoardNodeKind(SIGNAL_BOARD_KIND)
    // A successful run that wrote signals records `signal.increase` / `signal.threshold` events.
    watchSignalWrites()
    onRunOutcome(async (outcome) => {
      if (outcome.status === 'success') await evaluateSignalEvents()
    })
    // Event-derived signals stay current on every fresh event, whoever recorded it.
    onEvent(refreshEventSignals)
  }
}
