import * as React from 'react'
import { Bot, KeyRound, Link2, Plus, Send, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react'
import {
  ActionMenu,
  type ActionMenuItem,
  Avatar,
  Badge,
  type BadgeProps,
  Button,
  Checkbox,
  confirm,
  CopyButton,
  CopyField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  FieldGrid,
  Input,
  SelectField,
  SettingsGroup,
  SettingsHeaderActions,
  SettingsIntro,
  SettingsNotice,
  SettingsPage,
  SettingsReadOnly,
  SettingsSaveBar,
  SettingsTabs,
  Switch,
  Textarea,
  useSettingsForm,
} from '@silkweave/box-ui'
import { DataGrid, NameCell } from '@silkweave/box-ui/list'
import { errorMessage } from '@silkweave/box-ui/lib'
import { useSettingsDialog } from '../lib/settingsDialog.ts'
import { useAuth } from '../lib/useAuth.tsx'
import { AgentAccountsPanel, agentAccountsInfo } from '../components/agent/AgentAccountsPanel.tsx'
import { ConnectedAppsPanel } from '../components/ConnectedAppsPanel.tsx'
import { slotComponents } from '../lib/slots.ts'
import { UserProfileTab, slugify } from '../components/UserProfileTab.tsx'
import { WorkFoldersInput } from '../components/WorkFoldersInput.tsx'
import {
  createAgent,
  deleteUser,
  setUserRole,
  previewRoleChange,
  type PolicyPreview,
  inviteUser,
  signinLink,
  revealUserInvite,
  revokeUserAccess,
  upsertUser,
  useUsersData,
  type UserInvite,
  type UserSigninLink,
} from '../lib/useUsersData.ts'
import { setAgentRole, useRoles } from '../lib/useRoles.ts'
import { DEFAULT_WORK_ACCESS, USER_STATUS_META, userName, type User, type WorkAccess } from '../user-types.ts'

// Settings > Users: the people and agents directory (docs/AUTH.md). Archetype List with Detail and
// Create pages (docs/DESIGN.md 2.3), routed `#settings/users`, `/<id>[/<tab>]`, `/new`, `/new-agent`.
// An administrator manages everyone; a member sees the list and edits only their own record (the
// server allows `user-upsert` for self or admin; delete, invites and roles are admin).

const SECTION = 'users'

/** A result someone copies before leaving: a sign-in link or an access token (a modal, rule 1.4). */
type Reveal = { kind: 'link'; link: UserSigninLink } | { kind: 'token'; invite: UserInvite }

export function UsersView({ params }: { params: string[] }) {
  const { all: users, error } = useUsersData()
  const { principal } = useAuth()
  const admin = principal?.role === 'admin'
  const [failure, setFailure] = React.useState<string | null>(null)
  const [reveal, setReveal] = React.useState<Reveal | null>(null)

  return <UsersList users={users} error={error} params={params} admin={admin} principalId={principal?.id} failure={failure} setFailure={setFailure} reveal={reveal} setReveal={setReveal} />
}

const KIND_OPTIONS = [
  { value: 'human', label: 'People' },
  { value: 'agent', label: 'Agents' },
]
const STATUS_OPTIONS = Object.entries(USER_STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))

