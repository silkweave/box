import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Plus } from 'lucide-react'
import {
  ActionMenu,
  Avatar,
  Badge,
  Button,
  Field,
  FieldGrid,
  Input,
  RelativeTime,
  SelectField,
  SettingsControlRow,
  SettingsDeleteButton,
  SettingsDetailHeader,
  SettingsFact,
  SettingsFacts,
  SettingsGroup,
  SettingsHeaderActions,
  SettingsIntro,
  SettingsControlList,
  SettingsNotice,
  SettingsPage,
  SettingsReadOnly,
  SettingsSaveBar,
  Switch,
  confirm,
  useSettingsForm,
  type ActionMenuItem,
} from '@silkweave/box-ui'
import { DataGrid, NameCell } from '@silkweave/box-ui/list'
import { errorMessage } from '@silkweave/box-ui/lib'
import { RunLogPane, type RunStatus } from '@/lib/runLog.tsx'
import type { ProgressChunk } from '@/lib/useRuns.ts'
import { useSettingsDialog } from '@/lib/settingsDialog.ts'
import { runNow } from '../../lib/useRuns.ts'
import { useAuth } from '../../lib/useAuth.tsx'
import { deleteDataSource, reloadDataSources, upsertDataSource, useDataSources, useProviders } from '../lib/useSourcesData.ts'
import type { DataSource, Provider } from '../source-types.ts'

// =================================================================================================
// Data sources (Settings → Data sources) - the user-named instances of a registered provider that
// feed connected signals. Admin configuration, like Schedules: the server refuses a write from
// anyone else, so a member sees the same pages read-only.
//
// Archetype List with Detail and Create pages (docs/DESIGN.md 2.3), routed
// `#settings/data-sources`, `data-sources/<id>` and `data-sources/new`.
//
// The operating ritual this view is shaped around, because it is not guessable: create the source
// (it is born DISABLED) → hand-add its credential to box.local.json credentials → Sync now (the
// parameterized `source-sync`, which syncs disabled sources too) → read the log → flip Enabled so
// it rides the one `sources-sync` schedule. Secrets are never edited here; the page shows only
// whether each key resolves.
// =================================================================================================

const SECTION = 'data-sources'

const STATUS_OPTIONS = ['Enabled', 'Disabled', 'Stale', 'Sync failed', 'No provider'].map((label) => ({ value: label, label }))

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/** Staleness is READ-SIDE only - no stored state, no alert rule. A source is stale when its last
 *  sync is older than ~2x the daily cadence every source runs on today; a never-synced source is
 *  not stale, it is simply new (and its page already says so). */
const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000
const isStale = (s: DataSource): boolean =>
  s.status === 'enabled' && !!s.last_sync_at && Date.now() - new Date(s.last_sync_at).getTime() > STALE_AFTER_MS

/** The one status a source shows: the worst thing wrong with it, else whether it is on. */
function statusOf(s: DataSource): { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string } {
  if (!s.provider_label) return { tone: 'danger', label: 'No provider' }
  if (s.last_sync_status === 'error') return { tone: 'danger', label: 'Sync failed' }
  if (isStale(s)) return { tone: 'warning', label: 'Stale' }
  return s.status === 'enabled' ? { tone: 'success', label: 'Enabled' } : { tone: 'neutral', label: 'Disabled' }
}

const confirmDelete = async (s: DataSource): Promise<boolean> => {
  const ok = await confirm({
    title: `Delete data source "${s.label}"?`,
    message:
      (s.bound_signals.length > 0
        ? `${s.bound_signals.length} signal(s) are bound to it. They keep their points and stop refreshing, and their binding stays visible so you can re-point it. `
        : '') + 'Its credentials live in box.local.json and are not removed; clean them up by hand.',
    confirmLabel: 'Delete data source',
    danger: true,
  })
  if (!ok) return false
  const report = await deleteDataSource(s.id)
  if (report.warnings.length > 0) console.warn(`data-source-delete ${s.id}:`, report.warnings)
  return true
}

