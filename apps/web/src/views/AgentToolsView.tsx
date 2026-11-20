import { useMemo } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  confirm,
  ActionMenu,
  Badge,
  Button,
  Checkbox,
  Field,
  FieldGrid,
  Input,
  SettingsDeleteButton,
  SettingsEmpty,
  SettingsGroup,
  SettingsHeaderActions,
  SettingsIntro,
  SettingsNotice,
  SettingsPage,
  SettingsReadOnly,
  SettingsSaveBar,
  Textarea,
  useSettingsForm,
} from '@silkweave/box-ui'
import { DataGrid, NameCell } from '@silkweave/box-ui/list'
import { useAuth } from '../lib/useAuth.tsx'
import { deleteAgentToolset, saveAgentToolset, useAgentTools, type AgentMcpServer, type AgentToolset } from '../lib/useAgentTools.ts'
import { useSettingsDialog } from '../lib/settingsDialog.ts'

// Settings > Agent tools: the toolsets that grant agent sessions more than the Box's own tools. A
// chat room or an agent trigger names a toolset; one that names none gets the Box's own tools only.
// The outside servers a toolset attaches live in Settings > MCP Servers (each server's page says
// which toolsets use it).
//
// A List section (docs/DESIGN.md), with Detail `toolsets/<id>` and Create `toolsets/new`. Every
// person reads it; administrators change it.

const SECTION = 'agent-tools'
const LIST = `${SECTION}/toolsets`
const KIND_OPTIONS = [
  { value: 'builtin', label: 'Built in' },
  { value: 'custom', label: 'Custom' },
]
const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean)

const DELETE_MESSAGE = 'Rooms and triggers that name it get the Box’s own tools only until they pick another, and say so in their logs.'

type Data = ReturnType<typeof useAgentTools>

export function AgentToolsView({ params }: { params: string[] }) {
  const tools = useAgentTools()
  const { principal } = useAuth()
  const admin = principal?.role === 'admin'
  return <Toolsets tools={tools} admin={admin} param={params[0] === 'toolsets' ? params[1] : undefined} />
}

