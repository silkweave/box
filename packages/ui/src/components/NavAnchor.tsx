import * as React from 'react'

/**
 * True for an unmodified primary click: the one gesture an app should turn into client-side
 * navigation. Anything else (Cmd/Ctrl for a new tab, Shift for a new window, Alt for download,
 * middle click) belongs to the browser.
 */
export function isPlainClick(e: React.MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented
}

export type NavAnchorProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'onClick'> & {
  /** Where the control leads. Without it the control renders as a `<button>`. */
  href?: string
  /** Runs on activation. With an `href`, only a plain click runs it; modified clicks open the URL. */
  onClick?: () => void
}

/**
 * A navigation control that stays a real link. The shell has no router, so it cannot render the
 * app's `<Link>`; instead it draws `<a href>` and hands a plain click to the caller's handler (which
 * navigates client-side), while Cmd/Ctrl/Shift/middle click keep the browser's own behaviour of
 * opening the URL in a new tab or window. Without an `href` it falls back to a button.
 */
export function NavAnchor({ href, onClick, children, ...rest }: NavAnchorProps) {
  if (href == null) {
    const { className, title, 'aria-label': ariaLabel, 'aria-current': ariaCurrent } = rest
    return (
      <button type='button' onClick={onClick} className={className} title={title} aria-label={ariaLabel} aria-current={ariaCurrent}>
        {children}
      </button>
    )
  }
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        if (!onClick || !isPlainClick(e) || rest.target) return
        e.preventDefault()
        onClick()
      }}>
      {children}
    </a>
  )
}
