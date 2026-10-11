import type { Meta, StoryObj } from '@storybook/react-vite'
import { CopyLinkButton } from './CopyLinkButton.tsx'

const meta = {
  title: 'Base/CopyLinkButton',
  component: CopyLinkButton,
} satisfies Meta<typeof CopyLinkButton>

export default meta
type Story = StoryObj<typeof meta>

/** Copies the page's own address; a tick replaces the link icon for a moment as the confirmation. */
export const Default: Story = {
  args: { label: 'Copy link to this account' },
}

/** A record shown over the page (a pop-up) passes its own address as `href`. */
export const ExplicitHref: Story = {
  args: { label: 'Copy link to this order', href: 'https://box.example/crm/orders/42' },
}
