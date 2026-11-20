import * as React from 'react'
import { ShieldCheck, UserCircle2, Users as UsersIcon, Wrench } from 'lucide-react'
import { useBlocker } from '@tanstack/react-router'
import { Dialog, DialogContent, DialogTitle, InlineDialogScope, ConfirmHost, askToLeave, SettingsDetailHeader, SettingsEmpty, SettingsError, SettingsIntro, SettingsLoading, SettingsPane, SettingsTabs, type SettingsLeaveState } from '@silkweave/box-ui'
import { useSettingsDialog } from '../lib/settingsDialog.ts'
import type { SettingsSection, SettingsSectionGroup } from '../feature.ts'
import { readableWebFeatures } from '../web-features.ts'
import { accessKey } from '../lib/access.ts'
import { useAuth } from '../lib/useAuth.tsx'
import { useUsersData } from '../lib/useUsersData.ts'
import { cn } from '@/lib/utils'
import { UsersView } from './UsersView.tsx'
import { AgentToolsView } from './AgentToolsView.tsx'
import { RolesView } from './RolesView.tsx'
import { AgentAccountsPanel, agentAccountsInfo } from '../components/agent/AgentAccountsPanel.tsx'
import { ConnectedAppsPanel } from '../components/ConnectedAppsPanel.tsx'
import { ConnectClientPanel, useConnectStatus } from '../components/ConnectClientPanel.tsx'
import { UserProfileTab } from '../components/UserProfileTab.tsx'

/** Settings sections. Each carried a role ACL until 2026-09-10; every signed-in principal now sees
 *  all of them, matching a server that no longer gates any of them either. */
/** Core's sections; features add theirs through `settings` in their manifest (order bands as nav). */
const CORE_SECTIONS: SettingsSection[] = [
  { id: 'profile', label: 'Profile', icon: UserCircle2, group: 'account', order: 0, render: (params) => <ProfileSection params={params} /> },
  { id: 'users', label: 'Users', icon: UsersIcon, group: 'team', order: 100, render: (params) => <UsersView params={params} /> },
  { id: 'roles', label: 'Roles', icon: ShieldCheck, group: 'team', order: 102, render: (params) => <RolesView params={params} /> },
  { id: 'agent-tools', label: 'Agent tools', icon: Wrench, group: 'agents', order: 105, render: (params) => <AgentToolsView params={params} /> },
]

/** The nav headings, in order. */
const GROUPS: readonly { id: SettingsSectionGroup; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'team', label: 'Team' },
  { id: 'agents', label: 'Integrations' },
  { id: 'signals', label: 'Signals' },
  { id: 'workspace', label: 'Workspace' },
]
const groupRank = (s: SettingsSection): number => GROUPS.findIndex((g) => g.id === (s.group ?? 'workspace'))

let cachedSections: { key: string; list: SettingsSection[] } | undefined
function allSections(): SettingsSection[] {
  // Feature sections only for areas the principal reads (lib/access.ts); rebuilt when access changes.
  if (cachedSections?.key !== accessKey()) {
    cachedSections = {
      key: accessKey(),
      list: [...CORE_SECTIONS, ...readableWebFeatures().flatMap((f) => f.settings ?? [])].sort(
        (a, b) => groupRank(a) - groupRank(b) || a.order - b.order || a.id.localeCompare(b.id),
      ),
    }
  }
  return cachedSections.list
}

