import * as React from 'react'
import { Upload } from 'lucide-react'
import { Avatar, Button, Field, FieldGrid, Input, SettingsDetailHeader, SettingsGroup, useSettingsReadOnly, type SettingsForm } from '@silkweave/box-ui'
import { SWATCHES, swatchClass } from '@silkweave/box-ui/lib'
import { ChannelGlyph } from '@/lib/channelIcons.tsx'
import { cn } from '@/lib/utils'
import { fileToAvatarDataUri } from '../lib/image.ts'
import type { User } from '../user-types.ts'

/** Channels offered as handle inputs (the channels the data-sync pulls read per person). */
export const HANDLE_CHANNELS = ['github', 'x', 'linkedin', 'reddit'] as const
const HANDLE_LABEL: Record<(typeof HANDLE_CHANNELS)[number], string> = { github: 'GitHub', x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' }

export interface UserFormValues {
  firstName: string
  lastName: string
  nickname: string
  image: string
  color: string
  email: string
  phone: string
  handles: Record<string, string>
}

export const userFormValues = (u: User | null): UserFormValues => ({
  firstName: u?.first_name ?? '',
  lastName: u?.last_name ?? '',
  nickname: u?.nickname ?? '',
  image: u?.image ?? '',
  color: u?.color ?? '',
  email: u?.email ?? '',
  phone: u?.phone ?? '',
  handles: u?.channels ?? {},
})

export const userFormDirty = (a: UserFormValues, b: UserFormValues): boolean =>
  a.firstName !== b.firstName ||
  a.lastName !== b.lastName ||
  a.nickname !== b.nickname ||
  a.image !== b.image ||
  a.color !== b.color ||
  a.email !== b.email ||
  a.phone !== b.phone ||
  HANDLE_CHANNELS.some((ch) => (a.handles[ch] ?? '') !== (b.handles[ch] ?? ''))

/** The upsert payload for these values. */
export const userUpsertInput = (id: string, v: UserFormValues) => ({
  id,
  first_name: v.firstName.trim(),
  last_name: v.lastName.trim(),
  nickname: v.nickname.trim(),
  email: v.email.trim(),
  phone: v.phone.trim(),
  image: v.image.trim(),
  color: v.color,
  channels: v.handles,
})

/**
 * The one person form, shared by Profile (self) and the Users pages: an identity header (avatar,
 * name, badges, a meta line), then names, email, phone, avatar, handles and swatch on the field
 * grid. It renders canvas pieces as direct children, so it sits straight in a section or a
 * `SettingsPage`. The caller owns the form (`useSettingsForm`) and its `SettingsSaveBar`.
 */
export function UserProfileForm<T extends UserFormValues>({
  form,
  base,
  badges,
  meta,
  emailHint,
  emailReadOnly = false,
  phoneHint,
  autoFocusNickname = false,
  children,
}: {
  form: SettingsForm<T>
  /** The stored user (or a stub for a new one), overlaid with the values to preview the avatar. */
  base: User
  badges?: React.ReactNode
  meta?: React.ReactNode
  emailHint?: React.ReactNode
  /** Read-only like the email: both are identities only an administrator changes. */
  emailReadOnly?: boolean
  phoneHint?: React.ReactNode
  autoFocusNickname?: boolean
  /** More groups inside the same form (the Users page's Work group). */
  children?: React.ReactNode
}) {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const readOnly = useSettingsReadOnly()
  const [imageError, setImageError] = React.useState<string | null>(null)
  const { firstName, lastName, nickname, image, color, email, phone, handles } = form.values
  const set = form.patch as (patch: Partial<UserFormValues>) => void
  const preview: User = { ...base, first_name: firstName, last_name: lastName, nickname, image: image.trim() || null, color: color || null, channels: handles }
  const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || nickname.trim() || base.id

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    try {
      set({ image: await fileToAvatarDataUri(file) })
      setImageError(null)
    } catch {
      setImageError('Could not read that image. Try a PNG or JPG.')
    }
  }

  return (
    <form {...form.formProps} className='contents'>
      <SettingsDetailHeader
        title={displayName}
        badges={badges}
        meta={meta}
        media={
          <button
            type='button'
            disabled={readOnly}
            onClick={() => fileRef.current?.click()}
            title='Upload avatar image'
            aria-label='Upload avatar image'
            className='group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'>
            <Avatar user={preview} size='lg' className='size-12' />
            <span className='absolute inset-0 hidden place-items-center rounded-full bg-black/45 text-white group-hover:grid'>
              <Upload className='size-4' />
            </span>
          </button>
        }
      />
      <SettingsGroup title='Profile'>
        <FieldGrid columns={3}>
          <Field label='First name'>
            <Input name='firstName' autoComplete='given-name' value={firstName} onChange={(e) => set({ firstName: e.target.value })} placeholder='First name' />
          </Field>
          <Field label='Last name'>
            <Input name='lastName' autoComplete='family-name' value={lastName} onChange={(e) => set({ lastName: e.target.value })} placeholder='Last name' />
          </Field>
          <Field label='Nickname'>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <Input name='nickname' autoComplete='username' autoFocus={autoFocusNickname} value={nickname} onChange={(e) => set({ nickname: e.target.value })} placeholder='e.g. Alice' />
          </Field>
          <Field label='Email' hint={emailHint}>
            <Input name='email' autoComplete='email' value={email} readOnly={emailReadOnly} onChange={(e) => set({ email: e.target.value })} placeholder='name@example.com' />
          </Field>
          <Field label='Phone' hint={phoneHint}>
            <Input name='phone' type='tel' autoComplete='tel' value={phone} readOnly={emailReadOnly} onChange={(e) => set({ phone: e.target.value })} placeholder='+43 660 1234567' />
          </Field>
          <Field label='Avatar image' span='full' error={imageError}>
            <Input
              name='image'
              autoComplete='url'
              value={image.startsWith('data:') ? '' : image}
              onChange={(e) => set({ image: e.target.value })}
              placeholder={image.startsWith('data:') ? 'Uploaded image set. Paste a URL to replace it.' : 'https://… or upload'}
              trailing={
                <span className='flex items-center gap-1'>
                  <Button type='button' variant='ghost' size='xs' onClick={() => fileRef.current?.click()}>
                    <Upload /> Upload
                  </Button>
                  {image && <Button type='button' variant='ghost' size='xs' onClick={() => set({ image: '' })}>Remove</Button>}
                </span>
              }
            />
          </Field>
        </FieldGrid>
      </SettingsGroup>
      <SettingsGroup title='Handles' description='The accounts the data pulls read for this person.'>
        <FieldGrid columns={3}>
          {HANDLE_CHANNELS.map((ch) => (
            <Field key={ch} label={HANDLE_LABEL[ch]}>
              <Input
                name={`channel-${ch}`}
                value={handles[ch] ?? ''}
                onChange={(e) => set({ handles: { ...handles, [ch]: e.target.value } })}
                placeholder={ch}
                leading={<ChannelGlyph channel={ch} className='size-3.5 text-fg-4' />}
              />
            </Field>
          ))}
          <Field label='Swatch color' span='full'>
            <div role='group' aria-label='Swatch color' className='flex items-center gap-1.5 py-1'>
              {SWATCHES.map((s) => (
                <button
                  key={s}
                  type='button'
                  title={s}
                  aria-label={`Swatch ${s}`}
                  aria-pressed={color === s}
                  onClick={() => set({ color: color === s ? '' : s })}
                  className={cn(
                    'size-7 rounded-full border-2 border-surface shadow-(--shadow-sm) transition-[transform,box-shadow] hover:scale-110',
                    swatchClass(s),
                    color === s ? 'scale-110 ring-1 ring-[var(--swatch)] ring-offset-1 ring-offset-surface' : 'ring-1 ring-transparent',
                  )}
                  style={{ background: 'var(--swatch)' }}
                />
              ))}
            </div>
          </Field>
        </FieldGrid>
      </SettingsGroup>
      {children}
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
    </form>
  )
}
