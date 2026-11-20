// Story helpers for the settings pieces: a pane to stand them in and stand-in data. Not exported
// from the package.

import * as React from 'react'
import { InlineDialogScope } from '../components/InlineDialog.tsx'
import { cn } from '../lib/utils.ts'
import { Badge } from '../components/Badge.tsx'
import { SegmentedControl } from '../components/SegmentedControl.tsx'
import { SettingsControlList, SettingsControlRow } from './SettingsControlRow.tsx'
import { SettingsPane } from './SettingsPane.tsx'

/** A settings pane at a realistic size, with the inline-page scope sections use. */
export function PaneFrame({ title, className, children }: { title: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('h-[38rem] w-[52rem] max-w-full border border-border', className)}>
      <SettingsPane title={title} onClose={() => undefined}>
        <InlineDialogScope scroll={false}>{children}</InlineDialogScope>
      </SettingsPane>
    </div>
  )
}

export const ROLES = [
  { id: 'admin', name: 'Admin', holders: 2, builtIn: true, description: 'Every area at full access.' },
  { id: 'sales', name: 'Sales', holders: 4, builtIn: false, description: 'Deals, accounts and the inbox.' },
  { id: 'support', name: 'Support', holders: 0, builtIn: false, description: 'Tickets and the help center.' },
]

export const SERVER = {
  name: 'Stripe',
  url: 'https://mcp.stripe.com',
  id: 'srv_7f3a91c2',
  connectedBy: 'Ada',
  tools: 24,
}

/** Resolves after a short wait, like a server round trip. */
export const later = (ms = 600) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Rejects after a short wait with the shape a tRPC client error has. */
export const refused = (message: string, ms = 600) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error(message), { name: 'TRPCClientError' })), ms))

export const AREAS = [
  { id: 'crm', name: 'CRM', description: 'Deals, accounts and contacts.' },
  { id: 'support', name: 'Support', description: 'Tickets, requesters and the help center.' },
  { id: 'notes', name: 'Notes', description: 'Pages and the notes agent.' },
]

type Level = 'none' | 'read' | 'write'
const LEVELS: { value: Level; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
]

/** A role's access per area: control rows with a level each. */
export function ControlRowList() {
  const [levels, setLevels] = React.useState<Record<string, Level>>({ crm: 'write', support: 'read', notes: 'none' })
  return (
    <SettingsControlList label='Access'>
      {AREAS.map((a) => (
        <SettingsControlRow
          key={a.id}
          title={a.name}
          description={a.description}
          meta={a.id === 'notes' ? <Badge size='sm'>Inherited</Badge> : undefined}
          actions={[{ label: 'Reset to default', onSelect: () => setLevels((l) => ({ ...l, [a.id]: 'read' })) }]}>
          <SegmentedControl value={levels[a.id] ?? 'none'} onChange={(v) => setLevels((l) => ({ ...l, [a.id]: v }))} options={LEVELS} />
        </SettingsControlRow>
      ))}
    </SettingsControlList>
  )
}
