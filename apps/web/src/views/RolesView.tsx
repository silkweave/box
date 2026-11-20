import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  confirm,
  Button,
  Field,
  FieldGrid,
  Input,
  SegmentedControl,
  SettingsControlRow,
  SettingsDeleteButton,
  SettingsGroup,
  SettingsHeaderActions,
  SettingsIntro,
  SettingsControlList,
  SettingsNotice,
  SettingsPage,
  SettingsReadOnly,
  SettingsSaveBar,
  UserChip,
  usePersonName,
  useSettingsForm,
  useUsers,
} from '@silkweave/box-ui'
import { DataGrid, NameCell } from '@silkweave/box-ui/list'
import { useAuth } from '../lib/useAuth.tsx'
import { useSettingsDialog } from '../lib/settingsDialog.ts'
import { ACCESS_LEVELS, deleteRole, previewRole, roleSummary, saveRole, useRoles, type AccessLevel, type Role, type RoleInput } from '../lib/useRoles.ts'

// Settings > Roles (docs/AUTH.md "Roles and areas"): admin and member are built in; a custom role
// grants each area none, read or write, and a default for every area it does not name. Saving
// previews the coverage first (PERMISSIONS 7.2): agents whose readers would stop covering them.
// Everyone may read the list; changing it is admin.
//
// Archetype List with Detail and Create pages (docs/DESIGN.md 2.3), routed
// `#settings/roles`, `#settings/roles/<id>`, `#settings/roles/new`.

const SECTION = 'roles'
const ROLE_ID = /^[a-z][a-z0-9-]{1,40}$/
const KIND_OPTIONS = [
  { value: 'builtin', label: 'Built in' },
  { value: 'custom', label: 'Custom' },
]

export function RolesView({ params }: { params: string[] }) {
  const { data, error } = useRoles()
  const { principal } = useAuth()
  const { open } = useSettingsDialog()
  const admin = principal?.role === 'admin'
  const roles = data?.roles ?? []

  const param = params[0]
  const creating = admin && param === 'new'
  const selected = param && param !== 'new' ? data?.roles.find((r) => r.id === param) : undefined
  const missing = data && param && !creating && !selected ? param : null
  const toList = () => open(SECTION)

  return (
    <>
      <SettingsIntro
        info={<>Every area (each feature, plus signals and ops) is none, read or write. Admin and member are built in; assign roles in Users. An agent&rsquo;s output is shown only where every reader covers its role, so a change that would leave a reader short is previewed first.</>}>
        What each role can see and change.
      </SettingsIntro>
      {admin && (
        <SettingsHeaderActions>
          <Button size='sm' onClick={() => open(`${SECTION}/new`)}>
            <Plus /> New role
          </Button>
        </SettingsHeaderActions>
      )}
      {missing && <SettingsNotice tone='warning' title={`There is no role "${missing}" you can see.`} />}
      <DataGrid<Role>
        rows={roles}
        getId={(r) => r.id}
        loading={!data && error == null}
        error={error ?? undefined}
        empty='No roles yet.'
        bar={{
          noun: 'roles',
          fields: [{ key: 'kind', title: 'Kind', type: 'options', options: KIND_OPTIONS.filter((o) => roles.some((r) => (r.builtin ? 'builtin' : 'custom') === o.value)) }],
          sort: [{ value: 'name', label: 'Name' }, { value: 'holders', label: 'Holders', defaultDir: 'desc' }],
        }}
        searchText={(r) => `${r.label} ${r.id} ${r.description}`}
        filterValue={(r) => (r.builtin ? 'builtin' : 'custom')}
        sortValue={(r, key) => (key === 'holders' ? r.users.length + r.agents.length : r.label.toLowerCase())}
        rowLabel={(r) => r.label}
        onOpen={(r) => open(`${SECTION}/${r.id}`)}
        name={{
          label: 'Role',
          render: (r) => <NameCell primary={r.label} secondary={r.id} badge={r.builtin ? { label: 'Built in' } : null} />,
        }}
        columns={[
          { key: 'access', label: 'Access', width: 260, priority: 2, render: (r) => <span className='block truncate text-muted-foreground' title={roleSummary(r)}>{roleSummary(r)}</span> },
          { key: 'people', label: 'People', width: 72, priority: 3, render: (r) => <span className='block w-full text-right tabular-nums'>{r.users.length}</span> },
          { key: 'agents', label: 'Agents', width: 72, render: (r) => <span className='block w-full text-right tabular-nums'>{r.agents.length}</span> },
        ]}
      />
      {data && (creating || selected) && (
        <RolePage key={selected?.id ?? 'new'} role={selected ?? null} areas={data.areas} existingIds={data.roles.map((r) => r.id)} admin={admin} onClose={toList} />
      )}
    </>
  )
}

