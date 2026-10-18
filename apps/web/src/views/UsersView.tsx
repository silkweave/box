import { useSettingsDialog } from '../lib/settingsDialog.ts'
import { useAuth } from '../lib/useAuth.tsx'
import { AgentAccountsPanel } from '../components/agent/AgentAccountsPanel.tsx'
import { slotComponents } from '../lib/slots.ts'
import * as React from 'react'
import {
  Check,
  Copy,
  KeyRound,
  Link2,
  MoreHorizontal,
  Bot,
  Plus,
  Send,
  ShieldCheck,
  ShieldOff,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Avatar, Badge, type BadgeProps, Button, Checkbox, confirm, InlineDialog as Dialog, InlineDialogContent as DialogContent, InlineDialogDescription as DialogDescription, InlineDialogTitle as DialogTitle, Popover, PopoverContent, PopoverTrigger, SETTINGS_GUTTER, SettingsActions, SettingsField, SettingsFooterBar, SettingsIntro, SettingsList, SettingsListRow, settingsInputCls, settingsRowActionCls, useSettingsFooter } from '@silkweave/box-ui'
import { UserProfileForm, userFormValues, userUpsertInput } from '../components/UserProfileForm.tsx'
import { WorkFoldersInput } from '../components/WorkFoldersInput.tsx'
import {
  createAgent,
  deleteUser,
  setUserRole,
  inviteUser,
  signinLink,
  revealUserInvite,
  revokeUserAccess,
  upsertUser,
  useUsersData,
  type UserInvite,
  type UserSigninLink,
} from '../lib/useUsersData.ts'
import { DEFAULT_WORK_ACCESS, USER_STATUS_META, userName, type User, type WorkAccess } from '../user-types.ts'
import { cn } from '@/lib/utils'

/** nickname → slug id: lowercase, non-alphanumerics → '-', trimmed. Matches the server's slug rules. */
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

type DialogState = { mode: 'new' } | { mode: 'new-agent' } | { mode: 'edit'; user: User } | null

/**
 * Settings -> Users - the people directory. Create/edit/delete plus the invite lifecycle (sign-in link
 * mint/reveal/rotate/revoke). It was role-filtered and admin-gated until 2026-09-10; every signed-in
 * principal now manages it, and there are no roles left to filter by. See docs/AUTH.md.
 */
