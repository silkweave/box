// An area refusal a core accessor throws inside a REST handler (`AreaAccessError`, W8 R3: the
// accessor decides) answers 403 with the same body as AuthGuard's refusal. Nest treats any error
// that is not an HttpException as a 500. The tRPC and MCP adapters get the same mapping in
// call-context.ts.

import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common'
import { AreaAccessError } from '@silkweave/box-core'

/** The part of the Express response this filter uses. */
interface JsonResponse {
  status(code: number): { json(body: unknown): void }
}

@Catch(AreaAccessError)
export class AreaAccessFilter implements ExceptionFilter {
  catch(e: AreaAccessError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<JsonResponse>().status(403).json({ ...e.toJSON(), message: e.message })
  }
}
