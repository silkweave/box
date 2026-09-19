import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { BrandProvider, Mark, Wordmark } from './Wordmark.tsx'

const meta = {
  title: 'Brand/Wordmark',
  decorators: [withStage, (Story) => <BrandProvider value={{
    name: 'Example Studio', wordmark: 'example', suffix: 'studio',
    logoUrl: new URL('../assets/silkweave-logo.svg', import.meta.url).href,
  }}><Story /></BrandProvider>],
  component: Wordmark,
} satisfies Meta<typeof Wordmark>

export default meta
type Story = StoryObj<typeof meta>

export const Full: Story = { args: { size: 'full' } }
export const Small: Story = { args: { size: 'small' } }
export const MarkOnly: Story = { args: { size: 'mark' } }

/**
 * The mark is drawn as an <img>, not inlined JSX: the artwork carries gradient and filter ids, and
 * two inlined copies on one page would collide on them and cross-wire each other's paint.
 */
export const Sizes: Story = {
  args: {},
  render: () => (
    <div className='flex items-center gap-4'>
      <Mark size={16} />
      <Mark size={24} />
      <Mark size={48} />
      <Mark size={96} />
    </div>
  ),
}
