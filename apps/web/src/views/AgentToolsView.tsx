import { useEffect, useState } from 'react'
import type * as React from 'react'
import { AlertTriangle, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  confirm,
  Badge,
  Button,
  InlineDialog as Dialog,
  InlineDialogContent as DialogContent,
  InlineDialogDescription as DialogDescription,
  InlineDialogTitle as DialogTitle,
  SelectField,
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
import {
  deleteAgentMcpServer,
  deleteAgentToolset,
  saveAgentMcpServer,
  saveAgentToolset,
  useAgentTools,
  type AgentMcpServer,
  type AgentToolset,
} from '../lib/useAgentTools.ts'

// Settings > Agent tools: the MCP servers this Box can attach to an agent session, and the
// toolsets that grant them. A chat room or an agent trigger names a toolset; one that names none
// gets the Box's own tools only.

const inputCls =
  'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body-sm text-text transition-colors hover:border-accent/40 focus:border-accent focus:outline-none'

const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean)

type Editor = { kind: 'server'; item: AgentMcpServer | null } | { kind: 'toolset'; item: AgentToolset | null } | null

export function AgentToolsView() {
  const { data, error } = useAgentTools()
  const [editor, setEditor] = useState<Editor>(null)

  useSettingsFooter(
    editor || !data
      ? null
      : (shadowed) => (
          <SettingsFooterBar shadowed={shadowed}>
            <Button size='sm' variant='ghost' onClick={() => setEditor({ kind: 'server', item: null })}>
              <Plus /> New server
            </Button>
            <Button size='sm' disabled={data.servers.length === 0} onClick={() => setEditor({ kind: 'toolset', item: null })}>
              <Plus /> New toolset
            </Button>
          </SettingsFooterBar>
        ),
    [data?.servers.length],
  )

  if (error) return <p className={cn(SETTINGS_GUTTER, 'text-body-sm text-danger')}>{error}</p>
  if (!data) return <p className={cn(SETTINGS_GUTTER, 'text-body-sm text-muted-foreground')}>Loading…</p>

  const removeServer = async (s: AgentMcpServer) => {
    if (!(await confirm({ title: `Delete server "${s.label}"?`, message: 'Its token in box.local.json goes with it.', confirmLabel: 'Delete', danger: true }))) return
    await deleteAgentMcpServer(s.id).catch((err) => window.alert(String((err as Error)?.message ?? err)))
  }
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
        one that names none gets the Box&rsquo;s tools only. A toolset&rsquo;s servers answer with the token configured here,
        whoever the session acts for. Toolsets need a Claude agent profile.
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
          No toolsets yet. Add a server, then a toolset that attaches it.
        </p>
      ) : (
        <SettingsList label='Toolsets'>
          {data.toolsets.map((t) => (
            <SettingsListRow key={t.id} onOpen={() => setEditor({ kind: 'toolset', item: t })} label={t.label} className='grid-cols-[1fr_auto]'>
              <div className='flex min-w-0 flex-col gap-1'>
                <span className='flex items-center gap-2'>
                  <span className='text-body font-medium text-text'>{t.label}</span>
                  <code className='text-label text-muted-foreground'>{t.id}</code>
                </span>
                <span className='flex flex-wrap items-center gap-1.5 text-label text-muted-foreground'>
                  {t.servers.map((s) => (
                    <Badge key={s} variant='neutral'>{s}</Badge>
                  ))}
                  <span>
                    {t.allow.length} allowed without approval · {t.deny.length} denied
                  </span>
                </span>
                {t.description && <span className='text-body-sm text-muted-foreground'>{t.description}</span>}
              </div>
              <RowActions label={t.label} onEdit={() => setEditor({ kind: 'toolset', item: t })} onDelete={() => void removeToolset(t)} />
            </SettingsListRow>
          ))}
        </SettingsList>
      )}

      <SettingsListHeading title='Servers' />
      {data.servers.length === 0 ? (
        <p className={cn(SETTINGS_GUTTER, 'border-t border-border py-4 text-body-sm text-muted-foreground')}>
          No MCP servers yet.
        </p>
      ) : (
        <SettingsList label='Servers'>
          {data.servers.map((s) => (
            <SettingsListRow key={s.id} onOpen={() => setEditor({ kind: 'server', item: s })} label={s.label} className='grid-cols-[1fr_auto]'>
              <div className='flex min-w-0 flex-col gap-1'>
                <span className='flex items-center gap-2'>
                  <span className='text-body font-medium text-text'>{s.label}</span>
                  <code className='text-label text-muted-foreground'>mcp__{s.id}</code>
                  {s.hasToken ? <Badge variant='success'>token set</Badge> : <Badge variant='neutral'>no token</Badge>}
                </span>
                <span className='truncate text-label text-muted-foreground'>{s.type.toUpperCase()} {s.url}</span>
              </div>
              <RowActions label={s.label} onEdit={() => setEditor({ kind: 'server', item: s })} onDelete={() => void removeServer(s)} />
            </SettingsListRow>
          ))}
        </SettingsList>
      )}

      <ServerDialog
        open={editor?.kind === 'server'}
        server={editor?.kind === 'server' ? editor.item : null}
        existingIds={data.servers.map((s) => s.id)}
        onClose={() => setEditor(null)}
      />
      <ToolsetDialog
        open={editor?.kind === 'toolset'}
        toolset={editor?.kind === 'toolset' ? editor.item : null}
        servers={data.servers}
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

