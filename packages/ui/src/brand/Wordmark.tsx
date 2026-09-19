import { cn } from '../lib/utils.ts'

import { createContext, useContext, type ReactNode } from 'react'

export interface BrandIdentity {
  name: string
  wordmark: string
  suffix?: string
  logoUrl: string
}

// A standalone library has no application's brand. Supply one above the shell and login page.
const BrandContext = createContext<BrandIdentity>({ name: 'Box', wordmark: 'Box', logoUrl: '' })
export function BrandProvider({ value, children }: { value: BrandIdentity; children: ReactNode }) {
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
}

interface MarkProps {
  size?: number
  className?: string
  title?: string
}

/** An image keeps SVG gradient/filter IDs isolated when the mark appears more than once. */
export function Mark({ size = 24, className, title }: MarkProps) {
  const brand = useContext(BrandContext)
  if (!brand.logoUrl) return null
  return (
    <img
      src={brand.logoUrl}
      width={size}
      height={size}
      alt={title ?? brand.name}
      className={cn('shrink-0 select-none', className)}
      draggable={false}
    />
  )
}

interface WordmarkProps {
  /** `full` = mark + wordmark; `small` = compact; `mark` = glyph only. */
  size?: 'full' | 'small' | 'mark'
  className?: string
}

export function Wordmark({ size = 'full', className }: WordmarkProps) {
  const brand = useContext(BrandContext)
  if (size === 'mark') return <Mark className={className} />
  const markSize = size === 'small' ? 20 : 24
  return (
    <span className={cn('flex items-center gap-2 text-text', className)}>
      <Mark size={markSize} />
      <span className={cn('font-sans font-semibold tracking-tight', size === 'small' ? 'text-body' : 'text-heading-3')}>
        {brand.wordmark}
        {brand.suffix && <span className='ml-1 font-normal text-muted-foreground'>{brand.suffix}</span>}
      </span>
    </span>
  )
}