export function DataSourcesSection({ params = [] }: { params?: string[] }) {
  const { data: sources, error } = useDataSources()
  const { data: providers } = useProviders()
  const { principal } = useAuth()
  const { open } = useSettingsDialog()
  const admin = principal?.role === 'admin'
  const rows = sources ?? []
  const providerOf = (s: DataSource) => ({ value: s.provider, label: s.provider_label ?? s.provider })
  // A failed delete says so under the source's name, until the next try.
  const [failures, setFailures] = useState<Record<string, string>>({})

  const [first] = params
  const toList = () => open(SECTION)
  if (sources && first === 'new' && admin) return <SourceCreatePage providers={providers ?? []} existingIds={sources.map((x) => x.id)} onClose={toList} />
  const source = sources && first && first !== 'new' ? sources.find((x) => x.id === first) : undefined
  if (source) return <SourcePage key={source.id} source={source} providers={providers ?? []} admin={admin} onClose={toList} />
  const missing = sources && first && first !== 'new' ? first : null

  return (
    <>
      <SettingsIntro info={<>Each source is one account at a provider, with its own key and sync health: two spaces on one platform are two sources. A signal connects by binding one of a source&rsquo;s trackers.</>}>
        Outside services that feed numbers into your signals.
      </SettingsIntro>
      {admin && (
        <SettingsHeaderActions>
          <Button size='sm' disabled={!providers?.length} title={providers?.length ? undefined : 'No provider is registered in this Box'} onClick={() => open(`${SECTION}/new`)}>
            <Plus /> Add data source
          </Button>
        </SettingsHeaderActions>
      )}
      {missing && <SettingsNotice tone='warning' title={`There is no data source "${missing}" you can see.`} />}
      <DataGrid<DataSource>
        rows={rows}
        getId={(s) => s.id}
        loading={!sources && error == null}
        error={error ?? undefined}
        empty={<>No data sources yet.{admin ? ' Add one with Add data source, then use Sync now to check it before you turn it on.' : ' An administrator can add one.'}</>}
        bar={{
          noun: 'data sources',
          fields: [
            { key: 'status', title: 'Status', type: 'options', options: STATUS_OPTIONS.filter((o) => rows.some((s) => statusOf(s).label === o.label)) },
            { key: 'provider', title: 'Provider', type: 'options', options: [...new Map(rows.map((s) => [s.provider, providerOf(s)])).values()].sort((a, b) => a.label.localeCompare(b.label)) },
          ],
          sort: [{ value: 'name', label: 'Name' }, { value: 'synced', label: 'Last synced', defaultDir: 'desc' }, { value: 'signals', label: 'Signals', defaultDir: 'desc' }],
        }}
        searchText={(s) => `${s.label} ${s.id} ${s.provider_label ?? ''} ${s.provider}`}
        filterValue={(s, key) => (key === 'status' ? statusOf(s).label : key === 'provider' ? s.provider : null)}
        sortValue={(s, key) => (key === 'synced' ? (s.last_sync_at ? new Date(s.last_sync_at).getTime() : null) : key === 'signals' ? s.bound_signals.length : s.label.toLowerCase())}
        rowLabel={(s) => s.label}
        onOpen={(s) => open(`${SECTION}/${s.id}`)}
        name={{
          label: 'Source',
          render: (s) => <NameCell primary={s.label} secondary={failures[s.id] ? <span className='text-danger'>{failures[s.id]}</span> : s.id} />,
        }}
        columns={[
          { key: 'provider', label: 'Provider', width: 140, priority: 3, render: (s) => <span className='block truncate text-muted-foreground'>{s.provider_label ?? s.provider}</span> },
          { key: 'signals', label: 'Signals', width: 72, priority: 3, render: (s) => <span className='block w-full text-right tabular-nums text-muted-foreground'>{s.bound_signals.length}</span> },
          { key: 'synced', label: 'Last synced', width: 112, priority: 2, render: (s) => <span className='text-muted-foreground'>{s.last_sync_at ? <RelativeTime value={s.last_sync_at} /> : 'Never'}</span> },
          { key: 'status', label: 'Status', width: 112, render: (s) => <Badge variant={statusOf(s).tone}>{statusOf(s).label}</Badge> },
        ]}
        rowActions={(s) => (
          <ActionMenu
            size='sm'
            label={`Actions for ${s.label}`}
            items={[
              { label: 'Open', onSelect: () => open(`${SECTION}/${s.id}`) },
              ...(admin
                ? [{
                    label: 'Delete data source',
                    danger: true,
                    onSelect: () => {
                      setFailures(({ [s.id]: _gone, ...rest }) => rest)
                      void confirmDelete(s).catch((e) => setFailures((cur) => ({ ...cur, [s.id]: errorMessage(e) })))
                    },
                  }]
                : []),
            ]}
          />
        )}
      />
    </>
  )
}

