import { Module } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import { AuthController } from './auth.controller.js'
import { AuthGuard } from './auth.guard.js'
import { HandlerMap } from './handler-map.js'

// AuthGuard is registered via `app.useGlobalGuards()` in main.ts, which covers plain REST routes
// ONLY - the silkweave adapters do NOT run global guards for @Trpc procedures or @Mcp tools (the
// changesFeed subscription leaked anonymously until 9339a16). Every data controller must therefore
// carry class-level @UseGuards(AuthGuard). Exported here so main.ts and the controllers can use it.
// See auth.guard.ts and docs/AUTH.md.
// HandlerMap classifies every handler at boot (handler-map.ts) and refuses to boot on one it cannot.
@Module({
  imports: [DiscoveryModule],
  controllers: [AuthController],
  providers: [AuthGuard, HandlerMap],
  exports: [AuthGuard],
})
export class AuthModule {}
