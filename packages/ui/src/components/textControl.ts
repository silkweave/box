// Shared by Input and Textarea, not exported from the package: the box every text control draws.
export const textFrameCls =
  'rounded-md border border-border bg-bg text-body-sm text-text transition-colors hover:border-accent/40'

/** The bare text control's states, for an input or textarea that draws its own frame. */
export const textControlCls =
  'w-full min-w-0 placeholder:text-fg-4 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 read-only:hover:border-border read-only:focus:border-accent'

export const textInvalidCls = 'border-danger hover:border-danger focus:border-danger'

/** Joins aria-describedby ids, dropping empties. */
export const joinIds = (...ids: (string | undefined)[]) => ids.filter(Boolean).join(' ') || undefined

/** True when a control is invalid by its own prop, its aria attribute or its Field. */
export const isInvalid = (invalid: boolean | undefined, aria: React.AriaAttributes['aria-invalid'], field: boolean | undefined) =>
  Boolean(invalid || field || aria === true || aria === 'true')
