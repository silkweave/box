// "17 / 53 accounts" - the rows on screen out of the rows there are, for a grid footer's identity
// cell.
//
// It is HERE and not in `GridFooter` because it is English about this Box's domain: it knows that
// rows are called something, that the something has a plural, and that English makes the plural with
// an "s" unless you say otherwise. A component library that composed this would be composing one
// language's grammar for every consumer - the same reason `ShowAllToggle` was deleted on 2026-09-14.
//
// The count used to sit at the right end of the board bar, which put it as far as it could get from
// the numbers it counts; in the footer it labels the row of totals it belongs to, and the bar is one
// control strip with no prose.

/** Both forms of what a board calls its rows: `{ one: 'account', many: 'accounts' }`. */
export interface RowNoun {
  one: string
  many: string
}

/**
 * `count` is what survived the filters and the search; `total` is what the board holds in all.
 *
 * The denominator collapses when nothing is filtered out ("53 accounts"), so an unfiltered board is
 * not asking you to compare two identical numbers.
 */
export function rowCountLabel(count: number, total: number, noun: RowNoun): string {
  const figure = count === total ? `${total}` : `${count} / ${total}`
  return `${figure} ${total === 1 && count === total ? noun.one : noun.many}`
}