type SourceValues = { provider: string; label: string; id: string; notes: string; config: Record<string, string> }

/** The source's fields, shared by the create page and the detail page. */
function SourceFields({ form, providers, creating, id }: { form: ReturnType<typeof useSettingsForm<SourceValues>>; providers: Provider[]; creating: boolean; id: string }) {
  const v = form.values
  const provider = providers.find((p) => p.id === v.provider)
  return (
    <>
      <FieldGrid columns={2}>
        <Field label='Provider' span='full' hint={creating ? provider?.description : 'Fixed: changing it would strand the config and credentials.'}>
          <SelectField
            value={v.provider}
            disabled={!creating}
            onValueChange={(p) => form.patch({ provider: p, config: {} })}
            options={providers.map((p) => ({ value: p.id, label: `${p.label} (${p.trackers.length} trackers)` }))}
          />
        </Field>
        <Field label='Name'>
          <Input value={v.label} onChange={(e) => form.set('label', e.target.value)} placeholder='Acme Team' />
        </Field>
        <Field label='Id' hint={creating ? 'Defaults to the name. Fixed once created.' : 'Fixed: it keys the credentials entry.'}>
          <Input mono value={creating ? v.id : id} disabled={!creating} onChange={(e) => form.set('id', e.target.value)} placeholder={slugify(v.label) || 'acme-team'} />
        </Field>
        {provider?.config.map((field) => (
          <Field key={field.key} label={field.label} hint={field.help}>
            <Input value={v.config[field.key] ?? ''} onChange={(e) => form.set('config', { ...v.config, [field.key]: e.target.value })} />
          </Field>
        ))}
        <Field label='Notes' span='full'>
          <Input value={v.notes} onChange={(e) => form.set('notes', e.target.value)} />
        </Field>
      </FieldGrid>
    </>
  )
}

/** The credential names a provider needs and where they go: secrets are hand-edited on the server. */
function CredentialNote({ provider, id }: { provider: Provider; id: string }) {
  if (provider.credentials.length === 0) return null
  return (
    <SettingsNotice title='Add its credential by hand'>
      It needs <code>{provider.credentials.join(', ')}</code> in <code>box.local.json → credentials → {provider.id} → {id || '<id>'}</code>.
    </SettingsNotice>
  )
}

/** Data sources › Add data source: born disabled, so the next steps (credential, one supervised sync,
 *  Enabled) are on its page. */
