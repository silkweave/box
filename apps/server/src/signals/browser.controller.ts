import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiOperation } from '@nestjs/swagger'
import { Mcp } from '@silkweave/nestjs'
import { cdpCheck, type CdpCheckResult } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'

/** The browser lease's diagnostic (core/browser): lease a tab from chromatrix and report what it sees. */
@Controller('browser')
@UseGuards(AuthGuard)
export class BrowserController {
  @Get('check')
  @ApiOperation({ summary: 'Confirm this Box can lease a tab from the browser host' })
  @Mcp({ name: 'CdpCheck' })
  cdpCheck(): Promise<CdpCheckResult> {
    return cdpCheck()
  }
}