export function UsersView() {
  const { all: users, error } = useUsersData()
  const { params, open } = useSettingsDialog()
  const selectedUser = users?.find((u) => u.id === params[0])
  const dialog: DialogState = params[0] === 'new' ? { mode: 'new' } : params[0] === 'new-agent' ? { mode: 'new-agent' } : selectedUser ? { mode: 'edit', user: selectedUser } : null
  const setDialog = (next: DialogState) => open(next ? `users/${next.mode === 'edit' ? next.user.id : next.mode}` : 'users')
  const { principal } = useAuth()
  const [failure, setFailure] = React.useState<string | null>(null)
  const [invite, setInvite] = React.useState<UserInvite | null>(null)
  const [link, setLink] = React.useState<UserSigninLink | null>(null)
  // The list owns the footer only while no editor is open; the editor publishes its own Save bar.
  useSettingsFooter(
    dialog
      ? null
      : (shadowed) => (
          <SettingsFooterBar shadowed={shadowed}>
            {principal?.role === 'admin' && (
              <Button size='sm' variant='outline' onClick={() => open('users/new-agent')}>
                <Bot /> New agent
              </Button>
            )}
            <Button size='sm' onClick={() => open('users/new')}>
              <Plus /> New user
            </Button>
          </SettingsFooterBar>
        ),
    [principal?.role],
  )

  const shown = users ?? []

  const onDelete = async (u: User) => {
    const message = 'They will be unassigned from any initiatives and tasks.'
    if (!(await confirm({ title: `Delete ${userName(u)}?`, message, confirmLabel: 'Delete', danger: true }))) return
    void deleteUser(u.id).catch((e) => setFailure(String(e)))
  }

  return (
    <div className='pb-4'>
      <SettingsIntro>Everyone with a principal. Each signs in with a short-lived sign-in link, or with their own access token.</SettingsIntro>

      {failure && <p role='alert' className={`${SETTINGS_GUTTER} pb-4 text-body-sm text-danger`}>{failure}</p>}
      {error && <p className={`${SETTINGS_GUTTER} pb-4 text-body-sm text-danger`}>Failed to load users: {error}</p>}

      {!users ? (
        <p className={`${SETTINGS_GUTTER} text-body-sm text-muted-foreground`}>Loading…</p>
      ) : shown.length === 0 ? (
        <p className={`${SETTINGS_GUTTER} py-8 text-body-sm text-muted-foreground`}>Nobody here yet.</p>
      ) : (
        <SettingsList label='Users'>
          {shown.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={false}
              onEdit={() => setDialog({ mode: 'edit', user: u })}
              onDelete={() => onDelete(u)}
              onInvited={setInvite}
              onSigninLink={setLink}
            />
          ))}
        </SettingsList>
      )}

      {dialog?.mode === 'new-agent' && (
        <AgentCreateDialog
          existingIds={(users ?? []).map((u) => u.id)}
          onClose={() => setDialog(null)}
          onCreated={(u) => setDialog({ mode: 'edit', user: u })}
        />
      )}
      {dialog && dialog.mode !== 'new-agent' && (
        <UserDialog
          key={dialog.mode === 'edit' ? dialog.user.id : 'new'}
          state={dialog}
          existingIds={(users ?? []).map((u) => u.id)}
          onClose={() => setDialog(null)}
        />
      )}
      {invite && <InviteDialog invite={invite} onClose={() => setInvite(null)} />}
      {link && <SigninLinkDialog link={link} onClose={() => setLink(null)} />}
    </div>
  )
}

/** What someone is, as a badge: an agent (the system principal included), else their role. */
function roleBadge(user: User, systemId: string | undefined): { variant: BadgeProps['variant']; label: string; title: string } {
  if (user.kind === 'agent' || user.id === systemId) {
    return { variant: 'info', label: 'agent', title: user.id === systemId ? "The Box's system agent (box.json agent)" : `An agent (data/config/agents/${user.id}.md)` }
  }
  return user.role === 'admin'
    ? { variant: 'accent', label: 'admin', title: 'Admin: manages users, credentials and the Box' }
    : { variant: 'neutral', label: 'member', title: 'Member' }
}

function RoleBadge({ user }: { user: User }) {
  const { agent } = useAuth()
  const b = roleBadge(user, agent?.id)
  return <Badge variant={b.variant} className='shrink-0' title={b.title}>{b.label}</Badge>
}
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  active: 'success',
  invited: 'warning',
  revoked: 'danger',
}

const iconBtnCls = settingsRowActionCls

/**
 * One directory row. The whole row opens the editor; Delete and the access lifecycle (sign-in
 * link, token view/rotate, disable/enable, behind More) sit at its end.
 *
 *   AVATAR  Full name  [role]     email            status   🗑 ⋯
 *           @handle
 */