/** The toolsets (List), with each toolset's page (`toolsets/<id>`) and the create page (`toolsets/new`). */
function Toolsets({ tools: { data, error }, admin, param }: { tools: Data; admin: boolean; param: string | undefined }) {
  const { open } = useSettingsDialog()
  const toolsets = data?.toolsets ?? []
  const serverIds = [...new Set(toolsets.flatMap((t) => t.servers))].sort()
  const creating = admin && param === 'new'
  const selected = param && !creating ? data?.toolsets.find((t) => t.id === param) : undefined
  const missing = data && param && !creating && !selected ? param : null
  return (
    <>
      {admin && (
        <SettingsHeaderActions>
          <Button size='sm' onClick={() => open(`${LIST}/new`)}>
            <Plus /> New toolset
          </Button>
        </SettingsHeaderActions>
      )}
      <SettingsIntro
        info={<>A chat room or an agent trigger names a toolset; one that names none gets the Box&rsquo;s own tools only. A toolset&rsquo;s servers are the mcp recipe&rsquo;s MCP servers: the Box relays their calls with its own credential and logs who made each one. Toolsets need a Claude agent profile.</>}>
        What agent sessions can use beyond this Box&rsquo;s own tools.
      </SettingsIntro>
      {missing && <SettingsNotice tone='warning' title={`There is no toolset "${missing}".`} />}
      {data && data.problems.length > 0 && (
        <SettingsNotice tone='warning' title={data.problems.length === 1 ? 'One toolset was skipped' : `${data.problems.length} toolsets were skipped`}>
          <ul className='list-disc pl-4'>{data.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </SettingsNotice>
      )}
      <DataGrid<AgentToolset>
        rows={toolsets}
        getId={(t) => t.id}
        loading={!data && error == null}
        error={error ?? undefined}
        empty={<>No toolsets yet. {admin ? 'New toolset grants agent sessions their first outside tools.' : 'An administrator adds them.'}</>}
        bar={{
          noun: 'toolsets',
          fields: [
            { key: 'kind', title: 'Kind', type: 'options', options: KIND_OPTIONS.filter((o) => toolsets.some((t) => (t.builtIn ? 'builtin' : 'custom') === o.value)) },
            { key: 'server', title: 'MCP server', type: 'options', options: serverIds.map((id) => ({ value: id, label: data?.servers.find((c) => c.id === id)?.label ?? id })) },
          ],
          sort: [{ value: 'name', label: 'Name' }],
        }}
        searchText={(t) => `${t.label} ${t.id} ${t.description} ${t.servers.join(' ')}`}
        filterValue={(t, key) => (key === 'kind' ? (t.builtIn ? 'builtin' : 'custom') : key === 'server' ? t.servers : null)}
        sortValue={(t) => t.label.toLowerCase()}
        rowLabel={(t) => t.label}
        onOpen={(t) => open(`${LIST}/${t.id}`)}
        name={{
          label: 'Toolset',
          render: (t) => <NameCell primary={t.label} secondary={t.id} badge={t.builtIn ? { label: 'Built in' } : null} />,
        }}
        columns={[
          { key: 'servers', label: 'MCP servers', width: 200, priority: 3, render: (t) => <span className='flex min-w-0 items-center gap-1.5 overflow-hidden'>{t.servers.map((s) => <Badge key={s} variant='neutral'>{s}</Badge>)}</span> },
          {
            key: 'access',
            label: 'Access',
            width: 260,
            priority: 2,
            render: (t) => {
              const text = t.boxTools ? `${t.boxTools.length} Box tools only · ${t.deny.length} denied` : `${t.allow.length} allowed without approval · ${t.deny.length} denied`
              return <span className='block truncate text-muted-foreground' title={text}>{text}</span>
            },
          },
        ]}
        rowActions={admin ? (t) => !t.builtIn && (
          <ActionMenu
            size='sm'
            label={`Actions for ${t.label}`}
            items={[{
              label: 'Delete toolset',
              icon: <Trash2 />,
              danger: true,
              onSelect: () => void confirm({ title: `Delete toolset "${t.label}"?`, message: DELETE_MESSAGE, confirmLabel: 'Delete toolset', danger: true })
                .then((ok) => { if (ok) void deleteAgentToolset(t.id) }),
            }]}
          />
        ) : undefined}
      />

      {data && (creating || selected) && (
        <ToolsetPage
          key={selected?.id ?? 'new'}
          toolset={selected ?? null}
          servers={data.servers}
          serversAvailable={data.serversAvailable}
          existingIds={data.toolsets.map((t) => t.id)}
          admin={admin}
          onClose={() => open(LIST)}
        />
      )}
    </>
  )
}

/** A toolset's page ("Agent tools › Team chat") or the create page. Built-in toolsets and members
 *  see it read-only. */
function ToolsetPage({ toolset, servers, serversAvailable, existingIds, admin, onClose }: {
  toolset: AgentToolset | null
  servers: AgentMcpServer[]
  serversAvailable: boolean
  existingIds: string[]
  admin: boolean
  onClose: () => void
}) {
  const { open } = useSettingsDialog()
  const editing = toolset !== null
  const stored = useMemo(() => ({
    id: toolset?.id ?? '',
    label: toolset?.label ?? '',
    description: toolset?.description ?? '',
    servers: toolset?.servers ?? [],
    allow: (toolset?.allow ?? []).join('\n'),
    deny: (toolset?.deny ?? []).join('\n'),
  }), [toolset])
  const form = useSettingsForm({
    stored,
    create: !editing,
    validate: (v) => {
      const id = v.id.trim()
      if (!id) return 'A toolset needs an id.'
      if (!editing && existingIds.includes(id)) return `Toolset "${id}" already exists.`
      return null
    },
    onSave: async (v) => {
      await saveAgentToolset({ id: v.id.trim(), label: v.label, description: v.description, servers: v.servers, allow: lines(v.allow), deny: lines(v.deny) })
      if (!editing) onClose()
    },
  })
  const v = form.values
  const toggle = (sid: string) => form.set('servers', v.servers.includes(sid) ? v.servers.filter((s) => s !== sid) : [...v.servers, sid])
  const readOnly = !admin || (toolset?.builtIn ?? false)
  const note = toolset?.builtIn ? 'A feature registers this toolset in code; it cannot be changed here.' : 'Only administrators can change toolsets.'

  return (
    <SettingsPage title={editing ? toolset.label : 'New toolset'} info='MCP servers a session gets beside the Box’s own tools, and which of their tools run without asking.' onClose={onClose}>
      <SettingsReadOnly active={readOnly} note={note}>
        <form {...form.formProps} className='contents'>
          <SettingsGroup title='Toolset'>
            <FieldGrid columns={2}>
              <Field label='Name'>
                <Input value={v.label} onChange={(e) => form.set('label', e.target.value)} placeholder='Team chat' />
              </Field>
              <Field label='Id' hint={editing ? 'Fixed once created.' : 'A lowercase slug, fixed once created.'}>
                <Input mono value={v.id} disabled={editing} onChange={(e) => form.set('id', e.target.value)} placeholder='team' />
              </Field>
              <Field label='Description' span='full'>
                <Textarea autoGrow rows={1} value={v.description} onChange={(e) => form.set('description', e.target.value)} placeholder='What sessions with this toolset are for' />
              </Field>
            </FieldGrid>
          </SettingsGroup>
          <SettingsGroup title='MCP servers' description='The servers a session with this toolset can call.'>
            {servers.length === 0 ? (
              <SettingsEmpty>
                {serversAvailable
                  ? 'No MCP servers on this Box yet.'
                  : 'Outside MCP servers (Stripe, Linear, ...) come with the mcp recipe’s MCP Servers powerup, which this Box has not adapted. An administrator can adapt it from the Recipe Gallery.'}
                {admin && serversAvailable && (
                  <Button size='sm' variant='outline' className='ml-3' onClick={() => open('mcp-servers/new')}>
                    <Plus /> Add server
                  </Button>
                )}
              </SettingsEmpty>
            ) : (
              <div className='flex flex-col gap-2'>
                {servers.map((s) => (
                  <label key={s.id} className='inline-flex items-center gap-2 text-body-sm text-text'>
                    <Checkbox checked={v.servers.includes(s.id)} disabled={readOnly} onChange={() => toggle(s.id)} />
                    {s.label} <code className='text-label text-muted-foreground'>mcp__{s.id}</code>
                  </label>
                ))}
              </div>
            )}
          </SettingsGroup>
          <SettingsGroup title='Tools'>
            <FieldGrid columns={2}>
              <Field label='Run without approval' hint='One per line: mcp__stripe for a whole server, or mcp__stripe__stripe_api_read. Other tools of an attached server ask first; an unattended trigger cannot be asked, so its call is refused.'>
                <Textarea mono rows={5} value={v.allow} onChange={(e) => form.set('allow', e.target.value)} />
              </Field>
              {toolset?.boxTools && (
                <Field label='Box tools' hint='Built in: the only Box tools its sessions keep.' span='full'>
                  <Textarea mono readOnly autoGrow rows={2} value={toolset.boxTools.join('\n')} />
                </Field>
              )}
              <Field label='Never available' hint='One per line: an MCP tool or server, or a built-in such as Bash, Write or Edit.'>
                <Textarea mono rows={5} value={v.deny} onChange={(e) => form.set('deny', e.target.value)} />
              </Field>
            </FieldGrid>
          </SettingsGroup>
        </form>
        <SettingsSaveBar
          form={form}
          create={editing ? undefined : 'Create toolset'}
          onCancel={onClose}
          start={editing && (
            <SettingsDeleteButton
              label='Delete toolset'
              confirm={{ title: `Delete toolset "${toolset.label}"?`, message: DELETE_MESSAGE }}
              onDelete={async () => {
                await deleteAgentToolset(toolset.id)
                onClose()
              }}
            />
          )}
        />
      </SettingsReadOnly>
    </SettingsPage>
  )
}
