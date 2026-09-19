import type { Meta, StoryObj } from '@storybook/react-vite'
import { PageContainer } from './PageContainer.tsx'

const meta = {
  title: 'Layout/PageContainer',
  component: PageContainer,
} satisfies Meta<typeof PageContainer>

export default meta
type Story = StoryObj<typeof meta>

const Body = () => (
  <div className='rounded-lg border border-dashed border-border p-6 text-body-sm text-muted-foreground'>
    The page's content. The container owns the max width and the page gutter, so no view has to
    decide either for itself.
  </div>
)

export const Default: Story = { args: { children: <Body /> } }

/** The whole scale, and nothing outside it. `flush` is the only step that drops the page padding:
 *  it is for a surface that IS the page, like a data grid whose header row wants the full frame. */
export const Widths: Story = {
  args: { children: null },
  render: () => (
    <div className='space-y-4'>
      {(['reading', 'wide', 'full', 'flush'] as const).map((width) => (
        <PageContainer key={width} width={width}>
          <div className='rounded-lg border border-dashed border-border p-4 text-body-sm text-muted-foreground'>
            width={width}
          </div>
        </PageContainer>
      ))}
    </div>
  ),
}
