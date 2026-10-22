import * as React from 'react'
import { LogOut, Plug2, UserCircle2, Users as UsersIcon } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogTitle, InlineDialogScope, ConfirmHost, SETTINGS_GUTTER, SettingsFooterBar, SettingsPane, useSettingsFooter } from '@silkweave/box-ui'
import { useSettingsDialog } from '../lib/settingsDialog.ts'
import type { SettingsSection } from '../feature.ts'
import { ALL_WEB_FEATURES } from '../web-features.ts'
import { useAuth } from '../lib/useAuth.tsx'
import { upsertUser, useUsersData } from '../lib/useUsersData.ts'
import type { User } from '../user-types.ts'
import { cn } from '@/lib/utils'
import { UsersView } from './UsersView.tsx'
import { AgentToolsView } from './AgentToolsView.tsx'
import { AgentAccountsPanel } from '../components/agent/AgentAccountsPanel.tsx'
import { UserProfileForm, userFormDirty, userFormValues, userUpsertInput } from '../components/UserProfileForm.tsx'

/** Settings sections. Each carried a role ACL until 2026-09-10; every signed-in principal now sees
 *  all of them, matching a server that no longer gates any of them either. */
/** Core's sections; features add theirs through `settings` in their manifest (order bands as nav). */
const CORE_SECTIONS: SettingsSection[] = [
  { id: 'users', label: 'Users', icon: UsersIcon, order: 100, render: () => <UsersView /> },
  { id: 'agent-tools', label: 'Agent tools', icon: Plug2, order: 105, render: () => <AgentToolsView /> },
  { id: 'profile', label: 'Profile', icon: UserCircle2, order: 0, render: () => <ProfileSection /> },
]

let cachedSections: SettingsSection[] | undefined
function allSections(): SettingsSection[] {
  cachedSections ??= [...CORE_SECTIONS, ...ALL_WEB_FEATURES.flatMap((f) => f.settings ?? [])].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  )
  return cachedSections
}

/** One app-wide overlay. Feature registration is read lazily to avoid import cycles. */
export function SettingsDialogHost() {
  const { isOpen, section, params, open, close } = useSettingsDialog()
  const activeNav = React.useRef<HTMLButtonElement>(null)
  const sections = allSections()
  const active = sections.find((s) => s.id === section) ?? sections.find((s) => s.id === 'profile')!
  React.useEffect(() => { activeNav.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [isOpen, active.id])
  return <>
    {!isOpen && <ConfirmHost />}
    <Dialog open={isOpen} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent initialFocus={activeNav} showClose={false} className='h-dvh w-screen max-w-none gap-0 overflow-hidden rounded-none p-0 sm:h-[min(48rem,90dvh)] sm:w-[min(1024px,calc(100vw-4rem))] sm:rounded-xl'>
        <div className='flex min-h-0 flex-1 flex-col sm:flex-row'>
          <nav aria-label='Settings sections' className='order-last flex shrink-0 gap-1 overflow-auto border-t border-border bg-bg p-2 sm:order-first sm:w-52 sm:flex-col sm:border-r sm:border-t-0 sm:pr-2 sm:pt-5'>
            <DialogTitle className='sr-only font-sans text-lg font-semibold sm:not-sr-only sm:px-3 sm:pb-3'>Settings</DialogTitle>
            {sections.map(({ id, label, icon: Icon }) => <button key={id} ref={id === active.id ? activeNav : undefined} type='button'
              aria-current={active.id === id ? 'page' : undefined}
              onClick={() => open(id)}
              className={cn('flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-body-sm hover:bg-accent-tint', active.id === id ? 'bg-accent-tint font-medium text-accent' : 'text-muted-foreground')}>
              <Icon className='size-4 shrink-0' /><span className='whitespace-nowrap'>{label}</span>
            </button>)}
          </nav>
          <div className='settings-dialog-detail order-first min-h-0 min-w-0 flex-1 sm:order-last sm:[&_header]:pr-6'>
            {isOpen && (
              <SettingsPane key={active.id} title={active.label} onClose={close}>
                <InlineDialogScope key={`${active.id}/${params.join('/')}`} scroll={false}>
                  <ConfirmHost />
                  <SettingsErrorBoundary>{active.render(active.id === section ? params : [])}</SettingsErrorBoundary>
                </InlineDialogScope>
              </SettingsPane>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>
}

class SettingsErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <p role='alert' className='p-8 text-body-sm text-danger'>This settings section could not load. Choose another section or reload the page.</p>
    return this.props.children
  }
}

/**
 * Self-scoped profile. Settings sections are deliberately canvas-like rather than a stack of
 * generic cards; contained surfaces are reserved for short callouts that need separation.
 */
function ProfileSection() {
  const { principal, logout } = useAuth()
  const { all } = useUsersData(true)
  const me = principal ? (all?.find((u) => u.id === principal.id) ?? null) : null

  return (
    <div className={`${SETTINGS_GUTTER} pb-6`}>
      {!principal ? (
        <p className='text-body-sm text-muted-foreground'>Not signed in.</p>
      ) : me ? (
        <div className='flex flex-col gap-8'>
          <ProfileForm key={`${me.id}:${me.updated_at}`} me={me} admin={principal.role === 'admin'} onSignOut={() => void logout()} />
          <AgentAccountsPanel user={me} isAgent={false} />
        </div>
      ) : (
        <div className='py-4'>
          <p className='font-medium text-text'>{principal.display}</p>
          <p className='text-label text-muted-foreground'>
            <code>{principal.id}</code>
          </p>
        </div>
      )}
    </div>
  )
}

/** The self-edit form - the same form as the Users editor. Buffered state with an explicit Save;
 *  the parent re-keys it on `updated_at` so a save reseeds it. */
function ProfileForm({ me, admin, onSignOut }: { me: User; admin: boolean; onSignOut: () => void }) {
  const stored = React.useMemo(() => userFormValues(me), [me])
  const [values, setValues] = React.useState(stored)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const isDirty = userFormDirty(values, stored)
  const nicknameSet = !!values.nickname.trim()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!nicknameSet) return setError('A nickname is required.')
    setSaving(true)
    void upsertUser(userUpsertInput(me.id, values))
      .then(() => {
        setSaving(false)
        setError(null)
      })
      .catch((err) => {
        setSaving(false)
        setError(String(err))
      })
  }

  useSettingsFooter(
    (shadowed) => (
      <SettingsFooterBar shadowed={shadowed} className='justify-between'>
        <Button type='button' variant='outline' size='sm' onClick={onSignOut}>
          <LogOut /> Sign out
        </Button>
        <Button type='submit' form='profile-form' size='sm' disabled={!isDirty || saving || !nicknameSet}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </SettingsFooterBar>
    ),
    [isDirty, nicknameSet, onSignOut, saving],
  )

  return (
    <UserProfileForm
      formId='profile-form'
      base={me}
      values={values}
      onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
      onSubmit={submit}
      meta={<span className='truncate'>@{values.nickname.trim() || me.id}</span>}
      emailReadOnly={!admin}
      emailHint={admin ? undefined : 'Ask an administrator to change it.'}
      phoneHint={admin ? 'International form. Messaging channels treat this number as a team member.' : 'Ask an administrator to change it.'}
      error={error}
      onError={setError}
    />
  )
}