/** The directory: the list with its bar, and the user, agent and create pages over it. */
function UsersList({ users: loaded, error, params, admin, principalId, failure, setFailure, reveal, setReveal }: {
  users: User[] | null | undefined
  error: unknown
  params: string[]
  admin: boolean
  principalId: string | undefined
  failure: string | null
  setFailure: (message: string | null) => void
  reveal: Reveal | null
  setReveal: (r: Reveal | null) => void
}) {
  const { open } = useSettingsDialog()
  const { agent } = useAuth()
  const users = loaded ?? []
  const roleLabel = useRoleLabel()
  const roleIds = [...new Set(users.filter((u) => u.kind !== 'agent').map((u) => u.role ?? 'member'))]
  const kindOf = (u: User) => (u.kind === 'agent' || u.id === agent?.id ? 'agent' : 'human')

  const param = params[0]
  const creating = admin && param === 'new'
  const creatingAgent = admin && param === 'new-agent'
  const selected = param && !creating && !creatingAgent ? users.find((u) => u.id === param) : undefined
  const missing = param && !creating && !creatingAgent && !selected ? param : null
  const toList = () => open(SECTION)
  const existingIds = users.map((u) => u.id)

  return (
    <>
      <SettingsIntro info='People sign in with a short-lived sign-in link or their own access token. Agents act through the Box with the role you give them.'>
        The people and agents in this Box, and their roles.
      </SettingsIntro>
      {admin && (
        <SettingsHeaderActions>
          <Button size='sm' variant='outline' onClick={() => open(`${SECTION}/new-agent`)}>
            <Bot /> New agent
          </Button>
          <Button size='sm' onClick={() => open(`${SECTION}/new`)}>
            <Plus /> New user
          </Button>
        </SettingsHeaderActions>
      )}
      {missing && <SettingsNotice tone='warning' title={`There is no user "${missing}" you can see.`} />}
      {failure && <SettingsNotice tone='danger' title='That did not work.'>{failure}</SettingsNotice>}
      <DataGrid<User>
        rows={users}
        getId={(u) => u.id}
        loading={!loaded && error == null}
        error={error ?? undefined}
        empty='Nobody here yet. New user adds the first person.'
        bar={{
          noun: 'users',
          fields: [
            { key: 'kind', title: 'Kind', type: 'options', options: KIND_OPTIONS.filter((o) => users.some((u) => kindOf(u) === o.value)) },
            { key: 'role', title: 'Role', type: 'options', options: roleIds.map((id) => ({ value: id, label: roleLabel(id) })) },
            { key: 'status', title: 'Status', type: 'options', options: STATUS_OPTIONS.filter((o) => users.some((u) => u.status === o.value)) },
          ],
          sort: [{ value: 'name', label: 'Name' }, { value: 'role', label: 'Role' }],
        }}
        searchText={(u) => `${userName(u)} ${u.nickname} ${u.id} ${u.email ?? ''}`}
        filterValue={(u, key) => (key === 'kind' ? kindOf(u) : key === 'role' ? (u.role ?? 'member') : key === 'status' ? u.status : null)}
        sortValue={(u, key) => (key === 'role' ? (kindOf(u) === 'agent' ? '2' : u.role === 'admin' ? '0' : `1${roleLabel(u.role ?? 'member').toLowerCase()}`) : userName(u).toLowerCase())}
        rowLabel={userName}
        onOpen={(u) => open(`${SECTION}/${u.id}`)}
        name={{ label: 'Name', render: (u) => <UserIdentity user={u} /> }}
        columns={[
          { key: 'role', label: 'Role', width: 150, render: (u) => <RoleBadge user={u} /> },
          { key: 'email', label: 'Email', width: 220, priority: 3, render: (u) => <span className='block truncate text-muted-foreground' title={u.email ?? undefined}>{u.email}</span> },
          { key: 'status', label: 'Status', width: 96, priority: 2, render: (u) => <StatusBadge user={u} /> },
        ]}
        rowActions={admin ? (u) => <ActionMenu size='sm' label={`Actions for ${userName(u)}`} items={accessActions(u, u.id === principalId, setReveal, setFailure)} /> : undefined}
      />
      {creatingAgent && <AgentCreatePage existingIds={existingIds} onClose={toList} onCreated={(u) => open(`${SECTION}/${u.id}`)} />}
      {creating && <UserPage key='new' user={null} tab={undefined} existingIds={existingIds} onClose={toList} />}
      {selected && <UserPage key={selected.id} user={selected} tab={params[1]} existingIds={existingIds} onClose={toList} />}
      {reveal && <RevealDialog reveal={reveal} onClose={() => setReveal(null)} />}
    </>
  )
}

/** A role id as its label from the role catalog ("contractor" reads "Contractor"). */
function useRoleLabel(): (id: string) => string {
  const { data } = useRoles()
  return (id) => data?.roles.find((r) => r.id === id)?.label ?? id.charAt(0).toUpperCase() + id.slice(1)
}

/** What someone is, as a badge: an agent (the system principal included), else their role. */
function roleBadge(user: User, systemId: string | undefined, label: (id: string) => string): { variant: BadgeProps['variant']; label: string; title: string } {
  if (user.kind === 'agent' || user.id === systemId) {
    return { variant: 'info', label: 'Agent', title: user.id === systemId ? "The Box's system agent (box.json agent)" : `An agent (data/config/agents/${user.id}.md)` }
  }
  const role = user.role ?? 'member'
  if (role === 'admin') return { variant: 'accent', label: 'Admin', title: 'Admin: manages users, credentials and the Box' }
  return { variant: 'neutral', label: label(role), title: role === 'member' ? 'Member' : `Custom role: ${label(role)}` }
}

