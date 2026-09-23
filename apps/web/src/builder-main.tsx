import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfirmHost } from '@silkweave/box-ui'
import { applyTheme, getTheme } from '@silkweave/box-ui/lib'
import { APP_THEME_KEY } from './lib/storage.ts'
import { BuilderView } from './views/BuilderView.tsx'
import './styles/builder.css'

// This entry must never import App, the feature registry, or the normal application router.
applyTheme(getTheme(APP_THEME_KEY))
// A theme toggle in the live iframe should also update the stable outer shell.
window.addEventListener('storage', event => {
  if (event.key === APP_THEME_KEY) applyTheme(getTheme(APP_THEME_KEY))
})
const root = document.getElementById('root')
if (!root) throw new Error('Builder root not found')
createRoot(root).render(<StrictMode><BuilderView /><ConfirmHost /></StrictMode>)
