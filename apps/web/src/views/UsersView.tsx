import { useSettingsDialog } from '../lib/settingsDialog.ts'
import { useAuth } from '../lib/useAuth.tsx'
import { AgentAccountsPanel } from '../components/agent/AgentAccountsPanel.tsx'
import * as React from 'react'
import {
  Check,
  Copy,
  KeyRound,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { Avatar, Badge, type BadgeProps, Button, confirm, InlineDialog as Dialog, InlineDialogContent as DialogContent, InlineDialogDescription as DialogDescription, InlineDialogTitle as DialogTitle, PageContainer, PageHeader, Popover, PopoverContent, PopoverTrigger } from '@silkweave/box-ui'
import { ChannelGlyph } from '@/lib/channelIcons.tsx'
import {
  deleteUser,
  inviteUser,
  signinLink,
  revealUserInvite,
  revokeUserAccess,
  upsertUser,
  useUsersData,
  type UserInvite,
  type UserSigninLink,
} from '../lib/useUsersData.ts'
import { SWATCHES, swatchClass } from '@silkweave/box-ui/lib'
import { fileToAvatarDataUri } from '../lib/image.ts'
import { USER_STATUS_META, userName, type User } from '../user-types.ts'
import { cn } from '@/lib/utils'

const inputCls =
  'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body-sm text-text transition-colors hover:border-accent/40 focus:border-accent focus:outline-none'

/** nickname → slug id: lowercase, non-alphanumerics → '-', trimmed. Matches the server's slug rules. */
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

type DialogState = { mode: 'new' } | { mode: 'edit'; user: User } | null

/**
 * Settings -> Users - the people directory. Create/edit/delete plus the invite lifecycle (sign-in link
 * mint/reveal/rotate/revoke). It was role-filtered and admin-gated until 2026-09-10; every signed-in
 * principal now manages it, and there are no roles left to filter by. See docs/AUTH.md.
 */
export function UsersView() {
  const { all: users, error } = useUsersData()
  const { params, open } = useSettingsDialog()
  const selectedUser = users?.find((u) => u.id === params[0])
  const dialog: DialogState = params[0] === 'new' ? { mode: 'new' } : selectedUser ? { mode: 'edit', user: selectedUser } : null
  const setDialog = (next: DialogState) => open(next ? `users/${next.mode === 'new' ? 'new' : next.user.id}` : 'users')
  const [failure, setFailure] = React.useState<string | null>(null)
  const [invite, setInvite] = React.useState<UserInvite | null>(null)
  const [link, setLink] = React.useState<UserSigninLink | null>(null)

  const shown = users ?? []

  const onDelete = async (u: User) => {
    const message = 'They will be unassigned from any initiatives and tasks.'
    if (!(await confirm({ title: `Delete ${userName(u)}?`, message, confirmLabel: 'Delete', danger: true }))) return
    void deleteUser(u.id).catch((e) => setFailure(String(e)))
  }

  return (
    <PageContainer width='wide' className='md:px-6'>
      <PageHeader
        title='Users'
        description='Everyone with a principal. Each signs in with a short-lived sign-in link, or with their own access token.'
        actions={
          (
            <Button size='sm' onClick={() => setDialog({ mode: 'new' })}>
              <Plus /> New user
            </Button>
          )
        }
      />

      {failure && <p role='alert' className='mb-4 text-body-sm text-danger'>{failure}</p>}
      {error && <p className='mb-4 text-body-sm text-danger'>Failed to load users: {error}</p>}

      {!users ? (
        <p className='text-body-sm text-muted-foreground'>Loading…</p>
      ) : shown.length === 0 ? (
        <div className='grid place-items-center rounded-lg border border-dashed border-border py-16 text-center text-body-sm text-muted-foreground'>
          <p>Nobody here yet.</p>
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          {shown.map((u) => (
            <UserCard
              key={u.id}
              user={u}
              isSelf={false}
              onEdit={() => setDialog({ mode: 'edit', user: u })}
              onDelete={() => onDelete(u)}
              onInvited={setInvite}
              onSigninLink={setLink}
            />
          ))}
        </div>
      )}

      <UserDialog
        key={dialog?.mode === 'edit' ? dialog.user.id : 'new'}
        state={dialog}
        existingIds={(users ?? []).map((u) => u.id)}
        onClose={() => setDialog(null)}
      />
      {invite && <InviteDialog invite={invite} onClose={() => setInvite(null)} />}
      {link && <SigninLinkDialog link={link} onClose={() => setLink(null)} />}
    </PageContainer>
  )
}

// `nova` is the system principal (machine account) - the one badge left after roles were removed.
const SYSTEM_BADGE: { variant: BadgeProps['variant']; label: string } = { variant: 'info', label: 'system' }
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  active: 'success',
  invited: 'warning',
  revoked: 'danger',
}

