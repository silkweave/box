import { useNavigate, useRouterState } from '@tanstack/react-router'

import { parseSettingsHash, settingsHash } from './settingsLocation.ts'

/** Hash navigation keeps the current route, filters, and mounted page intact. */
export function useSettingsDialog() {
  const navigate = useNavigate()
  const hash = useRouterState({ select: (s) => s.location.hash })
  const location = parseSettingsHash(hash)
  return {
    isOpen: !!location,
    section: location?.section,
    params: location?.params ?? [],
    open: (path = '') => void navigate({ search: true, hash: settingsHash(path), resetScroll: false, hashScrollIntoView: false }),
    close: () => void navigate({ search: true, hash: '', replace: true, resetScroll: false, hashScrollIntoView: false }),
  }
}
