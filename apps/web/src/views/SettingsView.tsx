import * as React from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { LogOut, Upload, UserCircle2, Users as UsersIcon } from 'lucide-react'
import { AppShell, PageContainer, PageHeader, type NavItem, Avatar, Button } from '@silkweave/box-ui'
import { ChannelGlyph } from '@/lib/channelIcons.tsx'
import { useGroupNav } from '../lib/nav.ts'
import type { SettingsSection } from '../feature.ts'
import { WEB_FEATURE_LIST } from '../generated/features.ts'
import { useAuth } from '../lib/useAuth.tsx'
import { upsertUser, useUsersData } from '../lib/useUsersData.ts'
import { SWATCHES, swatchClass } from '@silkweave/box-ui/lib'
import { fileToAvatarDataUri } from '../lib/image.ts'
import type { User } from '../user-types.ts'
import { cn } from '@/lib/utils'
import { UsersView } from './UsersView.tsx'

/** Settings sections. Each carried a role ACL until 2026-09-10; every signed-in principal now sees
 *  all of them, matching a server that no longer gates any of them either. */
/** Core's sections; features add theirs through `settings` in their manifest (order bands as nav). */
const CORE_SECTIONS: SettingsSection[] = [
  { id: 'users', label: 'Users', icon: UsersIcon, order: 100, render: () => <UsersView /> },
  { id: 'profile', label: 'Profile', icon: UserCircle2, order: 900, render: () => <ProfileSection /> },
]

let cachedSections: SettingsSection[] | undefined
function allSections(): SettingsSection[] {
  cachedSections ??= [...CORE_SECTIONS, ...WEB_FEATURE_LIST.flatMap((f) => f.settings ?? [])].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  )
  return cachedSections
}

/**
 * Settings shell - a sidebar of sections with the active section rendered in the canvas.
 * Mirrors the Sink single-view pattern: the `$section` path param drives which section is shown.
 */
export function SettingsView() {
  const groupNav = useGroupNav('settings')
  const navigate = useNavigate()
  const sections = allSections()
  const { section } = useParams({ strict: false }) as { section?: string }
  const active = sections.find((s) => s.id === section) ?? sections[0]

  const navItems: NavItem[] = sections.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))
  const onSelect = (id: string) => void navigate({ to: '/settings/$section', params: { section: id } })

  return (
    <AppShell
      items={navItems}
      activeId={active.id}
      onSelect={onSelect}
      groupNav={groupNav}
      topbar={{ crumbs: [{ label: 'Settings' }, { label: active.label }] }}>
      {active.render()}
    </AppShell>
  )
}

const inputCls =
  'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body-sm text-text transition-colors hover:border-accent/40 focus:border-accent focus:outline-none'

/** Channels offered as handle inputs (matches the Users dialog). */
const HANDLE_CHANNELS = ['github', 'x', 'linkedin', 'reddit'] as const

/**
 * Self-scoped profile - who am I signed in as, with every self-editable field inline.
 */
function ProfileSection() {
  const { principal, logout } = useAuth()
  const { all } = useUsersData(true)
  const me = principal ? (all?.find((u) => u.id === principal.id) ?? null) : null

  const signOut = principal && (
    <Button variant='outline' size='sm' onClick={() => void logout()}>
      <LogOut /> Sign out
    </Button>
  )

  return (
    <PageContainer width='wide'>
      <PageHeader title='Profile' description='Who you are signed in as.' actions={signOut} />
      {!principal ? (
        <p className='text-body-sm text-muted-foreground'>Not signed in.</p>
      ) : me ? (
        <ProfileForm key={`${me.id}:${me.updated_at}`} me={me} />
      ) : (
        <div className='flex items-center gap-3 rounded-xl border border-border bg-surface p-4'>
          <div className='min-w-0 flex-1'>
            <p className='font-medium text-text'>{principal.display}</p>
            <p className='text-label text-muted-foreground'>
              <code>{principal.id}</code>
            </p>
          </div>
        </div>
      )}
    </PageContainer>
  )
}

/** The self-edit form - the same fields as the Users dialog. Buffered
 *  state with an explicit Save; the parent re-keys it on `updated_at` so a save reseeds it. */
function ProfileForm({ me }: { me: User }) {
  const [firstName, setFirstName] = React.useState(me.first_name)
  const [lastName, setLastName] = React.useState(me.last_name)
  const [nickname, setNickname] = React.useState(me.nickname)
  const [image, setImage] = React.useState(me.image ?? '')
  const [color, setColor] = React.useState(me.color ?? '')
  const [email, setEmail] = React.useState(me.email ?? '')
  const [handles, setHandles] = React.useState<Record<string, string>>(me.channels)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

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

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!nickname.trim()) return setError('A nickname is required.')
    setSaving(true)
    void upsertUser({
      id: me.id,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      nickname: nickname.trim(),
      email: email.trim(),
      image: image.trim(),
      color,
      channels: handles,
    }).catch((err) => {
      setSaving(false)
      setError(String(err))
    })
  }

  // A preview User so the avatar reflects unsaved edits (image when set, else the initials chip).
  const preview: User = { ...me, first_name: firstName, last_name: lastName, nickname, image: image.trim() || null, color: color || null, channels: handles }

  return (
    <form onSubmit={submit} className='flex max-w-xl flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-(--shadow-sm)'>
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
        Nickname <code className='text-fg-4'>id: {me.id}</code>
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder='e.g. Alice' className={inputCls} />
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
        Email <span className='text-fg-4'>(reference only - no mail is sent)</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder='name@example.com' className={inputCls} />
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
        Swatch color <span className='text-fg-4'>tints where you appear</span>
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

      <div className='mt-1 flex items-center justify-end'>
        <Button type='submit' size='sm' disabled={saving || !nickname.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