function RoleBadge({ user }: { user: User }) {
  const { agent } = useAuth()
  const b = roleBadge(user, agent?.id, useRoleLabel())
  return <Badge variant={b.variant} className='max-w-full shrink-0 truncate' title={b.title}>{b.label}</Badge>
}

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { active: 'success', invited: 'warning', revoked: 'danger' }
function StatusBadge({ user }: { user: User }) {
  const status = USER_STATUS_META[user.status as keyof typeof USER_STATUS_META]
  if (!status || user.status === 'active') return null
  return <Badge variant={STATUS_VARIANT[user.status] ?? 'neutral'}>{status.label}</Badge>
}

/** A directory row's name cell: avatar, name, the handle under it (the role has its own column). */
function UserIdentity({ user }: { user: User }) {
  return <NameCell primary={userName(user)} secondary={`@${user.nickname || user.id}`} mark={<Avatar user={user} size='sm' />} />
}

/**
 * The access lifecycle as menu items. "Send sign-in link" is first: it is the right answer to "how
 * do I get this person in", needs no permanent credential to change hands, and expires. The access
 * token is for wiring up an MCP client, not for signing in.
 */
function accessActions(user: User, isSelf: boolean, onReveal: (r: Reveal) => void, onFailure: (message: string | null) => void): ActionMenuItem[] {
  const run = (work: () => Promise<void>) => {
    onFailure(null)
    work().catch((e: unknown) => onFailure(errorMessage(e)))
  }
  const name = userName(user)
  if (user.status === 'revoked') {
    return [{
      label: 'Enable user',
      icon: <ShieldCheck />,
      onSelect: () => void confirm({ title: `Enable ${name}?`, message: 'A new access token is minted (their old one stays dead). Send them a sign-in link to get back in.', confirmLabel: 'Enable user' })
        .then((ok) => ok && run(async () => onReveal({ kind: 'token', invite: await inviteUser(user.id) }))),
    }]
  }
  const items: ActionMenuItem[] = [
    { label: 'Send sign-in link', icon: <Send />, onSelect: () => run(async () => onReveal({ kind: 'link', link: await signinLink(user.id) })) },
    {
      label: user.has_token ? 'View access token' : 'Create access token',
      icon: <Link2 />,
      onSelect: () => run(async () => onReveal({ kind: 'token', invite: user.has_token ? await revealUserInvite(user.id) : await inviteUser(user.id) })),
    },
  ]
  if (user.has_token) {
    items.push({
      label: 'Rotate access token',
      icon: <KeyRound />,
      onSelect: () => void confirm({
        title: 'Rotate the access token?',
        message: 'This is a password reset, not an extra device. The current token stops working at once, everywhere it is pasted: browser logins, MCP configs, scripts. If they only lost it, View access token shows the same token and breaks nothing. To get them in, send a sign-in link.',
        confirmLabel: 'Rotate access token',
        danger: true,
      }).then((ok) => ok && run(async () => onReveal({ kind: 'token', invite: await inviteUser(user.id) }))),
    })
  }
  if (!isSelf) {
    items.push({
      label: 'Disable user',
      icon: <ShieldOff />,
      danger: true,
      onSelect: () => void confirm({ title: `Disable ${name}?`, message: 'Their access ends at once; a live session dies on its next request.', confirmLabel: 'Disable user', danger: true })
        .then((ok) => ok && run(() => revokeUserAccess(user.id))),
    })
    items.push({
      label: 'Delete user',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => void confirm({ title: `Delete ${name}?`, message: 'They are unassigned from any initiatives and tasks.', confirmLabel: 'Delete user', danger: true })
        .then((ok) => ok && run(() => deleteUser(user.id))),
    })
  }
  return items
}

