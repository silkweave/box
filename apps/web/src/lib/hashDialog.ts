import { useRef } from 'react'
import { useBlocker, useNavigate, useRouterState } from '@tanstack/react-router'
import { askToLeave, type SettingsLeaveState } from '@silkweave/box-ui'

/**
 * A `RecordDialog` opened from the URL hash, like Settings (`#settings/roles`): `/sprints#new`
 * shows the sprints list with New sprint over it, so a reload or a shared link opens it again and
 * Back closes it. Navigating away while its form has unsaved changes asks first; a save in flight is
 * waited for.
 *
 * Use it as `const create = useHashDialog('new')`, a button with `onClick={create.open}`, and
 * `<RecordDialog {...create.dialog} title='New sprint'><Form onCancel={create.close} /></RecordDialog>`.
 * `name` is the hash: `new` for a list's create form, `settings` is taken by Settings; another
 * dialog on the same page takes its own (`new-ticket`, `room-settings`).
 */
export function useHashDialog(name: string) {
  const navigate = useNavigate()
  const isOpen = useRouterState({ select: (s) => s.location.hash.replace(/^#/, '') === name })
  const leaveCheck = useRef<(() => Promise<SettingsLeaveState>) | null>(null)
  useBlocker({ disabled: !isOpen, enableBeforeUnload: false, shouldBlockFn: () => askToLeave(leaveCheck) })
  const open = (): void => void navigate({ to: '.', search: true, hash: name, resetScroll: false, hashScrollIntoView: false })
  const close = (): void => void navigate({ to: '.', search: true, hash: '', replace: true, resetScroll: false, hashScrollIntoView: false })
  return { isOpen, open, close, dialog: { open: isOpen, onClose: close, leaveCheck } }
}
