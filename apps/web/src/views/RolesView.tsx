import { useEffect, useState } from 'react'
import type * as React from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  confirm,
  Badge,
  Button,
  InlineDialog as Dialog,
  InlineDialogContent as DialogContent,
  InlineDialogDescription as DialogDescription,
  InlineDialogTitle as DialogTitle,
  SETTINGS_GUTTER,
  SettingsActions,
  SettingsField,
  SettingsFooterBar,
  SettingsIntro,
  SettingsList,
  SettingsListRow,
  settingsInputCls,
  settingsRowActionCls,
  useSettingsFooter,
} from '@silkweave/box-ui'
import { useAuth } from '../lib/useAuth.tsx'
import { ACCESS_LEVELS, deleteRole, previewRole, roleSummary, saveRole, useRoles, type AccessLevel, type Role, type RoleInput } from '../lib/useRoles.ts'

// Settings > Roles (docs/AUTH.md "Roles and areas"): admin and member are built in; a custom role
// grants each area none, read or write, and a default for every area it does not name. Saving
// previews the coverage first (PERMISSIONS 7.2): agents whose readers would stop covering them.
// Everyone may read the list; changing it is admin.

const ROLE_ID = /^[a-z][a-z0-9-]{1,40}$/

type Editor = { role: Role | null } | null

export function RolesView() {
  const { data, error } = useRoles()
  const { principal } = useAuth()
  const admin = principal?.role === 'admin'
  const [editor, setEditor] = useState<Editor>(null)

  useSettingsFooter(
    editor || !data || !admin
      ? null
      : (shadowed) => (
          <SettingsFooterBar shadowed={shadowed}>
            <Button size='sm' onClick={() => setEditor({ role: null })}>
              <Plus /> New role
            </Button>
          </SettingsFooterBar>
        ),
    [Boolean(data), admin, Boolean(editor)],
  )

  if (error) return <p className={cn(SETTINGS_GUTTER, 'text-body-sm text-danger')}>{error}</p>
  if (!data) return <p className={cn(SETTINGS_GUTTER, 'text-body-sm text-muted-foreground')}>Loading…</p>

  const remove = async (r: Role) => {
    if (!(await confirm({ title: `Delete role "${r.label}"?`, message: 'Nobody holds it, so nothing else changes.', confirmLabel: 'Delete', danger: true }))) return
    await deleteRole(r.id).catch((e: unknown) => confirm({ title: 'Not deleted', message: e instanceof Error ? e.message : String(e), confirmLabel: 'OK' }))
  }

  return (
    <div className='pb-6'>
      <SettingsIntro>
        What each role reaches. Every area (each feature, plus signals and ops) is none, read or write. Admin and member
        are built in. People and agents get a role in Users; an agent&rsquo;s output is shown only where every reader covers
        its role, so a change that would leave readers who do not cover an agent is previewed first.
      </SettingsIntro>
      <SettingsList label='Roles'>
        {data.roles.map((r) => {
          const holders = r.users.length + r.agents.length
          const canEdit = admin && !r.builtin
          return (
            <SettingsListRow key={r.id} onOpen={canEdit ? () => setEditor({ role: r }) : undefined} label={r.label} className='grid-cols-[1fr_auto]'>
              <div className='flex min-w-0 flex-col gap-1'>
                <span className='flex items-center gap-2'>
                  <span className='text-body font-medium text-text'>{r.label}</span>
                  <code className='text-label text-muted-foreground'>{r.id}</code>
                  {r.builtin && <Badge variant='neutral'>Built in</Badge>}
                </span>
                <span className='text-label text-muted-foreground'>{roleSummary(r)}</span>
                <span className='text-label text-muted-foreground'>
                  {r.users.length} {r.users.length === 1 ? 'person' : 'people'} · {r.agents.length} {r.agents.length === 1 ? 'agent' : 'agents'}
                </span>
              </div>
              {canEdit ? (
                <span className='flex items-center gap-0.5' onClick={(e) => e.stopPropagation()}>
                  <button type='button' aria-label={`Edit ${r.label}`} title='Edit' onClick={() => setEditor({ role: r })} className={settingsRowActionCls}>
                    <Pencil className='size-4' />
                  </button>
                  <button type='button' aria-label={`Delete ${r.label}`} title={holders ? 'Held by someone: move them to another role first' : 'Delete'} disabled={holders > 0}
                    onClick={() => void remove(r)} className={cn(settingsRowActionCls, 'hover:text-danger disabled:opacity-40')}>
                    <Trash2 className='size-4' />
                  </button>
                </span>
              ) : <span />}
            </SettingsListRow>
          )
        })}
      </SettingsList>
      <RoleDialog open={editor !== null} role={editor?.role ?? null} areas={data.areas} existingIds={data.roles.map((r) => r.id)} onClose={() => setEditor(null)} />
    </div>
  )
}

