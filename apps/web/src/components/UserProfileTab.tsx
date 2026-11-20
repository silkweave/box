import * as React from 'react'
import { LogOut } from 'lucide-react'
import { Button, SettingsDeleteButton, SettingsSaveBar, useSettingsForm } from '@silkweave/box-ui'
import { deleteUser, upsertUser } from '../lib/useUsersData.ts'
import { userName, type User } from '../user-types.ts'
import { UserProfileForm, userFormDirty, userFormValues, userUpsertInput } from './UserProfileForm.tsx'

/** nickname → slug id: lowercase, non-alphanumerics → '-', trimmed. Matches the server's slug rules. */
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

const NEW_USER: User = {
  id: 'new', first_name: '', last_name: '', nickname: '', email: null, phone: null, image: null, color: null,
  status: 'active', channels: {}, agent_profile: null, has_token: false, sort: 0, created_at: '', updated_at: '',
}

/**
 * The Profile tab of a person: the person form with its own Save footer. Settings > Profile
 * (`self`, Sign out at the footer's start) and a Users page (`directory`: the create page when `user`
 * is null, else Delete at the start for an administrator) draw the same tab, so the two never drift.
 * The form hook runs here, inside the tab, so leaving the tab with edits asks first.
 */
export function UserProfileTab({ mode, user, admin, existingIds = [], badges, canDelete = false, onSignOut, onClose }: {
  mode: 'self' | 'directory'
  /** The stored user; null only for the create page. */
  user: User | null
  /** Whether the signed-in person is an administrator (the email and phone are theirs to change). */
  admin: boolean
  existingIds?: string[]
  badges?: React.ReactNode
  canDelete?: boolean
  onSignOut?: () => void
  /** Back to the list after Create, Delete or Cancel. */
  onClose?: () => void
}) {
  const editing = user
  const stored = React.useMemo(() => userFormValues(editing), [editing])
  const form = useSettingsForm({
    stored,
    create: !editing,
    equals: (a, b) => !userFormDirty(a, b),
    validate: (v) => {
      if (!v.nickname.trim()) return mode === 'self' ? 'A nickname is required.' : 'A nickname is required; it seeds the id.'
      const id = editing ? editing.id : slugify(v.nickname)
      if (!id) return 'The nickname needs a letter or digit.'
      if (!editing && existingIds.includes(id)) return `A user with id "${id}" already exists.`
      return null
    },
    onSave: async (v) => {
      await upsertUser(userUpsertInput(editing ? editing.id : slugify(v.nickname), v))
      if (!editing) onClose?.()
    },
  })
  const id = editing ? editing.id : slugify(form.values.nickname)
  const handle = form.values.nickname.trim() || id
  return (
    <>
      <UserProfileForm
        form={form}
        base={editing ?? { ...NEW_USER, id: id || 'new' }}
        autoFocusNickname={!editing}
        badges={badges}
        meta={mode === 'self' ? <span className='truncate'>@{handle}</span> : id ? <code>{id}</code> : <span>The nickname seeds the id.</span>}
        emailReadOnly={mode === 'self' ? !admin : !!editing && !admin}
        emailHint={mode === 'self' ? (admin ? undefined : 'Ask an administrator to change it.') : admin ? 'Identity for sign-in elsewhere; no mail is sent.' : 'Ask an administrator to change it.'}
        phoneHint={admin ? 'International form. Messaging channels treat this number as a team member.' : 'Ask an administrator to change it.'}
      />
      <SettingsSaveBar
        form={form}
        create={editing ? undefined : 'Create user'}
        onCancel={mode === 'self' ? undefined : editing ? form.reset : onClose}
        start={mode === 'self' ? (
          <Button type='button' variant='outline' size='sm' onClick={onSignOut}>
            <LogOut /> Sign out
          </Button>
        ) : editing && canDelete ? (
          <SettingsDeleteButton
            label='Delete user'
            confirm={{ title: `Delete ${userName(editing)}?`, message: 'They are unassigned from any initiatives and tasks.' }}
            onDelete={async () => {
              await deleteUser(editing.id)
              onClose?.()
            }}
          />
        ) : undefined}
      />
    </>
  )
}
