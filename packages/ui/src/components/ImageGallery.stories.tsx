import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { ImageGallery, type GalleryImage } from './ImageGallery.tsx'

const meta = {
  title: 'Base/ImageGallery',
  decorators: [withStage],
  component: ImageGallery,
} satisfies Meta<typeof ImageGallery>

export default meta
type Story = StoryObj<typeof meta>

const frame = (label: string, fill: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800"><rect width="1280" height="800" fill="${fill}"/><text x="640" y="410" font-family="system-ui, sans-serif" font-size="56" text-anchor="middle" fill="#555">${label}</text></svg>`)}`

const images: GalleryImage[] = [
  { src: frame('Overview', '#eef0ff'), alt: 'Overview' },
  { src: frame('Detail', '#f3f6f1'), alt: 'Detail' },
  { src: frame('Settings', '#fbf1ec'), alt: 'Settings' },
]

export const Several: Story = { args: { images, className: 'w-[36rem]' } }

/** A single image draws no controls or thumbnails. */
export const Single: Story = { args: { images: images.slice(0, 1), className: 'w-[36rem]' } }