/** One app-wide overlay. Feature registration is read lazily to avoid import cycles. */
export function SettingsDialogHost() {
  const { isOpen, section, params, open, close } = useSettingsDialog()
  const activeNav = React.useRef<HTMLButtonElement>(null)
  const sections = allSections()
  const active = sections.find((s) => s.id === section) ?? sections.find((s) => s.id === 'profile')!
  React.useEffect(() => { activeNav.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [isOpen, active.id])
  // Any navigation (Back, Close, another section, a link) while a form in the pane has unsaved
  // changes asks first; tab switches the person already confirmed and Cancel do not. A save in
  // flight is waited for: it lands and the navigation goes on, or it fails and the page stays.
  const leaveCheck = React.useRef<(() => Promise<SettingsLeaveState>) | null>(null)
  useBlocker({
    enableBeforeUnload: false,
    shouldBlockFn: () => askToLeave(leaveCheck),
  })
  return <>
    {!isOpen && <ConfirmHost />}
    <Dialog open={isOpen} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent initialFocus={activeNav} showClose={false} className='h-dvh w-screen max-w-none gap-0 overflow-hidden rounded-none p-0 sm:h-[min(48rem,90dvh)] sm:w-[min(1024px,calc(100vw-4rem))] sm:rounded-xl'>
        <div className='flex min-h-0 flex-1 flex-col sm:flex-row'>
          <nav aria-label='Settings sections' className='order-last flex shrink-0 gap-1 overflow-auto border-t border-border bg-bg p-2 sm:order-first sm:w-52 sm:flex-col sm:border-r sm:border-t-0 sm:pr-2 sm:pt-5'>
            <DialogTitle className='sr-only font-sans text-lg font-semibold sm:not-sr-only sm:px-3 sm:pb-3'>Settings</DialogTitle>
            {sections.map(({ id, label, icon: Icon, group }, i) => <React.Fragment key={id}>
              {(group ?? 'workspace') !== (sections[i - 1]?.group ?? (i === 0 ? null : 'workspace')) && (
                <p className={cn('hidden px-3 pb-1.5 text-body-sm font-medium text-fg-4 sm:block', i > 0 && 'pt-5')}>
                  {GROUPS.find((g) => g.id === (group ?? 'workspace'))?.label}
                </p>
              )}
              <button ref={id === active.id ? activeNav : undefined} type='button'
                aria-current={active.id === id ? 'page' : undefined}
                onClick={() => open(id)}
                className={cn('flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-body-sm text-text transition-colors outline-none hover:bg-surface-hover focus-visible:bg-surface-hover', active.id === id && 'bg-surface-hover font-medium')}>
                <Icon className='size-4 shrink-0' /><span className='whitespace-nowrap'>{label}</span>
              </button>
            </React.Fragment>)}
          </nav>
          <div className='settings-dialog-detail order-first min-h-0 min-w-0 flex-1 sm:order-last sm:[&_header]:pr-6'>
            {isOpen && (
              <SettingsPane key={active.id} title={active.label} onClose={close} leaveCheck={leaveCheck}>
                <InlineDialogScope key={`${active.id}/${params.join('/')}`} scroll={false}>
                  <ConfirmHost />
                  <SettingsErrorBoundary>{active.render(active.id === section ? params : [])}</SettingsErrorBoundary>
                </InlineDialogScope>
              </SettingsPane>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>
}

class SettingsErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <p role='alert' className='p-8 text-body-sm text-danger'>This settings section could not load. Choose another section or reload the page.</p>
    return this.props.children
  }
}

const PROFILE_TABS = [
  { value: 'profile', label: 'Profile' },
  { value: 'agent-accounts', label: 'Agent accounts' },
  { value: 'connected-clients', label: 'Connected clients' },
] as const
type ProfileTab = (typeof PROFILE_TABS)[number]['value']

/**
 * Settings > Profile: the signed-in person's own record, as routed tabs (docs/DESIGN.md 2.3):
 * Profile (the form, Save and Sign out in its footer), Agent accounts (their Claude and Codex
 * profiles) and Connected clients (AI client setup beside the apps already granted). Each tab owns
 * its footer; only Profile has a Save bar. Routed `#settings/profile/<tab>`.
 */
function ProfileSection({ params }: { params: string[] }) {
  const { principal, logout } = useAuth()
  const { open } = useSettingsDialog()
  const { all, error } = useUsersData(true)
  const connect = useConnectStatus()
  const me = principal ? (all?.find((u) => u.id === principal.id) ?? null) : null

  if (error) return <SettingsError error={error} />
  if (!principal) return <SettingsEmpty>Not signed in.</SettingsEmpty>
  if (!all) return <SettingsLoading />
  if (!me) return <SettingsDetailHeader title={principal.display} meta={<code>{principal.id}</code>} />
  // Connected clients only exist on a Box with MCP sign-in.
  const tabs = PROFILE_TABS.filter((t) => t.value !== 'connected-clients' || connect?.installed)
  const tab: ProfileTab = tabs.find((t) => t.value === params[0])?.value ?? 'profile'
  return (
    <SettingsTabs label='Profile sections' value={tab} items={[...tabs]} onChange={(t) => open(t === 'profile' ? 'profile' : `profile/${t}`)}>
      {tab === 'profile' && <UserProfileTab mode='self' user={me} admin={principal.role === 'admin'} onSignOut={() => void logout()} />}
      {tab === 'agent-accounts' && (
        <>
          <SettingsIntro info={agentAccountsInfo(me, false, true)}>Your Claude and Codex accounts.</SettingsIntro>
          <AgentAccountsPanel user={me} />
        </>
      )}
      {tab === 'connected-clients' && (
        <>
          <SettingsIntro info='AI clients you connect act with your current permissions.'>Set up an AI client and manage the apps you connected.</SettingsIntro>
          <ConnectClientPanel />
          <ConnectedAppsPanel userId={me.id} self name={me.nickname || me.id} />
        </>
      )}
    </SettingsTabs>
  )
}
