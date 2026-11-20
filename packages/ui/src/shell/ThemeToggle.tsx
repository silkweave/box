import { Moon, Sun } from 'lucide-react'
import * as React from 'react'
import { getTheme, toggleTheme, type Theme } from '../lib/theme.ts'
import { Button } from '../components/Button.tsx'

/**
 * Single icon-button theme toggle: light and dark. The icon shows the theme you will switch to (moon
 * while light, sun while dark); first launch seeds from the OS preference (see `getTheme`).
 * Use it where the shell offers it, the bottom of the sidebar; an app rarely renders it itself.
 * Not for a feature's own on/off setting (`Switch`).
 * `storageKey` names where the choice is kept.
 */
export function ThemeToggle({ className, storageKey }: { className?: string; storageKey?: string }) {
  const [theme, setThemeState] = React.useState<Theme>(() => getTheme(storageKey))
  const next: Theme = theme === 'dark' ? 'light' : 'dark'

  return (
    <Button
      variant='ghost'
      size='icon'
      className={className}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setThemeState(toggleTheme(theme, storageKey))}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}
