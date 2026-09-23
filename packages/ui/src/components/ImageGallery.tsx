import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils.ts'

export interface GalleryImage {
  src: string
  alt: string
}

/**
 * One large image with previous/next controls and a thumbnail strip. Arrow keys move between
 * images while the gallery has focus. Renders nothing for an empty list.
 */
export function ImageGallery({ images, className }: { images: readonly GalleryImage[]; className?: string }) {
  const [index, setIndex] = useState(0)
  useEffect(() => { if (index >= images.length) setIndex(0) }, [images.length, index])
  if (images.length === 0) return null

  const current = images[Math.min(index, images.length - 1)]!
  const many = images.length > 1
  const step = (delta: number): void => setIndex(i => (i + delta + images.length) % images.length)

  return (
    <div
      data-slot='image-gallery'
      className={cn('flex flex-col gap-2 outline-none', className)}
      tabIndex={many ? 0 : undefined}
      aria-roledescription='gallery'
      onKeyDown={event => {
        if (!many) return
        if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
        if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
      }}>
      <div className='group relative overflow-hidden rounded-lg border border-border bg-bg'>
        <img src={current.src} alt={current.alt} className='aspect-[16/10] w-full object-cover' />
        {many && <>
          <button type='button' onClick={() => step(-1)} aria-label='Previous image' className='absolute top-1/2 left-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface/90 text-text opacity-0 shadow-(--shadow-sm) transition-opacity group-hover:opacity-100 focus-visible:opacity-100'><ChevronLeft className='size-4' /></button>
          <button type='button' onClick={() => step(1)} aria-label='Next image' className='absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface/90 text-text opacity-0 shadow-(--shadow-sm) transition-opacity group-hover:opacity-100 focus-visible:opacity-100'><ChevronRight className='size-4' /></button>
          <span className='absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-0.5 text-label text-white'>{index + 1} / {images.length}</span>
        </>}
      </div>
      {many && <div className='flex gap-2 overflow-x-auto pb-1'>
        {images.map((image, i) => (
          <button
            key={image.src}
            type='button'
            onClick={() => setIndex(i)}
            aria-label={`Show ${image.alt}`}
            aria-current={i === index ? 'true' : undefined}
            className={cn('w-24 shrink-0 overflow-hidden rounded-md border-2 transition-colors', i === index ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100')}>
            <img src={image.src} alt='' className='aspect-[16/10] w-full object-cover' />
          </button>
        ))}
      </div>}
    </div>
  )
}
