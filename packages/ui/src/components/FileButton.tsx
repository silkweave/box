import * as React from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Button } from './Button.tsx'

/**
 * A button that opens the file picker and hands over the chosen file(s).
 *
 * Use it for: uploading a logo, an avatar, an import file, an attachment from a form or toolbar.
 * Not for: dropping files onto an area (a drop zone), a file path typed as text (use `Input`).
 * Props: `accept` and `multiple` as on a file input; `onFiles` gets the picked files (never an
 * empty list); `busy` shows a spinner and disables the button while the caller uploads; `icon`
 * replaces the upload icon; `children` is the label ("Upload", "Import CSV").
 * Rules: the hidden input is reset after each pick, so picking the same file again fires again.
 * The visible button carries the name; `aria-label` names it when the label is not enough.
 */
export function FileButton({ accept, multiple = false, onFiles, busy = false, disabled, icon, variant = 'outline', size = 'sm', className, children, 'aria-label': ariaLabel }: {
  accept?: string
  multiple?: boolean
  onFiles: (files: File[]) => void
  busy?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  variant?: 'outline' | 'ghost' | 'secondary' | 'default'
  size?: 'sm' | 'default'
  className?: string
  children: React.ReactNode
  'aria-label'?: string
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={ref}
        type='file'
        tabIndex={-1}
        aria-hidden='true'
        accept={accept}
        multiple={multiple}
        className='hidden'
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
      <Button type='button' variant={variant} size={size} aria-label={ariaLabel} disabled={disabled || busy} onClick={() => ref.current?.click()} className={className}>
        {busy ? <Loader2 className='animate-spin' /> : (icon ?? <Upload />)} {children}
      </Button>
    </>
  )
}
