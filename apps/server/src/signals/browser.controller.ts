import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiOperation } from '@nestjs/swagger'
import { Mcp } from '@silkweave/nestjs'
import { cdpCheck, type CdpCheckResult } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'
import { Area, Read } from '../auth/auth.decorators.js'

/** The browser lease's diagnostic (core/browser): open a Shuttle session and report what it sees. */
@Controller('browser')
@UseGuards(AuthGuard)
export class BrowserController {
  @Get('check')
  @ApiOperation({ summary: 'Confirm this Box can open a Shuttle session on the browser host' })
  @Mcp({ name: 'CdpCheck' })
  @Area('ops')
  @Read()
  cdpCheck(): Promise<CdpCheckResult> {
    return cdpCheck()
  }
}