function RoleDialog({ open, role, areas, existingIds, onClose }: { open: boolean; role: Role | null; areas: string[]; existingIds: string[]; onClose: () => void }) {
  const [f, setF] = useState<RoleInput>({ id: '', label: '', description: '', default: 'none', areas: {} })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    setF({ id: role?.id ?? '', label: role?.label ?? '', description: role?.description ?? '', default: role?.default ?? 'none', areas: { ...role?.areas } })
    setError(null)
    setSaving(false)
  }, [open, role])
  const editing = role !== null
  const id = f.id.trim()
  const idProblem = !id ? null : !ROLE_ID.test(id) ? 'A lowercase slug of 2 to 41 letters, digits and dashes.' : !editing && existingIds.includes(id) ? `"${id}" is taken.` : null
  const level = (area: string): AccessLevel | '' => f.areas[area] ?? ''
  const setLevel = (area: string, next: AccessLevel | '') =>
    setF((p) => {
      const areasNext = { ...p.areas }
      if (next === '') delete areasNext[area]
      else areasNext[area] = next
      return { ...p, areas: areasNext }
    })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (idProblem || !id) return
    setSaving(true)
    setError(null)
    const input: RoleInput = { ...f, id, label: f.label.trim() || id, description: f.description.trim() }
    try {
      const preview = await previewRole(input)
      let opts: { revision?: number; confirm?: 'remove-members' } = {}
      if (preview.messages.length > 0) {
        const lines = preview.messages.join('\n')
        if (preview.confirm === null) {
          setError(`This change would leave agents with readers who do not cover them, and those readers cannot be removed. Cancel, or change these grants first:\n${lines}`)
          setSaving(false)
          return
        }
        const ok = await confirm({
          title: `Save role "${input.label}"?`,
          message: `These people would no longer cover agents in rooms they are in, and will be removed from those rooms:\n${lines}`,
          confirmLabel: 'Remove from those rooms and save',
          danger: true,
        })
        if (!ok) {
          setSaving(false)
          return
        }
        opts = { revision: preview.revision, confirm: 'remove-members' }
      }
      await saveRole(input, opts)
      onClose()
    } catch (err) {
      setSaving(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-lg'>
        <div className='flex flex-col gap-1'>
          <DialogTitle>{editing ? role.label : 'New role'}</DialogTitle>
          <DialogDescription>The level of each area. An area left on default takes the default, including areas installed later.</DialogDescription>
        </div>
        <form id='role-form' onSubmit={(e) => void submit(e)} className='flex flex-col gap-3'>
          <div className='grid grid-cols-2 gap-3'>
            <SettingsField label='Name'>
              <input value={f.label} onChange={(e) => setF((p) => ({ ...p, label: e.target.value }))} placeholder='Sales' className={settingsInputCls} />
            </SettingsField>
            <SettingsField label={editing ? 'Id (fixed)' : 'Id'} hint={idProblem ?? 'A lowercase slug'}>
              <input value={f.id} disabled={editing} onChange={(e) => setF((p) => ({ ...p, id: e.target.value }))} placeholder='sales' className={settingsInputCls} />
            </SettingsField>
          </div>
          <SettingsField label='Description (optional)'>
            <input value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} className={settingsInputCls} />
          </SettingsField>
          <SettingsField label='Default' hint='Every area not listed below with its own level'>
            <LevelSelect label='Default level' value={f.default} onChange={(v) => setF((p) => ({ ...p, default: (v || 'none') as AccessLevel }))} />
          </SettingsField>
          <fieldset className='grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-md border border-border p-3'>
            <legend className='px-1 text-label text-muted-foreground'>Areas</legend>
            {areas.map((area) => (
              <label key={area} className='contents'>
                <span className='text-body-sm text-text'>{area}</span>
                <LevelSelect label={`${area} level`} value={level(area)} onChange={(v) => setLevel(area, v)} allowDefault defaultLevel={f.default} />
              </label>
            ))}
          </fieldset>
          {error && <p className='whitespace-pre-line text-label text-danger'>{error}</p>}
        </form>
        <SettingsActions>
          <Button type='button' variant='ghost' size='sm' onClick={onClose}>Cancel</Button>
          <Button type='submit' form='role-form' size='sm' disabled={saving || !id || idProblem !== null}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create role'}
          </Button>
        </SettingsActions>
      </DialogContent>
    </Dialog>
  )
}

function LevelSelect({ label, value, onChange, allowDefault, defaultLevel }: { label: string; value: AccessLevel | ''; onChange: (v: AccessLevel | '') => void; allowDefault?: boolean; defaultLevel?: AccessLevel }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as AccessLevel | '')} className={cn(settingsInputCls, 'w-auto')}>
      {allowDefault && <option value=''>default ({defaultLevel})</option>}
      {ACCESS_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
    </select>
  )
}
