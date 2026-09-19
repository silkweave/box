import { useRef } from 'react'
import { Link as LinkIcon } from 'lucide-react'
import { cn } from '../lib/utils.ts'

// A URL field with a trailing addon that opens what is in it.
//
// The resting style is InlineEdit's: transparent until hovered or focused. It was written twice -
// once here and once in `InlineEdit` - which is exactly the kind of rule that must not live in two
// packages, so this one came into the library on 2026-09-14 to sit beside the other.
const inputCls =
  'peer min-w-0 flex-1 rounded-md rounded-r-none border border-transparent bg-transparent px-2 py-1.5 text-body-sm text-text outline-none transition-colors placeholder:text-fg-4 hover:border-border-light hover:bg-accent-tint focus:cursor-text focus:border-accent focus:bg-bg'

/** Normalize to an openable href (assume https:// if no scheme given). */
const href = (v: string) => (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`)

/**
 * URL text input with a trailing Link-icon addon that opens the current value in a new tab. Works
 * controlled (`value` + `onChange`) or uncontrolled (`defaultValue` + `onCommit` on blur); the addon
 * reads the live input value either way.
 */
export function UrlInput({
  value,
  defaultValue,
  onChange,
  onCommit,
  placeholder,
  className,
}: {
  value?: string
  defaultValue?: string
  onChange?: (v: string) => void
  onCommit?: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const open = () => {
    const v = (value ?? ref.current?.value ?? '').trim()
    if (v) window.open(href(v), '_blank', 'noopener,noreferrer')
  }
  return (
    <div className={cn('group flex', className)}>
      <input
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        onBlur={onCommit ? (e) => onCommit(e.target.value) : undefined}
        placeholder={placeholder}
        className={inputCls}
      />
      <button
        type='button'
        onClick={open}
        title='Open link'
        aria-label='Open link'
        className='-ml-px inline-flex items-center justify-center rounded-md rounded-l-none border border-transparent px-2 text-fg-4 opacity-60 transition-all hover:text-accent group-hover:opacity-100 peer-focus:opacity-100'>
        <LinkIcon className='size-3.5' />
      </button>
    </div>
  )
}