function SourceCreatePage({ providers, existingIds, onClose }: { providers: Provider[]; existingIds: string[]; onClose: () => void }) {
  const stored = useMemo<SourceValues>(() => ({ provider: providers[0]?.id ?? '', label: '', id: '', notes: '', config: {} }), [providers])
  const idOf = (v: SourceValues) => slugify(v.id) || slugify(v.label)
  const form = useSettingsForm<SourceValues>({
    stored,
    create: true,
    validate: (v) => {
      const id = idOf(v)
      if (!v.provider) return 'Pick a provider.'
      if (!id) return 'A source needs a name or an id (a to z, 0 to 9, dashes).'
      if (existingIds.includes(id)) return `Data source "${id}" already exists.`
      return null
    },
    // Required and undeclared config fields are validated server-side; its message surfaces in the footer.
    onSave: async (v) => {
      const id = idOf(v)
      await upsertDataSource({ id, provider: v.provider, label: v.label.trim() || id, config: v.config, notes: v.notes.trim() })
      onClose()
    },
  })
  const provider = providers.find((p) => p.id === form.values.provider)
  return (
    <SettingsPage title='Add data source' info='One instance of a provider. It is created disabled: add its credential, sync it once by hand, then enable it.' onClose={onClose}>
      <form {...form.formProps} className='contents'>
        <SettingsGroup title='Source'>
          <SourceFields form={form} providers={providers} creating id={idOf(form.values)} />
        </SettingsGroup>
      </form>
      {provider && <CredentialNote provider={provider} id={idOf(form.values)} />}
      <SettingsSaveBar form={form} create='Add data source' onCancel={onClose} />
    </SettingsPage>
  )
}

/** Data sources › a source: its health and what is wrong, the Enabled switch, the fields, and the
 *  log of a supervised sync. */