function ServerDialog({ open, server, existingIds, onClose }: { open: boolean; server: AgentMcpServer | null; existingIds: string[]; onClose: () => void }) {
  const [f, setF] = useState({ id: '', label: '', url: '', type: 'http' as 'http' | 'sse' })
  const submit = useSubmit(onClose)
  useEffect(() => {
    if (!open) return
    setF({ id: server?.id ?? '', label: server?.label ?? '', url: server?.url ?? '', type: server?.type ?? 'http' })
    submit.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, server])
  const editing = server !== null
  const id = f.id.trim()

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing && existingIds.includes(id)) return submit.setError(`Server "${id}" already exists.`)
    submit.run(() => saveAgentMcpServer({ id, url: f.url, type: f.type, label: f.label }))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-lg'>
        <div className='flex flex-col gap-1'>
          <DialogTitle>{editing ? server.label : 'New MCP server'}</DialogTitle>
          <DialogDescription>An MCP server a toolset can attach. Its id is the tool prefix, as in mcp__google__GmailRead.</DialogDescription>
        </div>
        <form id='agent-server-form' onSubmit={onSubmit} className='flex flex-col gap-3'>
          <div className='grid grid-cols-2 gap-3'>
            <SettingsField label='Name'>
              <input value={f.label} onChange={(e) => setF((p) => ({ ...p, label: e.target.value }))} placeholder='Google Workspace' className={inputCls} />
            </SettingsField>
            <SettingsField label={editing ? 'Id (fixed)' : 'Id'} hint='Lowercase letters, digits and _'>
              <input value={f.id} disabled={editing} onChange={(e) => setF((p) => ({ ...p, id: e.target.value }))} placeholder='google' className={inputCls} />
            </SettingsField>
          </div>
          <div className='grid grid-cols-[1fr_8rem] gap-3'>
            <SettingsField label='URL'>
              <input value={f.url} onChange={(e) => setF((p) => ({ ...p, url: e.target.value }))} placeholder='http://127.0.0.1:8300/mcp' className={inputCls} />
            </SettingsField>
            <SettingsField label='Transport'>
              <SelectField
                aria-label='Transport'
                value={f.type}
                onValueChange={(v) => setF((p) => ({ ...p, type: v as 'http' | 'sse' }))}
                options={[{ value: 'http', label: 'HTTP' }, { value: 'sse', label: 'SSE' }]}
              />
            </SettingsField>
          </div>
          <p className='flex items-start gap-1.5 rounded-md border border-border bg-bg px-3 py-2 text-label text-muted-foreground'>
            <KeyRound className='mt-px size-3.5 shrink-0' />
            <span>
              The bearer token is set by hand in <code className='text-text'>box.local.json → agentMcp → servers → {id || '<id>'} → token</code>
              {editing ? (server.hasToken ? '; one is set.' : '; none is set yet.') : '.'}
            </span>
          </p>
          {submit.error && <p className='text-label text-danger'>{submit.error}</p>}
        </form>
        <SettingsActions>
          <Button type='button' variant='ghost' size='sm' onClick={onClose}>Cancel</Button>
          <Button type='submit' form='agent-server-form' size='sm' disabled={submit.saving || !id || !f.url.trim()}>
            {submit.saving ? 'Saving…' : editing ? 'Save changes' : 'Add server'}
          </Button>
        </SettingsActions>
      </DialogContent>
    </Dialog>
  )
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
  servers: AgentMcpServer[]
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
          <DialogDescription>Servers a session gets beside the Box&rsquo;s own, and which of their tools run without asking.</DialogDescription>
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
            <legend className='px-1 text-label text-muted-foreground'>Servers</legend>
            {servers.map((s) => (
              <label key={s.id} className='inline-flex cursor-pointer items-center gap-2 text-body-sm text-text'>
                <input type='checkbox' checked={f.servers.includes(s.id)} onChange={() => toggle(s.id)} className='accent-(--accent)' />
                {s.label} <code className='text-label text-muted-foreground'>mcp__{s.id}</code>
              </label>
            ))}
          </fieldset>
          <SettingsField label='Run without approval' hint='One per line: mcp__google for a whole server, or mcp__google__GmailRead. Other tools of an attached server ask first; an unattended trigger cannot be asked, so its call is refused.'>
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
