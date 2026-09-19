// Figures: how a NUMBER is drawn anywhere in the app. Lifted out of `components/crm/crmStatus.tsx`
// (2026-08-12) the moment a second module needed it - the grid footer aggregates money and
// percentages for Content and Initiatives too, and a shared board component reaching into the CRM's
// file would have dragged account statuses and their selects along with it. Nothing here knows what
// an account is; it is pure presentation of a quantity.

import { cn } from '../lib/utils.ts'

/** Currency presentation. Defaults are a Box's defaults, not a law - both are overridable. */
export interface CurrencyFormat {
  locale?: string
  currency?: string
}

const DEFAULT_CURRENCY: Required<CurrencyFormat> = { locale: 'en-US', currency: 'USD' }

/**
 * "$798.00" / "$332.30" / "-" - a currency figure as a plain string, for titles, aria labels and
 * prose.
 *
 * The fraction digits are the CURRENCY's, from `Intl` - which is two for USD and EUR (so a column
 * where some rows carry cents and some do not still lines up, the rule this has always had) and
 * ZERO for JPY, which has no minor unit. Forcing two would have printed ￥12,275.00, a number that
 * does not exist.
 *
 * Was `formatMrr` until 2026-09-14. It never knew anything about monthly recurring revenue - it
 * formats money, and naming it after the one CRM column that called it first meant every other
 * caller had to pretend its numbers were MRR.
 */
export function formatCurrency(v: number | null, { locale, currency }: CurrencyFormat = {}): string {
  if (v == null) return '-'
  return v.toLocaleString(locale ?? DEFAULT_CURRENCY.locale, {
    style: 'currency',
    currency: currency ?? DEFAULT_CURRENCY.currency,
  })
}

/**
 * A currency figure with its SYMBOL and its CENTS dimmed, so a column of them reads as a column of
 * magnitudes:
 *
 *        $928.25
 *     $12,275.00
 *      $1,472.98
 *          $0.00
 *
 * The significant digits are what you scan; the `$` repeats on every row and the cents are almost
 * never the thing being compared, so both step back a tone and the eye lands on the number. Right-
 * alignment does the rest (the header stays left-aligned - see `GridHeader`), and `tabular-nums`
 * keeps the digits in columns of their own.
 *
 * The symbol and the decimal separator come from `Intl`, not from a hard-coded `$` and `.`: a Box
 * that sets `currency='EUR'` needs the symbol to move and the separator to become a comma, and the
 * dimming has to follow it rather than dim the wrong character.
 */
export function Money({
  value,
  locale,
  currency,
  className,
}: { value: number | null; className?: string } & CurrencyFormat) {
  if (value == null) return <span className={cn('text-fg-4', className)}>-</span>
  const parts = new Intl.NumberFormat(locale ?? DEFAULT_CURRENCY.locale, {
    style: 'currency',
    currency: currency ?? DEFAULT_CURRENCY.currency,
  }).formatToParts(value)

  // The symbol and the fraction (with its separator) step back a tone; the integer digits do not.
  const dim = (type: Intl.NumberFormatPart['type']) =>
    type === 'currency' || type === 'decimal' || type === 'fraction'
  return (
    <span className={cn('tabular-nums', className)}>
      {parts.map((p, i) =>
        dim(p.type) ? (
          <span key={i} className='text-fg-4'>
            {p.value}
          </span>
        ) : (
          p.value
        ),
      )}
    </span>
  )
}

/** A percentage with the `%` dimmed, for the same reason `Money` dims the `$`. `decimals` is for an
 *  AVERAGE of percentages, where dropping the fraction would round 42.5% and 42.4% to the same thing. */
export function Percent({
  value,
  decimals = 0,
  className,
}: {
  value: number | null
  decimals?: number
  className?: string
}) {
  if (value == null) return <span className={cn('text-fg-4', className)}>-</span>
  return (
    <span className={cn('tabular-nums', className)}>
      {value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      <span className='text-fg-4'>%</span>
    </span>
  )
}

/** A plain count. Whole by default; `decimals` is what an AVERAGE of counts needs (2.4 tasks). */
export function Count({
  value,
  decimals = 0,
  className,
}: {
  value: number | null
  decimals?: number
  className?: string
}) {
  if (value == null) return <span className={cn('text-fg-4', className)}>-</span>
  return (
    <span className={cn('tabular-nums', className)}>
      {value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  )
}