const actionBtnCls =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-label text-muted-foreground transition-colors hover:bg-accent-tint hover:text-accent disabled:pointer-events-none disabled:opacity-50'

/**
 * One directory card. The whole surface opens the edit dialog (when the viewer may edit); the
 * actions bar carries Edit / Delete / More, with the access lifecycle (invitation, token rotate,
 * disable/enable) behind More - admin-only, like every management control here.
 *
 *   IMG [ Full name       system badge ]
 *   IMG [ @handle+status  actions bar  ]
 */
function UserCard({
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
  const { agent } = useAuth()
  const systemBadge = user.id === agent?.id ? SYSTEM_BADGE : null
  const status = USER_STATUS_META[user.status as keyof typeof USER_STATUS_META]
  const canEdit = true

  return (
    <div
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onClick={canEdit ? onEdit : undefined}
      onKeyDown={canEdit ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit() } } : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-(--shadow-sm) transition-colors',
        canEdit && 'cursor-pointer hover:border-accent/40 focus-visible:border-accent focus-visible:outline-none',
      )}>
      <Avatar user={user} size='lg' />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center justify-between gap-2'>
          <p className='line-clamp-1 font-medium text-text'>{userName(user)}</p>
          {systemBadge && (
            <Badge variant={systemBadge.variant} className='shrink-0'>
              {systemBadge.label}
            </Badge>
          )}
        </div>
        <div className='mt-1 flex min-h-6 items-center justify-between gap-2'>
          <p className='line-clamp-1 inline-flex items-center gap-1.5 text-label text-muted-foreground'>
            @{user.nickname || user.id}
            {status && <Badge variant={STATUS_VARIANT[user.status] ?? 'neutral'}>{status.label}</Badge>}
          </p>
          <div className='flex shrink-0 items-center gap-0.5'>
            {canEdit && (
              <button
                type='button'
                onClick={(e) => { e.stopPropagation(); onEdit() }}
                title='Edit user'
                className={actionBtnCls}>
                <Pencil className='size-3.5' /> Edit
              </button>
            )}
            {!isSelf && (
              <button
                type='button'
                onClick={(e) => { e.stopPropagation(); onDelete() }}
                title='Delete user'
                className={cn(actionBtnCls, 'hover:bg-danger/10 hover:text-danger')}>
                <Trash2 className='size-3.5' /> Delete
              </button>
            )}
            <MoreMenu user={user} isSelf={isSelf} onInvited={onInvited} onSigninLink={onSigninLink} />
          </div>
        </div>
      </div>
    </div>
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
        <PopoverTrigger onClick={(e) => e.stopPropagation()} title='More actions' className={actionBtnCls}>
          <MoreHorizontal className='size-3.5' /> More
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
        <div className='mt-4 flex justify-end'>
          <Button size='sm' onClick={onClose}>
            Done
          </Button>
        </div>
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

/** Channels offered as handle inputs (matches the engagement/ingest channels). */
const HANDLE_CHANNELS = ['github', 'x', 'linkedin', 'reddit'] as const