function UserRow({
  user,
  isSelf,
  onEdit,
  onDelete,
  onInvited,
  onSigninLink,
}: {
  user: User
  isSelf: boolean
  onEdit: () => void
  onDelete: () => void
  onInvited: (i: UserInvite) => void
  onSigninLink: (l: UserSigninLink) => void
}) {
  const status = USER_STATUS_META[user.status as keyof typeof USER_STATUS_META]

  return (
    <SettingsListRow onOpen={onEdit} label={`Edit ${userName(user)}`} className='grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,1fr)_5.5rem_auto]'>
      <Avatar user={user} size='md' />
      <div className='min-w-0'>
        <p className='flex items-center gap-2'>
          <span className='truncate font-medium text-text'>{userName(user)}</span>
          <RoleBadge user={user} />
        </p>
        <p className='truncate text-label text-muted-foreground'>@{user.nickname || user.id}</p>
      </div>
      <p className='hidden truncate text-body-sm text-muted-foreground md:block' title={user.email ?? undefined}>
        {user.email || <span className='text-fg-4'>No email</span>}
      </p>
      <div className='hidden md:block'>
        {status && <Badge variant={STATUS_VARIANT[user.status] ?? 'neutral'}>{status.label}</Badge>}
      </div>
      <div className='flex shrink-0 items-center justify-end gap-0.5'>
        {!isSelf && (
          <button
            type='button'
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title='Delete user'
            aria-label={`Delete ${userName(user)}`}
            className={cn(iconBtnCls, 'hover:bg-danger/10 hover:text-danger')}>
            <Trash2 className='size-3.5' />
          </button>
        )}
        <MoreMenu user={user} isSelf={isSelf} onInvited={onInvited} onSigninLink={onSigninLink} />
      </div>
    </SettingsListRow>
  )
}

/**
 * The access-lifecycle context menu behind "More" (admin-only).
 *
 * "Send sign-in link" is deliberately first: it is the right answer to "how do I get this person
 * in", it needs no permanent credential to change hands, and it expires. The access token below it
 * is for wiring up an MCP client, not for signing in.
 */
function MoreMenu({
  user,
  isSelf,
  onInvited,
  onSigninLink,
}: {
  user: User
  isSelf: boolean
  onInvited: (i: UserInvite) => void
  onSigninLink: (l: UserSigninLink) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const isDisabled = user.status === 'revoked'

  const run = (fn: () => Promise<void>) => {
    setBusy(true)
    void fn()
      .catch((e) => setFailure(String(e)))
      .finally(() => {
        setBusy(false)
        setOpen(false)
      })
  }

  const viewInvitation = () =>
    run(async () => onInvited(user.has_token ? await revealUserInvite(user.id) : await inviteUser(user.id)))
  const sendSigninLink = () => run(async () => onSigninLink(await signinLink(user.id)))
  const rotate = async () => {
    if (
      !(await confirm({
        title: 'Rotate the access token?',
        message:
          'This is a password reset, not an extra device. The current token stops working immediately, everywhere it is pasted: browser logins, MCP configs, scripts. If they only lost it, use "View access token" instead - that shows the SAME token and breaks nothing. If they just need to get IN, send a sign-in link; that needs no token at all.',
        confirmLabel: 'Rotate',
        danger: true,
      }))
    )
      return
    run(async () => onInvited(await inviteUser(user.id)))
  }
  const disable = async () => {
    if (
      !(await confirm({
        title: `Disable ${userName(user)}?`,
        message: 'Their access ends immediately (any live session dies on its next request).',
        confirmLabel: 'Disable',
        danger: true,
      }))
    )
      return
    run(() => revokeUserAccess(user.id))
  }
  const enable = async () => {
    if (
      !(await confirm({
        title: `Enable ${userName(user)}?`,
        message: 'A NEW access token is minted (their old one is dead). Send them a sign-in link to get back in.',
        confirmLabel: 'Enable',
      }))
    )
      return
    run(async () => onInvited(await inviteUser(user.id)))
  }

  return (
    <>
      {failure && <span role='alert' className='text-body-sm text-danger'>{failure}</span>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger onClick={(e) => e.stopPropagation()} title='More actions' aria-label={`More actions for ${userName(user)}`} className={iconBtnCls}>
          <MoreHorizontal className='size-4' />
        </PopoverTrigger>
        <PopoverContent align='end' className='w-60 gap-0.5 p-1.5'>
          {!isDisabled && (
            <>
              <MenuItem icon={Send} disabled={busy} onClick={sendSigninLink}>
                Send sign-in link
              </MenuItem>
              <MenuItem icon={Link2} disabled={busy} onClick={viewInvitation}>
                {user.has_token ? 'View access token' : 'Create access token'}
              </MenuItem>
              {user.has_token && (
                <MenuItem icon={KeyRound} disabled={busy} onClick={rotate}>
                  Rotate access token
                </MenuItem>
              )}
              {!isSelf && (
                <MenuItem icon={ShieldOff} disabled={busy} danger onClick={disable}>
                  Disable user
                </MenuItem>
              )}

    </>
        )}
        {isDisabled && (
          <MenuItem icon={ShieldCheck} disabled={busy} onClick={enable}>
            Enable user
          </MenuItem>
        )}
      </PopoverContent>
    </Popover>
    </>
  )
}

function SigninLinkDialog({ link, onClose }: { link: UserSigninLink; onClose: () => void }) {
  const [copied, setCopied] = React.useState<'message' | 'link' | null>(null)
  const copy = (what: 'message' | 'link', text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    })
  }
  const expires = new Date(link.expiresAt)
  const minutes = Math.max(1, Math.round((expires.getTime() - Date.now()) / 60_000))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-lg'>
        <DialogTitle>Sign-in link for {link.user.nickname || link.user.id}</DialogTitle>
        <DialogDescription>
          Send this to them (Lark/DM/email). It works <strong>once</strong> and expires in about{' '}
          {minutes} {minutes === 1 ? 'minute' : 'minutes'}. It carries no permanent credential, so it is
          safe to send - and if it expires before they get to it, just make another.
        </DialogDescription>
        <div className='mt-3 flex flex-col gap-3'>
          <div>
            <div className='mb-1 flex items-center justify-between'>
              <span className='text-label font-medium text-muted-foreground'>Message</span>
              <Button size='sm' variant='ghost' onClick={() => copy('message', link.message)}>
                {copied === 'message' ? <><Check className='size-3.5' /> Copied</> : <><Copy className='size-3.5' /> Copy</>}
              </Button>
            </div>
            <pre className='max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-2.5 text-body-sm text-text'>{link.message}</pre>
          </div>
          <div>
            <div className='mb-1 flex items-center justify-between'>
              <span className='text-label font-medium text-muted-foreground'>Sign-in link</span>
              <Button size='sm' variant='ghost' onClick={() => copy('link', link.url)}>
                {copied === 'link' ? <><Check className='size-3.5' /> Copied</> : <><Copy className='size-3.5' /> Copy</>}
              </Button>
            </div>
            <code className='block break-all rounded-md border border-border bg-bg p-2.5 text-label text-accent'>{link.url}</code>
          </div>
        </div>
        <SettingsActions>
          <Button size='sm' onClick={onClose}>
            Done
          </Button>
        </SettingsActions>
      </DialogContent>
    </Dialog>
  )
}

