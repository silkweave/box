import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/app.css'
import { applyTheme, getTheme } from '@silkweave/box-ui/lib'
import { APP_THEME_KEY } from './lib/storage.ts'
import { App } from './App.tsx'

// Keep <html data-theme> in sync with the persisted pref (the inline head script
// already does this pre-paint; this re-asserts after load, and seeds the pref
// from the OS preference on first launch). The KEY is the app's, not the library's default:
// index.html's pre-paint script reads the same string (vite.config.ts substitutes it), and the
// two disagreeing is what gave every dark-mode user a light flash from 2026-09-14 to 2026-09-15.
applyTheme(getTheme(APP_THEME_KEY))

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
