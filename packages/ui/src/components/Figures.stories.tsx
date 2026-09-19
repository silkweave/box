import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { Count, Money, Percent } from './Figures.tsx'

const meta = {
  title: 'Base/Figures',
  decorators: [withStage],
  component: Money,
} satisfies Meta<typeof Money>

export default meta
type Story = StoryObj<typeof meta>

/**
 * How a NUMBER is drawn anywhere in the app. Nothing here knows what the quantity means; it is pure
 * presentation of one. Money always shows two decimals, even on a round number - a column where
 * some rows carry cents and some do not is a column of different-width strings.
 */
export const Default: Story = { args: { value: 798 } }

export const InAColumn: Story = {
  args: { value: 0 },
  render: () => (
    <table className='text-body-sm text-text'>
      <tbody>
        {[798, 332.3, 4800, null, 12].map((v, i) => (
          <tr key={i}>
            <td className='py-0.5 pr-8 text-right tabular-nums'><Money value={v} /></td>
            <td className='py-0.5 pr-8 text-right tabular-nums'><Percent value={v == null ? null : v / 100} decimals={1} /></td>
            <td className='py-0.5 text-right tabular-nums'><Count value={v} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}

/** null is a dash in the muted tone, never a zero: "no value" and "zero" are different facts. */
export const Missing: Story = { args: { value: null } }

/**
 * `locale` and `currency` are props, and the dimming follows `Intl` rather than a hard-coded `$`
 * and `.`.
 *
 * That is the whole reason this stopped being `formatMrr`: the old code interpolated a literal `$`
 * and split on a literal `.`, so a Box outside the US got the wrong symbol in the wrong place with
 * the wrong character dimmed. In de-DE the symbol moves to the end and the separator is a comma -
 * note that the right parts still step back.
 */
export const Currencies: Story = {
  args: { value: 12275 },
  render: () => (
    <table className='text-body-sm text-text'>
      <tbody>
        {[
          ['en-US', 'USD'],
          ['en-GB', 'GBP'],
          ['de-DE', 'EUR'],
          ['ja-JP', 'JPY'],
        ].map(([locale, currency]) => (
          <tr key={locale}>
            <td className='py-0.5 pr-6 text-muted-foreground'>{locale} / {currency}</td>
            <td className='py-0.5 text-right tabular-nums'>
              <Money value={12275} locale={locale} currency={currency} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}
