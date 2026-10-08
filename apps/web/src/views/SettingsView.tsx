import * as React from 'react'
import { KeyRound, LogOut, Upload, UserCircle2, Users as UsersIcon, X } from 'lucide-react'
import { PageContainer, Avatar, Button, Dialog, DialogContent, DialogTitle, InlineDialogScope, ConfirmHost } from '@silkweave/box-ui'
import { ChannelGlyph } from '@/lib/channelIcons.tsx'
import { useSettingsDialog } from '../lib/settingsDialog.ts'
import type { SettingsSection } from '../feature.ts'
import { WEB_FEATURE_LIST } from '../generated/features.ts'
import { useAuth } from '../lib/useAuth.tsx'
import { upsertUser, useUsersData } from '../lib/useUsersData.ts'
import { SWATCHES, swatchClass } from '@silkweave/box-ui/lib'
import { fileToAvatarDataUri } from '../lib/image.ts'
import type { User } from '../user-types.ts'
import { cn } from '@/lib/utils'
import { UsersView } from './UsersView.tsx'
import { AgentAccountsView } from './AgentAccountsView.tsx'

/** Settings sections. Each carried a role ACL until 2026-09-10; every signed-in principal now sees
 *  all of them, matching a server that no longer gates any of them either. */
/** Core's sections; features add theirs through `settings` in their manifest (order bands as nav). */
const CORE_SECTIONS: SettingsSection[] = [
  { id: 'users', label: 'Users', icon: UsersIcon, order: 100, render: () => <UsersView /> },
  { id: 'profile', label: 'Profile', icon: UserCircle2, order: 0, render: () => <ProfileSection /> },
  { id: 'agent-accounts', label: 'Agent accounts', icon: KeyRound, order: 10, render: () => <AgentAccountsView /> },
]

let cachedSections: SettingsSection[] | undefined
function allSections(): SettingsSection[] {
  cachedSections ??= [...CORE_SECTIONS, ...WEB_FEATURE_LIST.flatMap((f) => f.settings ?? [])].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  )
  return cachedSections
}

type SettingsFooter = React.ReactNode | ((shadowed: boolean) => React.ReactNode)

/** A section can publish its persistent actions to the frame that owns the fixed dialog edge. */
const SettingsFooterContext = React.createContext<((footer: SettingsFooter | null) => void) | null>(null)

function useSettingsFooter() {
  const setFooter = React.useContext(SettingsFooterContext)
  if (!setFooter) throw new Error('Settings footer must be used inside a settings detail frame.')
  return setFooter
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
            {isOpen && (active.id === 'initiative-kinds' ? (
              <InlineDialogScope key={`${active.id}/${params.join('/')}`} scroll={false}>
                <ConfirmHost />
                <SettingsErrorBoundary>{active.render(active.id === section ? params : [])}</SettingsErrorBoundary>
              </InlineDialogScope>
            ) : (
              <SettingsDetailFrame key={active.id} title={active.label} onClose={close}>
                <InlineDialogScope key={`${active.id}/${params.join('/')}`} scroll={false}>
                  <ConfirmHost />
                  <SettingsErrorBoundary>{active.render(active.id === section ? params : [])}</SettingsErrorBoundary>
                </InlineDialogScope>
              </SettingsDetailFrame>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>
}

/** Shared settings-detail chrome. The section body owns content only; this frame owns the one
 * scrolling surface and the fixed navigation bar. */
function SettingsDetailFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const mainRef = React.useRef<HTMLDivElement>(null)
  const [scrollEdges, setScrollEdges] = React.useState({ above: false, below: false })
  const [footer, setFooter] = React.useState<SettingsFooter | null>(null)
  const publishFooter = React.useCallback((next: SettingsFooter | null) => setFooter(() => next), [])

  React.useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const update = () =>
      setScrollEdges({
        above: main.scrollTop > 0,
        below: main.scrollTop + main.clientHeight < main.scrollHeight - 1,
      })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(main)
    return () => observer.disconnect()
  }, [])

  return (
    <SettingsFooterContext.Provider value={publishFooter}>
      <div className='flex h-full min-h-0 flex-col overflow-hidden bg-surface'>
        <header className='relative z-10 flex h-16 shrink-0 items-center bg-surface px-4 md:px-6'>
          <h1 className='font-serif text-lg text-text'>{title}</h1>
          <button
            type='button'
            aria-label='Close settings'
            onClick={onClose}
            className='ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-text'>
            <X className='size-4' />
          </button>
          <div
            aria-hidden='true'
            className={`pointer-events-none absolute inset-x-0 top-full h-8 transition-opacity duration-200 ${scrollEdges.above ? 'opacity-100' : 'opacity-0'}`}
            style={{ background: 'linear-gradient(to bottom, var(--surface) 0%, transparent 100%)' }}
          />
        </header>
        <main
          ref={mainRef}
          className='settings-detail-main min-h-0 flex-1 overflow-y-auto bg-surface'
          onScroll={(event) => {
            const main = event.currentTarget
            setScrollEdges({
              above: main.scrollTop > 0,
              below: main.scrollTop + main.clientHeight < main.scrollHeight - 1,
            })
          }}>
          {children}
        </main>
        {typeof footer === 'function' ? footer(scrollEdges.below) : footer}
      </div>
    </SettingsFooterContext.Provider>
  )
}

class SettingsErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <p role='alert' className='p-8 text-body-sm text-danger'>This settings section could not load. Choose another section or reload the page.</p>
    return this.props.children
  }
}

const inputCls =
  'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body-sm text-text transition-colors hover:border-accent/40 focus:border-accent focus:outline-none'

/** Channels offered as handle inputs (matches the Users dialog). */
const HANDLE_CHANNELS = ['github', 'x', 'linkedin', 'reddit'] as const

/**
 * Self-scoped profile. Settings sections are deliberately canvas-like rather than a stack of
 * generic cards; contained surfaces are reserved for short callouts that need separation.
 */
function ProfileSection() {
  const { principal, logout } = useAuth()
  const { all } = useUsersData(true)
  const me = principal ? (all?.find((u) => u.id === principal.id) ?? null) : null

  return (
    <PageContainer width='wide' className='px-4 pt-0 pb-6 md:px-6'>
      {!principal ? (
        <p className='text-body-sm text-muted-foreground'>Not signed in.</p>
      ) : me ? (
        <ProfileForm key={`${me.id}:${me.updated_at}`} me={me} onSignOut={() => void logout()} />
      ) : (
        <div className='flex items-center gap-3 py-4'>
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
function ProfileForm({ me, onSignOut }: { me: User; onSignOut: () => void }) {
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
  const setSettingsFooter = useSettingsFooter()

  const setHandle = (ch: string, v: string) => setHandles((h) => ({ ...h, [ch]: v }))
  const isDirty =
    firstName !== me.first_name ||
    lastName !== me.last_name ||
    nickname !== me.nickname ||
    image !== (me.image ?? '') ||
    color !== (me.color ?? '') ||
    email !== (me.email ?? '') ||
    HANDLE_CHANNELS.some((ch) => (handles[ch] ?? '') !== (me.channels[ch] ?? ''))

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
    })
      .then(() => {
        setSaving(false)
        setError(null)
      })
      .catch((err) => {
        setSaving(false)
        setError(String(err))
      })
  }

  // A preview User so the avatar reflects unsaved edits (image when set, else the initials chip).
  const preview: User = { ...me, first_name: firstName, last_name: lastName, nickname, image: image.trim() || null, color: color || null, channels: handles }
  const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || nickname.trim() || me.id

  React.useEffect(() => {
    setSettingsFooter(
      (shadowed) => <footer className='relative z-10 flex shrink-0 items-center justify-between bg-surface px-4 py-4 md:px-6'>
        <div
          aria-hidden='true'
          className={`pointer-events-none absolute inset-x-0 bottom-full h-8 transition-opacity duration-200 ${shadowed ? 'opacity-100' : 'opacity-0'}`}
          style={{ background: 'linear-gradient(to top, var(--surface) 0%, transparent 100%)' }}
        />
        <Button type='button' variant='outline' size='sm' onClick={onSignOut}>
          <LogOut /> Sign out
        </Button>
        <Button type='submit' form='profile-form' size='sm' disabled={!isDirty || saving || !nickname.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </footer>,
    )
    return () => setSettingsFooter(null)
  }, [isDirty, nickname, onSignOut, saving, setSettingsFooter])

  return (
    <div className='min-h-full'>
      <form id='profile-form' onSubmit={submit} className='flex w-full flex-col gap-6'>
        <section className='relative overflow-hidden rounded-xl bg-gradient-to-br from-accent/20 via-accent/10 to-transparent px-5 py-6 sm:px-6'>
          <div aria-hidden='true' className='absolute -top-12 -right-10 size-40 rounded-full bg-accent/15 blur-2xl' />
          <div className='relative flex items-center gap-4'>
            <button
              type='button'
              onClick={() => fileRef.current?.click()}
              title='Upload avatar image'
              aria-label='Upload avatar image'
              className='group relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'>
              <Avatar user={preview} size='lg' className='size-20 text-display-sm ring-4 ring-surface shadow-(--shadow-md)' />
              <span className='absolute inset-0 hidden place-items-center rounded-full bg-black/45 text-white group-hover:grid'>
                <Upload className='size-5' />
              </span>
            </button>
            <div className='min-w-0'>
              <p className='truncate font-serif text-display-sm text-text'>{displayName}</p>
              <p className='mt-0.5 truncate text-body-sm text-muted-foreground'>@{nickname.trim() || me.id}</p>
            </div>
          </div>
        </section>

        <section className='grid gap-x-5 gap-y-5 md:grid-cols-3'>
          <label className='flex flex-col gap-1 text-label text-muted-foreground'>
            First name
            <input name='firstName' autoComplete='given-name' value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder='First name' className={inputCls} aria-label='First name' />
          </label>
          <label className='flex flex-col gap-1 text-label text-muted-foreground'>
            Last name
            <input name='lastName' autoComplete='family-name' value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder='Last name' className={inputCls} aria-label='Last name' />
          </label>
          <label className='flex flex-col gap-1 text-label text-muted-foreground'>
            Nickname
            <input name='nickname' autoComplete='username' value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder='e.g. Alice' className={inputCls} />
          </label>

          <label className='flex flex-col gap-1 text-label text-muted-foreground'>
            Email
            <input name='email' autoComplete='email' value={email} onChange={(e) => setEmail(e.target.value)} placeholder='name@example.com' className={inputCls} />
          </label>

          <div className='flex flex-col gap-1 text-label text-muted-foreground md:col-span-2'>
            Avatar image
            <div className='flex items-center gap-1.5'>
              <input
                name='image'
                autoComplete='url'
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

          <div className='grid grid-cols-2 gap-x-5 gap-y-4 md:col-span-3 md:grid-cols-4'>
            {HANDLE_CHANNELS.map((ch) => (
              <label key={ch} className='flex flex-col gap-1 text-label text-muted-foreground'>
                {ch === 'x' ? 'X' : ch === 'github' ? 'GitHub' : ch[0].toUpperCase() + ch.slice(1)}
                <span className='relative'>
                  <ChannelGlyph channel={ch} className='pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-4' />
                  <input name={`channel-${ch}`} value={handles[ch] ?? ''} onChange={(e) => setHandle(ch, e.target.value)} placeholder={ch} className={cn(inputCls, 'pl-8')} aria-label={`${ch} handle`} />
                </span>
              </label>
            ))}
          </div>

          <div className='flex flex-col gap-1 text-label text-muted-foreground md:col-span-3'>
            Swatch color
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
                    'size-7 rounded-full border-2 border-surface shadow-(--shadow-sm) transition-[transform,box-shadow] hover:scale-110',
                    swatchClass(s),
                    color === s ? 'scale-110 ring-1 ring-[var(--swatch)] ring-offset-1 ring-offset-surface' : 'ring-1 ring-transparent',
                  )}
                  style={{ background: 'var(--swatch)' }}
                />
              ))}
            </div>
          </div>
        </section>

        <input
          ref={fileRef}
          name='imageFile'
          type='file'
          accept='image/*'
          className='hidden'
          aria-label='Avatar image file'
          onChange={(e) => {
            void pickImage(e.target.files?.[0])
            e.target.value = ''
          }}
        />

        {error && <p className='text-label text-danger'>{error}</p>}
      </form>
    </div>
  )
}
