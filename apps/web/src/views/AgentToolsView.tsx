import { useEffect, useState } from 'react'
import type * as React from 'react'
import { AlertTriangle, Pencil, Plug, Plus, Trash2 } from 'lucide-react'
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
  SettingsListHeading,
  SettingsListRow,
  settingsRowActionCls,
  useSettingsFooter,
} from '@silkweave/box-ui'
import { deleteAgentToolset, saveAgentToolset, useAgentTools, type AgentMcpConnection, type AgentToolset } from '../lib/useAgentTools.ts'
import { useSettingsDialog } from '../lib/settingsDialog.ts'

// Settings > Agent tools: the toolsets that grant agent sessions more than the Box's own tools, and
// the connections (outside MCP servers, the mcp recipe's Settings > Connections) they can attach. A
// chat room or an agent trigger names a toolset; one that names none gets the Box's own tools only.

const inputCls =
  'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body-sm text-text transition-colors hover:border-accent/40 focus:border-accent focus:outline-none'

const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean)

type Editor = { kind: 'toolset'; item: AgentToolset | null } | null

export function AgentToolsView() {
  const { data, error } = useAgentTools()
  const [editor, setEditor] = useState<Editor>(null)
  const { open: openSettings } = useSettingsDialog()

  useSettingsFooter(
    editor || !data
      ? null
      : (shadowed) => (
          <SettingsFooterBar shadowed={shadowed}>
            <Button size='sm' onClick={() => setEditor({ kind: 'toolset', item: null })}>
              <Plus /> New toolset
            </Button>
          </SettingsFooterBar>
        ),
    [Boolean(data)],
  )

  if (error) return <p className={cn(SETTINGS_GUTTER, 'text-body-sm text-danger')}>{error}</p>
  if (!data) return <p className={cn(SETTINGS_GUTTER, 'text-body-sm text-muted-foreground')}>Loading…</p>

  const removeToolset = async (t: AgentToolset) => {
    if (
      !(await confirm({
        title: `Delete toolset "${t.label}"?`,
        message: 'Rooms and triggers that name it get the Box’s own tools only until they pick another, and say so in their logs.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return
    await deleteAgentToolset(t.id)
  }

  return (
    <div className='pb-6'>
      <SettingsIntro>
        What an agent session can reach beyond this Box&rsquo;s own tools. A chat room or an agent trigger names a toolset;
        one that names none gets the Box&rsquo;s tools only. A toolset&rsquo;s servers are connections: the Box relays their
        calls with its own credential and logs who made each one. Toolsets need a Claude agent profile.
      </SettingsIntro>

      {data.problems.length > 0 && (
        <div className={cn(SETTINGS_GUTTER, 'pb-4')}>
          {data.problems.map((p) => (
            <p key={p} className='flex items-start gap-1.5 text-label text-warning'>
              <AlertTriangle className='mt-px size-3.5 shrink-0' />
              <span>{p} (skipped)</span>
            </p>
          ))}
        </div>
      )}

      <SettingsListHeading title='Toolsets' className='pt-0' />
      {data.toolsets.length === 0 ? (
        <p className={cn(SETTINGS_GUTTER, 'border-t border-border py-4 text-body-sm text-muted-foreground')}>
          No toolsets yet.
        </p>
      ) : (
        <SettingsList label='Toolsets'>
          {data.toolsets.map((t) => (
            <SettingsListRow key={t.id} onOpen={t.builtIn ? undefined : () => setEditor({ kind: 'toolset', item: t })} label={t.label} className='grid-cols-[1fr_auto]'>
              <div className='flex min-w-0 flex-col gap-1'>
                <span className='flex items-center gap-2'>
                  <span className='text-body font-medium text-text'>{t.label}</span>
                  <code className='text-label text-muted-foreground'>{t.id}</code>
                  {t.builtIn && <Badge variant='neutral'>Built in</Badge>}
                </span>
                <span className='flex flex-wrap items-center gap-1.5 text-label text-muted-foreground'>
                  {t.servers.map((s) => (
                    <Badge key={s} variant='neutral'>{s}</Badge>
                  ))}
                  <span>
                    {t.boxTools
                      ? `${t.boxTools.length} Box tools only · ${t.deny.length} denied`
                      : `${t.allow.length} allowed without approval · ${t.deny.length} denied`}
                  </span>
                </span>
                {t.description && <span className='text-body-sm text-muted-foreground'>{t.description}</span>}
              </div>
              {t.builtIn ? <span /> : <RowActions label={t.label} onEdit={() => setEditor({ kind: 'toolset', item: t })} onDelete={() => void removeToolset(t)} />}
            </SettingsListRow>
          ))}
        </SettingsList>
      )}

      <SettingsListHeading title='Connections' />
      {!data.connectionsAvailable ? (
        <p className={cn(SETTINGS_GUTTER, 'flex items-start gap-1.5 border-t border-border py-4 text-body-sm text-muted-foreground')}>
          <Plug className='mt-0.5 size-4 shrink-0' />
          <span>
            Outside MCP servers (Stripe, Linear, ...) are set up with the MCP connections recipe, which this Box has not adapted. Toolsets can still deny
            tools without it. An administrator can adapt it from the Recipe Gallery.
          </span>
        </p>
      ) : data.connections.length === 0 ? (
        <p className={cn(SETTINGS_GUTTER, 'border-t border-border py-4 text-body-sm text-muted-foreground')}>
          No connections yet.{' '}
          <button type='button' className='text-accent hover:underline' onClick={() => openSettings('connections')}>Add one in Connections</button>.
        </p>
      ) : (
        <SettingsList label='Connections'>
          {data.connections.map((c) => (
            <SettingsListRow key={c.id} onOpen={() => openSettings(`connections/${c.id}`)} label={c.label} className='grid-cols-[1fr_auto]'>
              <span className='flex items-center gap-2'>
                <span className='text-body font-medium text-text'>{c.label}</span>
                <code className='text-label text-muted-foreground'>mcp__{c.id}</code>
              </span>
              <span />
            </SettingsListRow>
          ))}
        </SettingsList>
      )}

      <ToolsetDialog
        open={editor?.kind === 'toolset'}
        toolset={editor?.kind === 'toolset' ? editor.item : null}
        servers={data.connections}
        existingIds={data.toolsets.map((t) => t.id)}
        onClose={() => setEditor(null)}
      />
    </div>
  )
}

function RowActions({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <span className='flex items-center gap-0.5' onClick={(e) => e.stopPropagation()}>
      <button type='button' aria-label={`Edit ${label}`} title='Edit' onClick={onEdit} className={settingsRowActionCls}>
        <Pencil className='size-4' />
      </button>
      <button type='button' aria-label={`Delete ${label}`} title='Delete' onClick={onDelete} className={cn(settingsRowActionCls, 'hover:text-danger')}>
        <Trash2 className='size-4' />
      </button>
    </span>
  )
}

function useSubmit(onClose: () => void) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const run = (work: () => Promise<void>) => {
    setSaving(true)
    setError(null)
    void work()
      .then(onClose)
      .catch((err) => {
        setSaving(false)
        setError(String((err as Error)?.message ?? err))
      })
  }
  const reset = () => {
    setError(null)
    setSaving(false)
  }
  return { error, saving, run, reset, setError }
}

function ToolsetDialog({
  open,
  toolset,
  servers,
  existingIds,
  onClose,
}: {
  open: boolean
  toolset: AgentToolset | null
  servers: AgentMcpConnection[]
  existingIds: string[]
  onClose: () => void
}) {
  const [f, setF] = useState({ id: '', label: '', description: '', servers: [] as string[], allow: '', deny: '' })
  const submit = useSubmit(onClose)
  useEffect(() => {
    if (!open) return
    setF({
      id: toolset?.id ?? '',
      label: toolset?.label ?? '',
      description: toolset?.description ?? '',
      servers: toolset?.servers ?? [],
      allow: (toolset?.allow ?? []).join('\n'),
      deny: (toolset?.deny ?? []).join('\n'),
    })
    submit.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, toolset])
  const editing = toolset !== null
  const id = f.id.trim()

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing && existingIds.includes(id)) return submit.setError(`Toolset "${id}" already exists.`)
    submit.run(() => saveAgentToolset({ id, label: f.label, description: f.description, servers: f.servers, allow: lines(f.allow), deny: lines(f.deny) }))
  }
  const toggle = (sid: string) =>
    setF((p) => ({ ...p, servers: p.servers.includes(sid) ? p.servers.filter((s) => s !== sid) : [...p.servers, sid] }))

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-lg'>
        <div className='flex flex-col gap-1'>
          <DialogTitle>{editing ? toolset.label : 'New toolset'}</DialogTitle>
          <DialogDescription>Connections a session gets beside the Box&rsquo;s own tools, and which of their tools run without asking.</DialogDescription>
        </div>
        <form id='agent-toolset-form' onSubmit={onSubmit} className='flex flex-col gap-3'>
          <div className='grid grid-cols-2 gap-3'>
            <SettingsField label='Name'>
              <input value={f.label} onChange={(e) => setF((p) => ({ ...p, label: e.target.value }))} placeholder='Team chat' className={inputCls} />
            </SettingsField>
            <SettingsField label={editing ? 'Id (fixed)' : 'Id'} hint='A lowercase slug'>
              <input value={f.id} disabled={editing} onChange={(e) => setF((p) => ({ ...p, id: e.target.value }))} placeholder='team' className={inputCls} />
            </SettingsField>
          </div>
          <SettingsField label='Description (optional)'>
            <input value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} className={inputCls} />
          </SettingsField>
          <fieldset className='flex flex-col gap-1.5 rounded-md border border-border p-3'>
            <legend className='px-1 text-label text-muted-foreground'>Connections</legend>
            {servers.length === 0 && <p className='text-label text-muted-foreground'>No connections on this Box.</p>}
            {servers.map((s) => (
              <label key={s.id} className='inline-flex cursor-pointer items-center gap-2 text-body-sm text-text'>
                <input type='checkbox' checked={f.servers.includes(s.id)} onChange={() => toggle(s.id)} className='accent-(--accent)' />
                {s.label} <code className='text-label text-muted-foreground'>mcp__{s.id}</code>
              </label>
            ))}
          </fieldset>
          <SettingsField label='Run without approval' hint='One per line: mcp__stripe for a whole connection, or mcp__stripe__stripe_api_read (the upstream tool name). Other tools of an attached server ask first; an unattended trigger cannot be asked, so its call is refused.'>
            <textarea rows={4} value={f.allow} onChange={(e) => setF((p) => ({ ...p, allow: e.target.value }))} className={cn(inputCls, 'font-mono text-label')} />
          </SettingsField>
          <SettingsField label='Never available' hint='One per line: an MCP tool or server, or a built-in such as Bash, Write or Edit.'>
            <textarea rows={3} value={f.deny} onChange={(e) => setF((p) => ({ ...p, deny: e.target.value }))} className={cn(inputCls, 'font-mono text-label')} />
          </SettingsField>
          {submit.error && <p className='text-label text-danger'>{submit.error}</p>}
        </form>
        <SettingsActions>
          <Button type='button' variant='ghost' size='sm' onClick={onClose}>Cancel</Button>
          <Button type='submit' form='agent-toolset-form' size='sm' disabled={submit.saving || !id}>
            {submit.saving ? 'Saving…' : editing ? 'Save changes' : 'Create toolset'}
          </Button>
        </SettingsActions>
      </DialogContent>
    </Dialog>
  )
}
