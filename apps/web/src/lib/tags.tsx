import { TokenPicker, lowercaseUniqueSorted } from '@silkweave/box-ui'

/**
 * A tag picker: `TokenPicker` with THIS Box's tag policy applied.
 *
 * The library's picker used to be called `TagPicker` and lowercase-dedupe-sorted everything on the
 * way out. That is the right rule for a free tag vocabulary and the wrong rule for anything with an
 * identity - the planning feature's `DependencyPicker` builds on the same widget over initiative
 * ids, which the normalisation would have quietly corrupted. So the widget became vocabulary-free
 * and the policy moved here, where "a tag is lowercase" is a decision we are allowed to make.
 */
export function TagPicker({
  value,
  onChange,
  suggestions,
  placeholder = 'add a tag…',
}: {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions: string[]
  placeholder?: string
}) {
  return (
    <TokenPicker
      value={value}
      onChange={onChange}
      options={suggestions}
      placeholder={placeholder}
      emptyLabel='No tags yet.'
      normalize={lowercaseUniqueSorted}
    />
  )
}

/** Lowercase, trim, dedupe, sort - our tag vocabulary's rule, for callers that normalise directly. */
export const normalizeTags = lowercaseUniqueSorted