/**
 * The ONE create/edit modal for every role. The role control is prominent (top): it seeds a new
 * user's role, and on edit an admin may flip it - Save then runs the audited setUserRole after the
 * upsert (never your own role, never `nova`; the server refuses both and blocks demoting the last
 * admin or a collaborator-demotion while the person owns internal work). Handles + email + avatar
 * (uploaded file → compact data URI, or a URL) are editable for EVERY role - `users.channels` is
 * the source of truth for per-channel presence.
 */
function UserDialog({ state, existingIds, onClose }: { state: DialogState; existingIds: string[]; onClose: () => void }) {
  const editing = state?.mode === 'edit' ? state.user : null
  const { principal, agent } = useAuth()
  // Agent accounts: an admin manages anyone's (the agent included), a member only their own.
  const showAccounts = editing !== null && (principal?.role === 'admin' || principal?.id === editing.id)
  const [firstName, setFirstName] = React.useState(editing?.first_name ?? '')
  const [lastName, setLastName] = React.useState(editing?.last_name ?? '')
  const [nickname, setNickname] = React.useState(editing?.nickname ?? '')
  const [image, setImage] = React.useState(editing?.image ?? '')
  const [color, setColor] = React.useState(editing?.color ?? '')
  const [email, setEmail] = React.useState(editing?.email ?? '')
  const [handles, setHandles] = React.useState<Record<string, string>>(editing?.channels ?? {})
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const open = state !== null
  // The id is the nickname slug on create, fixed once the user exists.
  const id = editing ? editing.id : slugify(nickname)
  const duplicate = !editing && !!id && existingIds.includes(id)
  const setHandle = (ch: string, v: string) => setHandles((h) => ({ ...h, [ch]: v }))
  const pickImage = async (file: File | undefined) => {
    if (!file) return
    try {
      setImage(await fileToAvatarDataUri(file))
      setError(null)
    } catch {
      setError('Could not read that image - try a PNG or JPG.')
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nickname.trim()) return setError('A nickname is required (it seeds the id).')
    if (!id) return setError('The nickname must contain a letter or digit.')
    if (duplicate) return setError(`A user with id "${id}" already exists.`)
    setSaving(true)
    const write = async () => {
      await upsertUser({
        id,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        nickname: nickname.trim(),
        email: email.trim(),
        image: image.trim(),
        color,
        channels: handles,
      })
    }
    void write()
      .then(onClose)
      .catch((err) => {
        setSaving(false)
        setError(String(err))
      })
  }

  // A throwaway User to preview the avatar (image when set, else the initials chip).
  const preview: User = {
    id: id || 'new',
    first_name: firstName,
    last_name: lastName,
    nickname,
    email: email || null,
    image: image.trim() || null,
    color: color || null,
    status: editing?.status ?? 'active',
    channels: handles,
    agent_profile: editing?.agent_profile ?? null,
    has_token: editing?.has_token ?? false,
    sort: 0,
    created_at: '',
    updated_at: '',
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={showAccounts ? 'max-w-xl' : 'max-w-md'}>
        <div className='flex flex-col gap-1'>
          <DialogTitle>{editing ? 'Edit user' : 'New user'}</DialogTitle>
          <DialogDescription>
            {editing ? (
              <code className='text-label'>id: {editing.id}</code>
            ) : (
              'One directory for everyone.'
            )}
          </DialogDescription>
        </div>

        <form onSubmit={submit} className='mt-2 flex flex-col gap-3'>
          <div className='flex items-center gap-3'>
            <button
              type='button'
              onClick={() => fileRef.current?.click()}
              title='Upload avatar image'
              aria-label='Upload avatar image'
              className='group relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'>
              <Avatar user={preview} size='lg' />
              <span className='absolute inset-0 hidden place-items-center rounded-full bg-black/45 text-white group-hover:grid'>
                <Upload className='size-4' />
              </span>
            </button>
            <div className='grid flex-1 grid-cols-2 gap-2'>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder='First name' className={inputCls} aria-label='First name' />
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder='Last name' className={inputCls} aria-label='Last name' />
            </div>
          </div>
          <input
            ref={fileRef}
            type='file'
            accept='image/*'
            className='hidden'
            aria-label='Avatar image file'
            onChange={(e) => {
              void pickImage(e.target.files?.[0])
              e.target.value = ''
            }}
          />

          <label className='flex flex-col gap-1 text-label text-muted-foreground'>
            Nickname{!editing && id && <code className='text-fg-4'>id: {id}</code>}
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value)
                setError(null)
              }}
              placeholder='e.g. Alice'
              className={inputCls}
            />
          </label>

          <div className='flex flex-col gap-1 text-label text-muted-foreground'>
            Avatar image
            <div className='flex items-center gap-1.5'>
              <input
                value={image.startsWith('data:') ? '' : image}
                onChange={(e) => setImage(e.target.value)}
                placeholder={image.startsWith('data:') ? 'Uploaded image set - paste a URL to replace it' : 'https://… or upload'}
                className={inputCls}
                aria-label='Avatar image URL'
              />
              <Button type='button' variant='outline' size='sm' onClick={() => fileRef.current?.click()}>
                <Upload /> Upload
              </Button>
              {image && (
                <Button type='button' variant='ghost' size='sm' onClick={() => setImage('')}>
                  Remove
                </Button>
              )}
            </div>
          </div>

          <label className='flex flex-col gap-1 text-label text-muted-foreground'>
            Email{' '}
            <span className='text-fg-4'>
              {principal?.role === 'admin' ? '(identity for sign-in elsewhere; no mail is sent)' : '(ask an administrator to change it)'}
            </span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              readOnly={!!editing && principal?.role !== 'admin'}
              placeholder='name@example.com'
              className={inputCls}
            />
          </label>

          <div className='flex flex-col gap-1 text-label text-muted-foreground'>
            Handles <span className='text-fg-4'>(where this person appears on each channel)</span>
            <div className='grid grid-cols-2 gap-2'>
              {HANDLE_CHANNELS.map((ch) => (
                <div key={ch} className='relative'>
                  <ChannelGlyph channel={ch} className='pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-4' />
                  <input value={handles[ch] ?? ''} onChange={(e) => setHandle(ch, e.target.value)} placeholder={ch} className={cn(inputCls, 'pl-8')} aria-label={`${ch} handle`} />
                </div>
              ))}
            </div>
          </div>

          <div className='flex flex-col gap-1 text-label text-muted-foreground'>
            Swatch color <span className='text-fg-4'>tints where this user appears</span>
            <div className='flex items-center gap-1.5'>
              {SWATCHES.map((s) => (
                <button
                  key={s}
                  type='button'
                  title={s}
                  aria-label={`Swatch ${s}`}
                  aria-pressed={color === s}
                  onClick={() => setColor(color === s ? '' : s)}
                  className={cn(
                    'size-6 rounded-full border-2 transition-transform hover:scale-110',
                    swatchClass(s),
                    color === s ? 'border-text' : 'border-transparent',
                  )}
                  style={{ background: 'var(--swatch)' }}
                />
              ))}
            </div>
          </div>

          {error && <p className='text-label text-danger'>{error}</p>}

          <div className='mt-1 flex items-center justify-end gap-2'>
            <Button type='button' variant='ghost' size='sm' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' size='sm' disabled={saving || !nickname.trim() || duplicate}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Create user'}
            </Button>
          </div>
        </form>
        {showAccounts && editing && (
          <div className='mt-4 border-t border-border pt-4'>
            <AgentAccountsPanel user={editing} isAgent={editing.id === agent?.id} />
          </div>
        )}
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
        <div className='mt-4 flex justify-end'>
          <Button size='sm' onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
