const FALLBACK = 'Something went wrong.'

/** A tRPC input-validation failure carries the zod issues as a JSON array in its message. */
function validationIssues(message: string): string | null {
  if (!message.startsWith('[')) return null
  try {
    const issues: unknown = JSON.parse(message)
    if (!Array.isArray(issues)) return null
    const texts = issues
      .map((i) => (i && typeof i === 'object' && typeof (i as { message?: unknown }).message === 'string' ? (i as { message: string }).message : null))
      .filter((t): t is string => !!t)
    return texts.length > 0 ? texts.join(' ') : null
  } catch {
    return null
  }
}

/**
 * The readable text of a failure, for a footer note or a `SettingsError`.
 *
 * Use it wherever a caught value reaches the page, instead of `String(err)` (which prints the
 * class name: "TRPCClientError: ..."). An `Error` (a tRPC client error included) gives its message,
 * a validation failure its issues' messages, a string itself, an object with a string `message`
 * that message, and anything else `Something went wrong.`. A section with a better sentence for a
 * known failure passes that instead.
 */
export function errorMessage(err: unknown): string {
  const raw =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : ''
  // A string that went through `String(err)` upstream (a data store's error) keeps the class name.
  const text = raw.trim().replace(/^(?:TRPCClient|TypeError|Error)[A-Za-z]*:\s*/, '')
  if (!text) return FALLBACK
  return validationIssues(text) ?? text
}