function MenuItem({
  icon: Icon,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  icon: LucideIcon
  danger?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm text-text transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        danger ? 'hover:bg-danger/10 hover:text-danger' : 'hover:bg-accent-tint',
      )}>
      <Icon className='size-3.5 shrink-0 text-muted-foreground' />
      {children}
    </button>
  )
}

/**
 * The create/edit editor. It takes the whole settings pane with the same form as Profile, Cancel
 * and Save pinned to the pane's footer, and the person's agent accounts below.
 */
function UserDialog({ state, existingIds, onClose }: { state: NonNullable<DialogState>; existingIds: string[]; onClose: () => void }) {
  const editing = state.mode === 'edit' ? state.user : null
  const { principal, agent } = useAuth()
  // Agent accounts: an admin manages anyone's (the agent included), a member only their own.
  const showAccounts = editing !== null && (principal?.role === 'admin' || principal?.id === editing.id)
  const [values, setValues] = React.useState(() => userFormValues(editing))
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  // Work capabilities: an admin's to set, for people who are not admins (an admin's Work and every
  // agent's sessions are not guarded). Sent only when touched, as a partial merged by the server.
  const showWork = editing !== null && principal?.role === 'admin' && editing.role !== 'admin' && editing.kind !== 'agent'
  const [work, setWork] = React.useState<WorkAccess>(() => editing?.work ?? DEFAULT_WORK_ACCESS)
  const [workTouched, setWorkTouched] = React.useState(false)
  const patchWork = (patch: Partial<WorkAccess>) => {
    setWork((w) => ({ ...w, ...patch }))
    setWorkTouched(true)
  }

  // The id is the nickname slug on create, fixed once the user exists.
  const id = editing ? editing.id : slugify(values.nickname)
  const duplicate = !editing && !!id && existingIds.includes(id)
  const canSave = !saving && !!values.nickname.trim() && !duplicate

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!values.nickname.trim()) return setError('A nickname is required (it seeds the id).')
    if (!id) return setError('The nickname must contain a letter or digit.')
    if (duplicate) return setError(`A user with id "${id}" already exists.`)
    setSaving(true)
    void upsertUser({ ...userUpsertInput(id, values), ...(showWork && workTouched ? { work } : {}) })
      .then(onClose)
      .catch((err) => {
        setSaving(false)
        setError(String(err))
      })
  }

  useSettingsFooter(
    (shadowed) => (
      <SettingsFooterBar shadowed={shadowed}>
        <Button type='button' variant='ghost' size='sm' onClick={onClose}>
          Cancel
        </Button>
        <Button type='submit' form='user-form' size='sm' disabled={!canSave}>
          {saving ? 'Saving…' : editing ? 'Save' : 'Create user'}
        </Button>
      </SettingsFooterBar>
    ),
    [canSave, saving, !!editing],
  )

  // A stub for a new user, so the avatar previews before anything is stored.
  const base: User = editing ?? {
    id: id || 'new',
    first_name: '',
    last_name: '',
    nickname: '',
    email: null,
    phone: null,
    image: null,
    color: null,
    status: 'active',
    channels: {},
    agent_profile: null,
    has_token: false,
    sort: 0,
    created_at: '',
    updated_at: '',
  }
  const status = editing ? USER_STATUS_META[editing.status as keyof typeof USER_STATUS_META] : null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{editing ? userName(editing) : 'New user'}</DialogTitle>
        <DialogDescription className='sr-only'>{editing ? `id: ${editing.id}` : 'One directory for everyone.'}</DialogDescription>
        <UserProfileForm
          formId='user-form'
          base={base}
          values={values}
          onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
          onSubmit={submit}
          autoFocusNickname={!editing}
          emailReadOnly={!!editing && principal?.role !== 'admin'}
          emailHint={principal?.role === 'admin' ? 'Identity for sign-in elsewhere; no mail is sent.' : 'Ask an administrator to change it.'}
          phoneHint={principal?.role === 'admin' ? 'International form. WhatsApp treats this number as a team member.' : 'Ask an administrator to change it.'}
          meta={
            <>
              {id ? <code>id: {id}</code> : <span>The nickname seeds the id.</span>}
              {editing && <RoleBadge user={editing} />}
              {editing && status && <Badge variant={STATUS_VARIANT[editing.status] ?? 'neutral'}>{status.label}</Badge>}
            </>
          }
          error={error}
          onError={setError}
        />
        {showWork && (
          <section className='mt-4 flex flex-col gap-3' aria-label='Work'>
            <div>
              <h3 className='text-body-sm font-semibold text-text'>Work</h3>
              <p className='mt-0.5 max-w-prose text-label text-muted-foreground'>
                What this person's Work session may touch. It never edits the Box source: its working directory is their own sandbox, and file tools stay inside the folders granted here.
              </p>
            </div>
            <div className='flex flex-col gap-2 text-body-sm text-text'>
              <label className='flex items-center gap-2'>
                <Checkbox checked={work.enabled} onChange={(e) => patchWork({ enabled: e.target.checked })} />
                <span>Work sessions allowed</span>
              </label>
              <label className='flex items-center gap-2'>
                <Checkbox checked={work.data} disabled={!work.enabled} onChange={(e) => patchWork({ data: e.target.checked })} />
                <span>Work with all data and modules <span className='text-muted-foreground'>(the Box tools)</span></span>
              </label>
              <label className='flex items-center gap-2'>
                <Checkbox checked={work.sandbox} disabled={!work.enabled} onChange={(e) => patchWork({ sandbox: e.target.checked })} />
                <span>Work in their sandbox folder <span className='text-muted-foreground'>(data/work/{editing.id})</span></span>
              </label>
              <label className='flex items-center gap-2'>
                <Checkbox checked={work.folders} disabled={!work.enabled} onChange={(e) => patchWork({ folders: e.target.checked })} />
                <span>Work in selected folders</span>
              </label>
              {work.folders && work.enabled && (
                <SettingsField label='Folders' hint='Absolute paths on the Box host; existing directories are suggested as you type, and a missing folder can be created when its parent exists. The checkout and its data are never grantable.'>
                  <WorkFoldersInput value={work.folder_paths} onChange={(folder_paths) => patchWork({ folder_paths })} />
                </SettingsField>
              )}
            </div>
          </section>
        )}
        {editing && principal?.role === 'admin' && editing.kind !== 'agent' && editing.id !== principal.id && <RoleSection user={editing} />}
        {showAccounts && editing && (
          <div className='mt-4'>
            <AgentAccountsPanel user={editing} isAgent={editing.kind === 'agent' || editing.id === agent?.id} />
          </div>
        )}
        {editing && slotComponents<{ user: User }>('users.detail').map((Panel, i) => <Panel key={i} user={editing} />)}
      </DialogContent>
    </Dialog>
  )
}

