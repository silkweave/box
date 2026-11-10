// A handler's catch-all turns a domain failure into a 400 so the caller sees which input was wrong.
// An area refusal a core accessor throws (`AreaAccessError`, W8 R3: the accessor decides) is not the
// caller's input: it passes through so `withCallContext` and `AreaAccessFilter` answer it as a refusal.

import { BadRequestException, ConflictException } from '@nestjs/common'
import { AreaAccessError, CoverageRefusedError, PolicyRevisionMovedError } from '@silkweave/box-core'

/** The error a handler's catch-all throws for `e`: the refusal itself, or a 400 with its message. */
export function inputError(e: unknown): Error {
  if (e instanceof AreaAccessError) return e
  // A coverage refusal (PERMISSIONS 7.2) or a moved preview revision: 409 with the preview, so a
  // client can show the list and confirm with its revision.
  if (e instanceof CoverageRefusedError || e instanceof PolicyRevisionMovedError) return new ConflictException({ message: e.message, ...e.toJSON() })
  return new BadRequestException(e instanceof Error ? e.message : String(e))
}
