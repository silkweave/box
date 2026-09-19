// Resting "view" treatment for a base-ui Select trigger used as an inline-editable
// field - transparent until hovered/focused, matching InlineEdit. twMerge lets these
// override the trigger's default `border-border bg-bg`.
export const inlineSelectCls =
  'w-full border-transparent bg-transparent hover:border-border-light hover:bg-accent-tint data-popup-open:border-accent data-popup-open:bg-bg'