/** An admin moves a person between admin and member (never themselves; an agent's role is its file's). */
function RoleSection({ user }: { user: User }) {
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const role = user.role ?? 'member'
  const change = async (next: 'admin' | 'member') => {
    if (next === role) return
    const ok = await confirm({
      title: next === 'admin' ? `Make ${userName(user)} an admin?` : `Make ${userName(user)} a member?`,
      message: next === 'admin' ? 'Admins manage users, credentials and every Box setting.' : 'Their admin sessions and tools stop at once.',
      confirmLabel: next === 'admin' ? 'Make admin' : 'Make member',
      danger: next === 'admin',
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    setUserRole(user.id, next).then(() => setBusy(false), (e: unknown) => { setBusy(false); setError(e instanceof Error ? e.message : String(e)) })
  }
  return (
    <section className='mt-4 flex flex-col gap-2' aria-label='Role'>
      <h3 className='text-body-sm font-semibold text-text'>Role</h3>
      <div className='flex items-center gap-2'>
        {(['member', 'admin'] as const).map((r) => (
          <Button key={r} type='button' size='sm' variant={role === r ? 'default' : 'outline'} disabled={busy} onClick={() => void change(r)}>
            {r === 'admin' ? 'Admin' : 'Member'}
          </Button>
        ))}
      </div>
      {error && <p className='text-label text-danger'>{error}</p>}
    </section>
  )
}

/** Settings > Users > New agent: its id, name, role and instructions; created live (an admin at a
 *  browser session). Its engine profile stays host configuration (docs/AUTH.md). */
function AgentCreateDialog({ existingIds, onClose, onCreated }: { existingIds: string[]; onClose: () => void; onCreated: (u: User) => void }) {
  const [name, setName] = React.useState('')
  const [idText, setIdText] = React.useState<string | null>(null)
  const [role, setRole] = React.useState<'admin' | 'member'>('member')
  const [instructions, setInstructions] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const id = idText ?? slugify(name)
  const duplicate = !!id && existingIds.includes(id)
  const canSave = !saving && !!name.trim() && !!id && !duplicate
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    createAgent({ id, name: name.trim(), role, ...(instructions.trim() ? { instructions: instructions.trim() } : {}) }).then(onCreated, (err: unknown) => {
      setSaving(false)
      setError(err instanceof Error ? err.message : String(err))
    })
  }
  useSettingsFooter(
    (shadowed) => (
      <SettingsFooterBar shadowed={shadowed}>
        <Button type='button' variant='ghost' size='sm' onClick={onClose}>Cancel</Button>
        <Button type='submit' form='agent-form' size='sm' disabled={!canSave}>{saving ? 'Creating…' : 'Create agent'}</Button>
      </SettingsFooterBar>
    ),
    [canSave, saving],
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>New agent</DialogTitle>
        <DialogDescription>An agent is a principal with its own token, accounts and instructions. It is stored as data/config/agents/{id || '<id>'}.md.</DialogDescription>
        <form id='agent-form' onSubmit={submit} className='mt-4 flex flex-col gap-4'>
          <SettingsField label='Name'>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder='Stella' className={settingsInputCls} />
          </SettingsField>
          <SettingsField label='Id' hint={duplicate ? `"${id}" is taken.` : 'Fixed once created: it names the agent everywhere.'}>
            <input value={id} onChange={(e) => setIdText(slugify(e.target.value))} maxLength={63} className={cn(settingsInputCls, 'font-mono')} />
          </SettingsField>
          <SettingsField label='Role' hint='Admin agents get the admin tools; an agent never approves sends or creates agents.'>
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')} className={settingsInputCls}>
              <option value='member'>Member</option>
              <option value='admin'>Admin</option>
            </select>
          </SettingsField>
          <SettingsField label='Instructions' hint='Added to the engine system prompt at each session start. Optional.'>
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} placeholder={`You are ${name.trim() || 'Stella'}, the team's ...`} className={cn(settingsInputCls, 'min-h-24')} />
          </SettingsField>
          <p className='text-label text-muted-foreground'>To run sessions it needs an engine profile on the host: a workerdeck profile and agentProfiles.{id || '<id>'} in box.local.json, then a restart.</p>
          {error && <p role='alert' className='text-label text-danger'>{error}</p>}
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InviteDialog({ invite, onClose }: { invite: UserInvite; onClose: () => void }) {
  const [copied, setCopied] = React.useState<'message' | 'link' | null>(null)
  const copy = (what: 'message' | 'link', text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    })
  }
  const noToken = !invite.token

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-lg'>
        <DialogTitle>Invite {invite.user.nickname || invite.user.id}</DialogTitle>
        <DialogDescription>
          {noToken
            ? 'No access token has been issued yet.'
            : 'This is the permanent credential, for wiring up an MCP client. Treat it like a password: password manager, never a chat message, never a URL. It is the same token every time you open this dialog, so re-send it rather than rotating. To just get this person SIGNED IN, close this and use "Send sign-in link" instead.'}
        </DialogDescription>
        {!noToken && (
          <div className='mt-3 flex flex-col gap-3'>
            <div>
              <div className='mb-1 flex items-center justify-between'>
                <span className='text-label font-medium text-muted-foreground'>Invite message</span>
                <Button size='sm' variant='ghost' onClick={() => copy('message', invite.message)}>
                  {copied === 'message' ? <><Check className='size-3.5' /> Copied</> : <><Copy className='size-3.5' /> Copy</>}
                </Button>
              </div>
              <pre className='max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-2.5 text-body-sm text-text'>{invite.message}</pre>
            </div>
            <div>
              <div className='mb-1 flex items-center justify-between'>
                <span className='text-label font-medium text-muted-foreground'>Box URL</span>
                <Button size='sm' variant='ghost' onClick={() => copy('link', invite.url)}>
                  {copied === 'link' ? <><Check className='size-3.5' /> Copied</> : <><Copy className='size-3.5' /> Copy</>}
                </Button>
              </div>
              <code className='block break-all rounded-md border border-border bg-bg p-2.5 text-label text-accent'>{invite.url}</code>
            </div>
          </div>
        )}
        <SettingsActions>
          <Button size='sm' onClick={onClose}>
            Done
          </Button>
        </SettingsActions>
      </DialogContent>
    </Dialog>
  )
}
