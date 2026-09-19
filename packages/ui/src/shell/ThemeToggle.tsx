import { Moon, Sun } from 'lucide-react'
import * as React from 'react'
import { getTheme, toggleTheme, type Theme } from '../lib/theme.ts'
import { Button } from '../components/Button.tsx'

// Single icon-button theme toggle: light ↔ dark. The icon shows the theme you'll
// switch *to* (moon while light, sun while dark). First launch seeds from the OS
// preference (see getTheme). Lives at the bottom of the sidebar (see `Sidebar`).
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