function SourcePage({ source: s, providers, admin, onClose }: { source: DataSource; providers: Provider[]; admin: boolean; onClose: () => void }) {
  const status = statusOf(s)
  const missingKeys = Object.entries(s.credentials).filter(([, ok]) => !ok).map(([k]) => k)
  const failed = s.last_sync_status === 'error'
  const stale = isStale(s)
  const [failure, setFailure] = useState<string | null>(null)

  // Inline Sync now stream: the Schedules/Ops console idiom.
  const [streaming, setStreaming] = useState(false)
  const [lines, setLines] = useState<ProgressChunk[]>([])
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null)
  const subRef = useRef<{ unsubscribe: () => void } | null>(null)
  useEffect(() => () => subRef.current?.unsubscribe(), [])

  const sync = () => {
    subRef.current?.unsubscribe()
    setStreaming(true)
    setLines([])
    setRunStatus('running')
    subRef.current = runNow(
      'source-sync',
      {
        onData: (p) => {
          setLines((prev) => [...prev, p])
          if (p.phase === 'done') setRunStatus('done')
        },
        onError: (e) => {
          setLines((prev) => [...prev, { channel: s.id, phase: 'done', message: `stream error: ${e.message}` }])
          setRunStatus('error')
        },
        // The run stamps last_sync_* on the row; reload so the page's health catches up.
        onComplete: () => void reloadDataSources().catch(() => undefined),
      },
      { params: { source_id: s.id } },
    )
  }

  const stored = useMemo<SourceValues>(() => ({ provider: s.provider, label: s.label, id: s.id, notes: s.notes, config: s.config }), [s])
  const form = useSettingsForm<SourceValues>({
    stored,
    validate: (v) => (v.label.trim() ? null : 'A source needs a name.'),
    onSave: (v) => upsertDataSource({ id: s.id, label: v.label.trim() || s.id, config: v.config, notes: v.notes.trim() }),
  })

  const problems = [
    ...(!s.provider_label ? [<>The provider <code>{s.provider}</code> is not registered in this Box.</>] : []),
    ...(missingKeys.length > 0
      ? [<>Add its credential by hand: <code>{missingKeys.join(', ')}</code> in <code>box.local.json → credentials → {s.provider} → {s.id}</code>.</>]
      : []),
    ...s.dead_trackers.map((d) => <>{d.signal_id} → {d.tracker_key}: the provider no longer offers that tracker. Re-point or clear it on the signal.</>),
  ]

  const actions: ActionMenuItem[] = admin
    ? [{ label: runStatus === 'running' ? 'Syncing…' : 'Sync now', icon: <Play />, disabled: !s.provider_label || runStatus === 'running', onSelect: sync }]
    : []

  return (
    <SettingsPage title={s.label} info='Syncing works on a disabled source too, so the first sync is a supervised run. Enable it once the log looks right.' onClose={onClose}>
      <SettingsDetailHeader
        title={s.label}
        media={<Avatar label={s.provider_label ?? s.provider} size='lg' />}
        badges={<Badge variant={status.tone}>{status.label}</Badge>}
        meta={
          <span>
            <code>{s.id}</code> &middot; {s.provider_label ?? s.provider}
          </span>
        }
        actions={actions.length > 0 ? actions : undefined}
      />
      {failed && s.last_sync_error && (
        <SettingsNotice tone='danger' title='The last sync failed'>
          <span className='font-mono text-label'>{s.last_sync_error}</span>
        </SettingsNotice>
      )}
      {problems.length > 0 && (
        <SettingsNotice tone='warning' title={problems.length === 1 ? 'This source needs attention' : `${problems.length} things need attention`} items={problems} />
      )}
      {failure && <SettingsNotice tone='danger' title='The change was not saved'>{failure}</SettingsNotice>}

      <SettingsReadOnly active={!admin} note='Only administrators can change data sources.'>
        <form {...form.formProps} className='contents'>
          {/* First after the notices: asks for its own space, the kit's first-group offset is for a page that starts with it. */}
          <SettingsGroup title='Source'>
            <SourceFields form={form} providers={providers} creating={false} id={s.id} />
          </SettingsGroup>
        </form>
        <SettingsGroup title='Sync'>
          <SettingsControlList label='Sync'>
            <SettingsControlRow title='Enabled' description='An enabled source rides the daily sources sync.'>
              <Switch
                aria-label='Enabled'
                checked={s.status === 'enabled'}
                onCheckedChange={(on) => {
                  setFailure(null)
                  upsertDataSource({ id: s.id, status: on ? 'enabled' : 'disabled' }).catch((e) => setFailure(errorMessage(e)))
                }}
              />
            </SettingsControlRow>
          </SettingsControlList>
          <SettingsFacts columns={3}>
            <SettingsFact label='Last synced'>
              {s.last_sync_at ? (
                <span className={failed ? 'text-danger' : stale ? 'text-warning' : undefined}>
                  <RelativeTime value={s.last_sync_at} />
                </span>
              ) : (
                <span className='text-muted-foreground'>Never. Use Sync now to check it before enabling.</span>
              )}
            </SettingsFact>
            <SettingsFact label='Points received'>{s.last_sync_points != null ? s.last_sync_points : <span className='text-muted-foreground'>None yet</span>}</SettingsFact>
            <SettingsFact label='Signals'>
              {s.bound_signals.length === 0 ? (
                <span className='text-muted-foreground'>None bound yet</span>
              ) : (
                <span title={s.bound_signals.join(', ')}>{s.bound_signals.length === 1 ? '1 bound' : `${s.bound_signals.length} bound`}</span>
              )}
            </SettingsFact>
          </SettingsFacts>
        </SettingsGroup>

        {streaming && (
          <SettingsGroup title='Sync log'>
            <RunLogPane title={`Sync - ${s.id}`} status={runStatus} chunks={lines} emptyNote='Waiting for the first progress line…' />
          </SettingsGroup>
        )}

        <SettingsSaveBar
          form={form}
          onCancel={form.reset}
          start={
            <SettingsDeleteButton
              label='Delete data source'
              confirm={{
                title: `Delete data source "${s.label}"?`,
                message:
                  (s.bound_signals.length > 0 ? `${s.bound_signals.length} bound signal(s) keep their points and stop refreshing. ` : '') +
                  'Its credentials in box.local.json are not removed.',
              }}
              onDelete={async () => {
                const report = await deleteDataSource(s.id)
                if (report.warnings.length > 0) console.warn(`data-source-delete ${s.id}:`, report.warnings)
                onClose()
              }}
            />
          }
        />
      </SettingsReadOnly>
    </SettingsPage>
  )
}
