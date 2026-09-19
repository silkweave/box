import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { Briefcase, Rss, Send } from 'lucide-react'
import { BRAND_ICONS, brandIcons, createIconTable } from './iconTable.tsx'

const meta = {
  title: 'Foundations/Iconography',
  decorators: [withStage],
  component: brandIcons.Glyph,
} satisfies Meta<typeof brandIcons.Glyph>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { name: 'github' } }

/**
 * The brand marks the library ships. Every one comes from @tabler/icons-react - the one set that
 * draws them on the same 24px / stroke-2 grid as lucide, so brand and UI icons read as one family.
 * Substack is hand-rolled, because neither set has it.
 *
 * The bar for this table is "a reader recognises the mark without a label". A name only one product
 * uses is the app's, not ours.
 */
export const BrandMarks: Story = {
  args: { name: 'github' },
  render: () => (
    <div className='grid grid-cols-4 gap-4'>
      {Object.keys(BRAND_ICONS).map((name) => (
        <span key={name} className='inline-flex items-center gap-2 text-body-sm text-text'>
          <brandIcons.Glyph name={name} className='size-4' />
          {name}
        </span>
      ))}
    </div>
  ),
}

/** An unknown key still draws, rather than punching a hole in a row of icons. */
export const UnknownFallsBack: Story = {
  args: { name: 'mastodon' },
  render: () => (
    <span className='inline-flex items-center gap-2 text-body-sm text-text'>
      <brandIcons.Glyph name='mastodon' className='size-4' /> mastodon (unknown → Activity)
    </span>
  ),
}

/**
 * A Box's own table: the brand marks, plus its own keys, plus its own key normalisation. This is
 * the whole point of the split - one company's private channel ids and the `github@dan`
 * account-variant convention used to be hard-coded in the library, which made that company's
 * vocabulary part of the design system.
 */
const appIcons = createIconTable(
  { ...BRAND_ICONS, blog: Rss, business: Briefcase, newsletter: Send },
  { keyOf: (k) => k.split('@')[0] ?? k },
)

export const ABoxsOwnTable: Story = {
  args: { name: 'newsletter' },
  render: () => (
    <div className='flex flex-col gap-3 text-body-sm text-text'>
      <div className='flex items-center gap-6'>
        {['newsletter', 'business', 'blog'].map((name) => (
          <span key={name} className='inline-flex items-center gap-2'>
            <appIcons.Glyph name={name} className='size-4' /> {name}
          </span>
        ))}
      </div>
      <span className='inline-flex items-center gap-2'>
        <appIcons.Glyph name='github@dan' className='size-4' /> github@dan (keyOf strips the account)
      </span>
    </div>
  ),
}