/** Who holds a role: people and agents as the directory shows them; a row opens the person's page.
 *  An id the directory no longer has (a deleted person) shows as the bare id and does not open. */
function HeldBy({ role }: { role: Role }) {
  const { open } = useSettingsDialog()
  const users = useUsers()
  const personName = usePersonName()
  const holders = [...role.users.map((id) => ({ id, agent: false })), ...role.agents.map((id) => ({ id, agent: true }))]
  const known = (id: string) => !!users?.some((u) => u.id === id)
  return (
    <DataGrid<(typeof holders)[number]>
      variant='section'
      title='Held by'
      rows={holders}
      getId={(h) => h.id}
      empty='Nobody holds this role. Assign it in Users.'
      bar={{ noun: 'holders', one: 'holder' }}
      searchText={(h) => personName(h.id)}
      rowLabel={(h) => personName(h.id)}
      onOpen={(h) => open(`users/${h.id}`)}
      openLabel={(h) => `Open ${personName(h.id)} in Users`}
      name={{
        label: 'Person',
        render: (h) => known(h.id)
          ? <NameCell primary={personName(h.id)} secondary={h.agent ? 'Agent' : undefined} mark={<UserChip userId={h.id} />} />
          : <UserChip userId={h.id} unknown='id' />,
      }}
      columns={[]}
    />
  )
}

/** An area id as people read it: short ids are acronyms (CRM, MCP), others are capitalised. */
const AREA_NAMES: Record<string, string> = { ops: 'Operations' }
const areaName = (area: string): string =>
  AREA_NAMES[area] ?? (/^[a-z]{2,3}$/.test(area) ? area.toUpperCase() : area.charAt(0).toUpperCase() + area.slice(1).replace(/-/g, ' '))
const LEVEL_NAMES: Record<AccessLevel, string> = { none: 'None', read: 'Read', write: 'Write' }
const LEVELS = ACCESS_LEVELS.map((l) => ({ value: l, label: LEVEL_NAMES[l] }))

const valuesOf = (role: Role | null): RoleInput => ({
  id: role?.id ?? '',
  label: role?.label ?? '',
  description: role?.description ?? '',
  default: role?.default ?? 'none',
  areas: { ...role?.areas },
})

/**
 * A role's page ("Roles › Sales") or the create page ("Roles › New role"): name and id, the access
 * matrix (a default for every area, and each area on the default or its own level), then who
 * holds it. Built-in roles and non-admins see it read-only.
 */
