import { useEffect, useState } from 'react'
import { Check, Link2 } from 'lucide-react'
import { Button } from './Button.tsx'

/**
 * Copy the current page's address, for pasting into a chat. Icon-only, sized to sit in a detail
 * page's top bar beside its other record actions; a tick replaces the link icon for a moment as the
 * confirmation. The address is the page as the browser shows it - or `href`, for a record shown over
 * the page rather than as it (a pop-up) - so whoever opens it lands on the same record after signing in.
 */
export function CopyLinkButton({ label = 'Copy link', href }: { label?: string; href?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <Button
      variant='outline'
      size='icon-sm'
      title={copied ? 'Copied' : label}
      aria-label={label}
      onClick={() => void navigator.clipboard.writeText(href ?? window.location.href).then(() => setCopied(true))}>
      {copied ? <Check className='text-accent' /> : <Link2 />}
    </Button>
  )
}
