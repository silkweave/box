import * as React from 'react'
import { Upload } from 'lucide-react'
import { Avatar, Button, SettingsField, SettingsIdentity, settingsInputCls } from '@silkweave/box-ui'
import { SWATCHES, swatchClass } from '@silkweave/box-ui/lib'
import { ChannelGlyph } from '@/lib/channelIcons.tsx'
import { cn } from '@/lib/utils'
import { fileToAvatarDataUri } from '../lib/image.ts'
import type { User } from '../user-types.ts'

/** Channels offered as handle inputs (matches the engagement/ingest channels). */
export const HANDLE_CHANNELS = ['github', 'x', 'linkedin', 'reddit'] as const
const HANDLE_LABEL: Record<(typeof HANDLE_CHANNELS)[number], string> = { github: 'GitHub', x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' }

export interface UserFormValues {
  firstName: string
  lastName: string
  nickname: string
  image: string
  color: string
  email: string
  handles: Record<string, string>
}

export const userFormValues = (u: User | null): UserFormValues => ({
  firstName: u?.first_name ?? '',
  lastName: u?.last_name ?? '',
  nickname: u?.nickname ?? '',
  image: u?.image ?? '',
  color: u?.color ?? '',
  email: u?.email ?? '',
  handles: u?.channels ?? {},
})

export const userFormDirty = (a: UserFormValues, b: UserFormValues): boolean =>
  a.firstName !== b.firstName ||
  a.lastName !== b.lastName ||
  a.nickname !== b.nickname ||
  a.image !== b.image ||
  a.color !== b.color ||
  a.email !== b.email ||
  HANDLE_CHANNELS.some((ch) => (a.handles[ch] ?? '') !== (b.handles[ch] ?? ''))

/** The upsert payload for these values. */
export const userUpsertInput = (id: string, v: UserFormValues) => ({
  id,
  first_name: v.firstName.trim(),
  last_name: v.lastName.trim(),
  nickname: v.nickname.trim(),
  email: v.email.trim(),
  image: v.image.trim(),
  color: v.color,
  channels: v.handles,
})

/**
 * The one person form, shared by Profile (self) and the Users editor: an identity header, then
 * names, email, avatar, handles and swatch on a three-column grid. The caller owns the values, the
 * submit and where Save lives (the settings footer, through `formId`).
 */
export function UserProfileForm({
  formId,
  base,
  values,
  onChange,
  onSubmit,
  meta,
  emailHint,
  emailReadOnly = false,
  autoFocusNickname = false,
  error,
  onError,
}: {
  formId: string
  /** The stored user (or a stub for a new one), overlaid with the values to preview the avatar. */
  base: User
  values: UserFormValues
  onChange: (patch: Partial<UserFormValues>) => void
  onSubmit: (e: React.FormEvent) => void
  meta?: React.ReactNode
  emailHint?: React.ReactNode
  emailReadOnly?: boolean
  autoFocusNickname?: boolean
  error: string | null
  onError: (message: string | null) => void
}) {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const { firstName, lastName, nickname, image, color, email, handles } = values
  const preview: User = { ...base, first_name: firstName, last_name: lastName, nickname, image: image.trim() || null, color: color || null, channels: handles }
  const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || nickname.trim() || base.id

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    try {
      onChange({ image: await fileToAvatarDataUri(file) })
      onError(null)
    } catch {
      onError('Could not read that image - try a PNG or JPG.')
    }
  }

  return (
    <form id={formId} onSubmit={onSubmit} className='flex w-full flex-col gap-6'>
      <SettingsIdentity
        title={displayName}
        meta={meta}
        avatar={
          <button
            type='button'
            onClick={() => fileRef.current?.click()}
            title='Upload avatar image'
            aria-label='Upload avatar image'
            className='group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'>
            <Avatar user={preview} size='lg' className='size-20 text-display-sm ring-4 ring-surface shadow-(--shadow-md)' />
            <span className='absolute inset-0 hidden place-items-center rounded-full bg-black/45 text-white group-hover:grid'>
              <Upload className='size-5' />
            </span>
          </button>
        }
      />

      <section className='grid gap-x-5 gap-y-5 md:grid-cols-3'>
        <SettingsField label='First name'>
          <input name='firstName' autoComplete='given-name' value={firstName} onChange={(e) => onChange({ firstName: e.target.value })} placeholder='First name' className={settingsInputCls} />
        </SettingsField>
        <SettingsField label='Last name'>
          <input name='lastName' autoComplete='family-name' value={lastName} onChange={(e) => onChange({ lastName: e.target.value })} placeholder='Last name' className={settingsInputCls} />
        </SettingsField>
        <SettingsField label='Nickname'>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            name='nickname'
            autoComplete='username'
            autoFocus={autoFocusNickname}
            value={nickname}
            onChange={(e) => {
              onChange({ nickname: e.target.value })
              onError(null)
            }}
            placeholder='e.g. Alice'
            className={settingsInputCls}
          />
        </SettingsField>

        <SettingsField label='Email' hint={emailHint}>
          <input name='email' autoComplete='email' value={email} readOnly={emailReadOnly} onChange={(e) => onChange({ email: e.target.value })} placeholder='name@example.com' className={settingsInputCls} />
        </SettingsField>

        <div className='flex flex-col gap-1 text-label text-muted-foreground md:col-span-2'>
          Avatar image
          <div className='flex items-center gap-1.5'>
            <input
              name='image'
              autoComplete='url'
              value={image.startsWith('data:') ? '' : image}
              onChange={(e) => onChange({ image: e.target.value })}
              placeholder={image.startsWith('data:') ? 'Uploaded image set - paste a URL to replace it' : 'https://… or upload'}
              className={settingsInputCls}
              aria-label='Avatar image URL'
            />
            <Button type='button' variant='outline' size='sm' onClick={() => fileRef.current?.click()}>
              <Upload /> Upload
            </Button>
            {image && (
              <Button type='button' variant='ghost' size='sm' onClick={() => onChange({ image: '' })}>
                Remove
              </Button>
            )}
          </div>
        </div>

        <div className='grid grid-cols-2 gap-x-5 gap-y-4 md:col-span-3 md:grid-cols-4'>
          {HANDLE_CHANNELS.map((ch) => (
            <SettingsField key={ch} label={HANDLE_LABEL[ch]}>
              <span className='relative'>
                <ChannelGlyph channel={ch} className='pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-4' />
                <input
                  name={`channel-${ch}`}
                  value={handles[ch] ?? ''}
                  onChange={(e) => onChange({ handles: { ...handles, [ch]: e.target.value } })}
                  placeholder={ch}
                  className={cn(settingsInputCls, 'pl-8')}
                  aria-label={`${ch} handle`}
                />
              </span>
            </SettingsField>
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
                onClick={() => onChange({ color: color === s ? '' : s })}
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
  )
}