function RolePage({ role, areas, existingIds, admin, onClose }: { role: Role | null; areas: string[]; existingIds: string[]; admin: boolean; onClose: () => void }) {
  const editing = role !== null
  const stored = useMemo(() => valuesOf(role), [role])
  // A save the coverage preview refuses outright: the list of grants is too long for the footer note.
  const [blocked, setBlocked] = useState<string | null>(null)

  const form = useSettingsForm<RoleInput>({
    stored,
    create: !editing,
    validate: (v) => {
      const id = v.id.trim()
      if (!id) return 'A role needs an id.'
      if (!ROLE_ID.test(id)) return 'The id is a lowercase slug of 2 to 41 letters, digits and dashes.'
      if (!editing && existingIds.includes(id)) return `"${id}" is taken.`
      return null
    },
    onSave: async (v) => {
      setBlocked(null)
      const id = v.id.trim()
      const input: RoleInput = { ...v, id, label: v.label.trim() || id, description: v.description.trim() }
      const preview = await previewRole(input)
      let opts: { revision?: number; confirm?: 'remove-members' } = {}
      if (preview.messages.length > 0) {
        const lines = preview.messages.join('\n')
        if (preview.confirm === null) {
          setBlocked(lines)
          throw new Error('Not saved: it would leave agents with readers who do not cover them.')
        }
        const ok = await confirm({
          title: `Save role "${input.label}"?`,
          message: `These people would no longer cover agents in rooms they are in, and will be removed from those rooms:\n${lines}`,
          confirmLabel: 'Remove from those rooms and save',
          danger: true,
        })
        if (!ok) throw new Error('Not saved.')
        opts = { revision: preview.revision, confirm: 'remove-members' }
      }
      await saveRole(input, opts)
      if (!editing) onClose()
    },
  })
  const v = form.values
  const setLevel = (area: string, next: AccessLevel | '') => {
    const areasNext = { ...v.areas }
    if (next === '') delete areasNext[area]
    else areasNext[area] = next
    form.set('areas', areasNext)
  }
  const holders = role ? role.users.length + role.agents.length : 0
  const readOnly = !admin || (role?.builtin ?? false)
  const note = role?.builtin ? 'Built-in roles cannot be changed.' : 'Only administrators can change roles.'

  return (
    <SettingsPage title={editing ? role.label : 'New role'} info='A role grants each area none, read or write. Areas installed later take the default.' onClose={onClose}>
      <SettingsReadOnly active={readOnly} note={note}>
        <form {...form.formProps} className='contents'>
          <SettingsGroup title='Role'>
            <FieldGrid columns={2}>
              <Field label='Name'>
                <Input value={v.label} onChange={(e) => form.set('label', e.target.value)} placeholder='Sales' />
              </Field>
              <Field label='Id' hint={editing ? 'Fixed once created.' : 'A lowercase slug, fixed once created.'}>
                <Input mono value={v.id} disabled={editing} onChange={(e) => form.set('id', e.target.value)} placeholder='sales' />
              </Field>
              <Field label='Description' span='full'>
                <Input value={v.description} onChange={(e) => form.set('description', e.target.value)} placeholder='What this role is for' />
              </Field>
            </FieldGrid>
          </SettingsGroup>
          {blocked && (
            <SettingsNotice tone='danger' title='This change would leave agents with readers who do not cover them'>
              <p>Those readers cannot be removed. Change these grants first:</p>
              <p className='mt-1 whitespace-pre-line'>{blocked}</p>
            </SettingsNotice>
          )}
          <SettingsGroup title='Access' description='Each area is on the default or its own level.'>
            <SettingsControlList label='Access by area'>
              <SettingsControlRow title='Default'>
                <SegmentedControl value={v.default} options={LEVELS} onChange={(next) => form.set('default', next)} />
              </SettingsControlRow>
              {areas.map((area) => {
                const own = v.areas[area]
                return (
                  <SettingsControlRow key={area} title={areaName(area)}>
                    <SegmentedControl<AccessLevel | 'default'>
                      value={own ?? 'default'}
                      options={[{ value: 'default', label: `Default (${LEVEL_NAMES[v.default]})` }, ...LEVELS]}
                      onChange={(next) => setLevel(area, next === 'default' ? '' : next)}
                    />
                  </SettingsControlRow>
                )
              })}
            </SettingsControlList>
          </SettingsGroup>
        </form>
        {editing && <HeldBy role={role} />}
        <SettingsSaveBar
          form={form}
          create={editing ? undefined : 'Create role'}
          onCancel={onClose}
          start={editing && (
            <SettingsDeleteButton
              label='Delete role'
              confirm={{ title: `Delete role "${role.label}"?`, message: 'Nobody holds it, so nothing else changes.' }}
              disabledReason={holders ? 'Move its holders to another role first.' : undefined}
              onDelete={async () => {
                await deleteRole(role.id)
                onClose()
              }}
            />
          )}
        />
      </SettingsReadOnly>
    </SettingsPage>
  )
}