/** A sign-in link or an access token, shown once in a modal to copy before leaving. */
function RevealDialog({ reveal, onClose }: { reveal: Reveal; onClose: () => void }) {
  const isLink = reveal.kind === 'link'
  const who = isLink ? reveal.link.user : reveal.invite.user
  const minutes = isLink ? Math.max(1, Math.round((new Date(reveal.link.expiresAt).getTime() - Date.now()) / 60_000)) : 0
  const message = isLink ? reveal.link.message : reveal.invite.message
  const noToken = !isLink && !reveal.invite.token
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-lg'>
        <DialogTitle>{isLink ? `Sign-in link for ${who.nickname || who.id}` : `Access token for ${who.nickname || who.id}`}</DialogTitle>
        <DialogDescription>
          {isLink
            ? `Send this to them. It works once and expires in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. It carries no permanent credential, so it is safe to send; if it expires, make another.`
            : noToken
              ? 'No access token has been issued yet.'
              : 'The permanent credential, for wiring up an MCP client. Treat it like a password: a password manager, never a chat message or a URL. It is the same token every time, so send it again rather than rotating. To get this person signed in, use Send sign-in link instead.'}
        </DialogDescription>
        {!noToken && (
          <FieldGrid columns={1} className='mt-2'>
            <Field label={isLink ? 'Message' : 'Invite message'} aside={<CopyButton value={message} variant='text' />}>
              <Textarea readOnly value={message} rows={5} />
            </Field>
            <CopyField label={isLink ? 'Sign-in link' : 'Box URL'} value={isLink ? reveal.link.url : reveal.invite.url} />
          </FieldGrid>
        )}
        <div className='mt-4 flex justify-end'>
          <Button size='sm' onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const USER_TABS = {
  profile: { value: 'profile', label: 'Profile' },
  access: { value: 'access', label: 'Access' },
  accounts: { value: 'accounts', label: 'Accounts' },
} as const
type UserTab = keyof typeof USER_TABS

/**
 * A person's page ("Users › Toby") as routed tabs (docs/DESIGN.md 2.2), `users/<id>/<tab>`:
 * Profile (the person form, Save and Delete in its footer; the same tab as Settings > Profile),
 * Access (an administrator's: what their Work session may touch, staged with Save, and the role,
 * which applies at once) and Accounts (agent accounts, connected apps and the panels features add
 * with `users.detail`). A member edits only their own page; on others they read Profile and the
 * Accounts panels features add (agent accounts and connected apps stay administrator or self). The create page ("Users › New user") is the plain Profile form.
 */
function UserPage({ user, tab, existingIds, onClose }: { user: User | null; tab: string | undefined; existingIds: string[]; onClose: () => void }) {
  const editing = user
  const { open } = useSettingsDialog()
  const { principal, agent } = useAuth()
  const admin = principal?.role === 'admin'
  const self = !!editing && editing.id === principal?.id
  const isSystem = !!editing && editing.id === agent?.id
  const isAgent = !!editing && (editing.kind === 'agent' || isSystem)
  const readOnly = !admin && !self
  const tabs = editing
    ? [USER_TABS.profile, ...(admin && !self && !isSystem ? [USER_TABS.access] : []), USER_TABS.accounts]
    : []
  const current: UserTab = tabs.find((t) => t.value === tab)?.value ?? 'profile'
  const profile = (
    <UserProfileTab
      mode='directory'
      user={editing}
      admin={admin}
      existingIds={existingIds}
      badges={editing && <><RoleBadge user={editing} /><StatusBadge user={editing} /></>}
      canDelete={admin && !self}
      onClose={onClose}
    />
  )

  return (
    <SettingsPage title={editing ? userName(editing) : 'New user'} info='One directory for everyone: people and agents share the same record.' onClose={onClose}>
      {editing && tabs.length > 1 ? (
        <SettingsTabs label='User sections' value={current} items={[...tabs]} onChange={(t) => open(t === 'profile' ? `${SECTION}/${editing.id}` : `${SECTION}/${editing.id}/${t}`)}>
          <SettingsReadOnly active={readOnly} note='Only administrators can change other people.'>
            {current === 'profile' && profile}
            {current === 'access' && <UserAccessTab user={editing} />}
            {current === 'accounts' && (
              <>
                <SettingsIntro info={agentAccountsInfo(editing, isAgent, self)}>Accounts this {isAgent ? 'agent' : 'person'} runs on and apps they connected.</SettingsIntro>
                {(admin || self) && <AgentAccountsPanel user={editing} titled />}
                {admin && !isAgent && <ConnectedAppsPanel userId={editing.id} self={self} name={editing.nickname || editing.id} />}
                {slotComponents<{ user: User }>('users.detail').map((Panel, i) => <Panel key={i} user={editing} />)}
              </>
            )}
          </SettingsReadOnly>
        </SettingsTabs>
      ) : (
        <SettingsReadOnly active={readOnly} note='Only administrators can change other people.'>{profile}</SettingsReadOnly>
      )}
    </SettingsPage>
  )
}

type AccessValues = { work: WorkAccess }

/** The Access tab of a person or agent: Work (staged, Save in this tab's footer) and the role (applies at once). */
function UserAccessTab({ user }: { user: User }) {
  // Work capabilities: an administrator's to set, for people who are not admins (an admin's Work and
  // every agent's sessions are not guarded). Sent only when changed, as a partial merged by the server.
  const showWork = user.role !== 'admin' && user.kind !== 'agent'
  const stored = React.useMemo<AccessValues>(() => ({ work: user.work ?? DEFAULT_WORK_ACCESS }), [user])
  const form = useSettingsForm<AccessValues>({
    stored,
    equals: (a, b) => JSON.stringify(a.work) === JSON.stringify(b.work),
    onSave: (v) => upsertUser({ id: user.id, work: v.work }),
  })
  const work = form.values.work
  const patchWork = (patch: Partial<WorkAccess>) => form.set('work', { ...work, ...patch })
  return (
    <>
      <RoleGroup user={user} />
      {showWork && (
        <>
          <form {...form.formProps} className='contents'>
            <SettingsGroup title='Work' description="What this person's Work session may touch. It never edits the Box source: it works in their own sandbox, and file tools stay inside the folders granted here.">
              <FieldGrid columns={1}>
                <label className='flex items-center gap-3 text-body-sm text-text'>
                  <Switch checked={work.enabled} onCheckedChange={(enabled) => patchWork({ enabled })} aria-label='Work sessions allowed' />
                  Work sessions allowed
                </label>
                <div className='flex flex-col gap-2 text-body-sm text-text'>
                  <label className='flex items-center gap-2'>
                    <Checkbox checked={work.data} disabled={!work.enabled} onChange={(e) => patchWork({ data: e.target.checked })} />
                    All data and modules <span className='text-muted-foreground'>(the Box tools)</span>
                  </label>
                  <label className='flex items-center gap-2'>
                    <Checkbox checked={work.sandbox} disabled={!work.enabled} onChange={(e) => patchWork({ sandbox: e.target.checked })} />
                    Their sandbox folder <code className='text-label text-muted-foreground'>data/work/{user.id}</code>
                  </label>
                  <label className='flex items-center gap-2'>
                    <Checkbox checked={work.folders} disabled={!work.enabled} onChange={(e) => patchWork({ folders: e.target.checked })} />
                    Selected folders
                  </label>
                </div>
                {work.folders && work.enabled && (
                  <Field label='Folders' hint='Absolute paths on the Box host. Existing directories are suggested as you type; a missing folder can be created when its parent exists. The checkout and its data are never grantable.'>
                    <WorkFoldersInput value={work.folder_paths} onChange={(folder_paths) => patchWork({ folder_paths })} />
                  </Field>
                )}
              </FieldGrid>
            </SettingsGroup>
          </form>
          <SettingsSaveBar form={form} onCancel={form.reset} />
        </>
      )}
    </>
  )
}

/**
 * An admin gives a person or an agent another role (never themselves; the system agent's role is
 * box.json's). It applies at once, after the coverage preview (PERMISSIONS 7.2): with violations the
 * change is refused with the list, or confirmed with the preview's revision to remove those room
 * members.
 */
function RoleGroup({ user }: { user: User }) {
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const { data: roles } = useRoles()
  const isAgent = user.kind === 'agent'
  const role = user.role ?? 'member'
  const change = async (next: string) => {
    if (next === role) return
    setError(null)
    let preview: PolicyPreview
    try {
      preview = await previewRoleChange(isAgent ? 'agent-role' : 'user-role', user.id, next)
    } catch (e) {
      setError(errorMessage(e))
      return
    }
    const lines = preview.messages.join('\n')
    if (preview.messages.length > 0 && preview.confirm === null) {
      setError(`This change would leave agents with readers who do not cover them, and those readers cannot be removed. Change these grants first:\n${lines}`)
      return
    }
    const label = roles?.roles.find((r) => r.id === next)?.label ?? next
    const ok = await confirm({
      title: `Give ${userName(user)} the ${label} role?`,
      message: preview.messages.length > 0
        ? isAgent
          ? `Some readers would no longer cover this agent, and will be removed from those rooms:\n${lines}`
          : `They would no longer cover agents in rooms they are in, and will be removed from those rooms:\n${lines}`
        : next === 'admin' ? 'Admins manage users, credentials and every Box setting.' : role === 'admin' ? 'Their admin sessions and tools stop at once.' : isAgent ? 'Its live sessions end and start again with the new role.' : 'Their access changes at once.',
      confirmLabel: preview.messages.length > 0 ? 'Remove from those rooms and change role' : 'Change role',
      danger: next === 'admin' || preview.messages.length > 0,
    })
    if (!ok) return
    setBusy(true)
    const opts = preview.messages.length > 0 ? { revision: preview.revision, confirm: 'remove-members' as const } : {}
    const save = isAgent ? setAgentRole(user.id, next, opts) : setUserRole(user.id, next, opts)
    save.then(() => setBusy(false), (e: unknown) => { setBusy(false); setError(errorMessage(e)) })
  }
  const options = (roles?.roles ?? [{ id: 'member', label: 'Member' }, { id: 'admin', label: 'Admin' }]).map((r) => ({ value: r.id, label: r.label }))
  return (
    <SettingsGroup title='Role' description='Applies at once. What each role reaches is in Settings › Roles.'>
      <FieldGrid columns={3}>
        <Field label='Role' hint={isAgent ? 'Written to its file in data/config/agents/.' : undefined}>
          <SelectField aria-label='Role' value={role} disabled={busy} onValueChange={(v) => void change(v)} options={options} />
        </Field>
      </FieldGrid>
      {error && <p role='alert' className='whitespace-pre-line text-body-sm text-danger'>{error}</p>}
    </SettingsGroup>
  )
}

/** Settings > Users > New agent: its name, id, role and instructions, created live. Its engine
 *  profile stays host configuration (docs/AUTH.md). */
function AgentCreatePage({ existingIds, onClose, onCreated }: { existingIds: string[]; onClose: () => void; onCreated: (u: User) => void }) {
  const stored = React.useMemo(() => ({ name: '', id: '', role: 'member' as 'admin' | 'member', instructions: '' }), [])
  const form = useSettingsForm({
    stored,
    create: true,
    validate: (v) => {
      const id = v.id || slugify(v.name)
      if (!v.name.trim()) return 'An agent needs a name.'
      if (!id) return 'The id needs a letter or digit.'
      if (existingIds.includes(id)) return `"${id}" is taken.`
      return null
    },
    onSave: async (v) => {
      const id = v.id || slugify(v.name)
      onCreated(await createAgent({ id, name: v.name.trim(), role: v.role, ...(v.instructions.trim() ? { instructions: v.instructions.trim() } : {}) }))
    },
  })
  const v = form.values
  const id = v.id || slugify(v.name)
  return (
    <SettingsPage title='New agent' info={`An agent is a principal with its own token, accounts and instructions, stored as data/config/agents/${id || '<id>'}.md.`} onClose={onClose}>
      <form {...form.formProps} className='contents'>
        <SettingsGroup title='Agent'>
          <FieldGrid columns={3}>
            <Field label='Name'>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <Input autoFocus value={v.name} onChange={(e) => form.set('name', e.target.value)} maxLength={64} placeholder='Stella' />
            </Field>
            <Field label='Id' hint='Fixed once created: it names the agent everywhere.'>
              <Input mono value={id} onChange={(e) => form.set('id', slugify(e.target.value))} maxLength={63} />
            </Field>
            <Field label='Role' hint='Admin agents get the admin tools; an agent never approves sends or creates agents.'>
              <SelectField aria-label='Role' value={v.role} onValueChange={(role) => form.set('role', role)} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} />
            </Field>
            <Field label='Instructions' hint='Added to the engine system prompt at each session start.' span='full'>
              <Textarea value={v.instructions} onChange={(e) => form.set('instructions', e.target.value)} rows={5} placeholder={`You are ${v.name.trim() || 'Stella'}, the team's ...`} />
            </Field>
          </FieldGrid>
        </SettingsGroup>
      </form>
      <SettingsNotice title='It runs sessions once the host has an engine profile for it'>
        Add a workerdeck profile and <code>agentProfiles.{id || '<id>'}</code> in <code>box.local.json</code>, then restart the Box.
      </SettingsNotice>
      <SettingsSaveBar form={form} create='Create agent' onCancel={onClose} />
    </SettingsPage>
  )
}
