// Archetype: LIST VIEW, an app page (docs/DESIGN.md). THE BOILERPLATE for a page that lists
// records: copy `Accounts` and rename. The page sits in the real `AppShell`: the route decides what
// shows (here the story's own URL hash, `#accounts` or `#accounts/<id>`; in the app the router),
// the crumbs come from the route, and the view's actions go into the top bar with `TopBarActions`
// (create on the list; the record's own acts on its page). One `DataGrid` is the page: the bar
// (search, filters, sort, grouping, columns, list or cards), the sticky column header, rows that
// open the record by navigating, group rows with counts, the empty and no-match states, and the
// footer with the count and column totals. Names use `NameCell`.
//
// The same component is a Settings list (Patterns/Settings list) and the primary list of a tab
// (Patterns/Settings tabbed); only the frame changes. Cells compose kit pieces (`Badge`,
// `UserChip`, figures); a cell that edits in place is a kit control in the cell, and clicks on it
// never open the row. A page with saved views passes `view` / `onViewChange` from its preset system
// instead of letting the grid keep its own view. When the bar is narrow (a small window, the
// sidebar, a split pane), the top bar moves the actions behind "More actions" by itself.

import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ActionMenu } from '../../components/ActionMenu.tsx'
import { Badge } from '../../components/Badge.tsx'
import { Button } from '../../components/Button.tsx'
import { Money } from '../../components/Figures.tsx'
import { DataGrid } from '../../list/DataGrid.tsx'
import { NameCell } from '../../list/NameCell.tsx'
import { SelectField } from '../../components/SelectField.tsx'
import { AppShell } from '../../shell/AppShell.tsx'
import { TopBarActions } from '../../shell/TopBarActions.tsx'
import { SAMPLE_GROUP_NAV, SAMPLE_NAV_ITEMS } from '../fixtures.ts'
import { UserChip } from '../../users/UserChip.tsx'
import { UsersProvider } from '../../users/directory.tsx'
import { SAMPLE_USERS } from '../fixtures.ts'

type Args = { width: 'full' | '820px' }
const meta: Meta<Args> = {
  title: 'Patterns/List view',
  parameters: { layout: 'fullscreen' },
  args: { width: 'full' },
  argTypes: { width: { control: 'inline-radio', options: ['full', '820px'], description: 'The window width: at 820px the record page\'s actions move behind More actions.' } },
}
export default meta

type Account = { id: string; name: string; stage: 'lead' | 'trial' | 'customer'; owner: string | null; mrr: number; city: string }
const STAGES = { lead: 'Lead', trial: 'Trial', customer: 'Customer' } as const
const STAGE_TONE = { lead: 'neutral', trial: 'warning', customer: 'success' } as const
const ACCOUNTS: Account[] = [
  { id: 'acme', name: 'Acme Leeds', stage: 'customer', owner: SAMPLE_USERS[0]!.id, mrr: 1200, city: 'Leeds' },
  { id: 'globex', name: 'Globex', stage: 'trial', owner: SAMPLE_USERS[1]!.id, mrr: 0, city: 'Vienna' },
  { id: 'initech', name: 'Initech', stage: 'lead', owner: null, mrr: 0, city: 'Austin' },
  { id: 'umbrella', name: 'Umbrella', stage: 'customer', owner: SAMPLE_USERS[0]!.id, mrr: 3400, city: 'Berlin' },
  { id: 'hooli', name: 'Hooli Northern Europe and Baltic Operations', stage: 'trial', owner: SAMPLE_USERS[1]!.id, mrr: 0, city: 'Tallinn' },
]

// The route: the story's URL hash stands in for the app's router, so a reload or a shared link lands
// on the same page. `go('')` is the list, `go('acme')` a record.
function useRoute(): [string, (path: string) => void] {
  const read = () => window.location.hash.replace(/^#accounts\/?/, '')
  const [path, setPath] = useState(read)
  useEffect(() => {
    const on = () => setPath(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [path, (next) => { window.location.hash = next ? `accounts/${next}` : 'accounts' }]
}

function AccountsList({ go }: { go: (path: string) => void }) {
  const ownerName = (id: string | null) => SAMPLE_USERS.find((u) => u.id === id)?.first_name ?? 'Nobody'
  return (
    <>
      <TopBarActions>
        <Button size='sm'><Plus /> New account</Button>
      </TopBarActions>
      <DataGrid<Account>
        rows={ACCOUNTS}
        getId={(a) => a.id}
        storageKey='storybook.patterns.accounts'
        bar={{
          noun: 'accounts',
          fields: [{ key: 'stage', title: 'Stage', type: 'options', options: Object.entries(STAGES).map(([value, label]) => ({ value, label })) }],
          sort: [{ value: 'name', label: 'Name' }, { value: 'mrr', label: 'MRR', defaultDir: 'desc' }],
          groupBy: [{ value: 'stage', label: 'Stage' }, { value: 'owner', label: 'Owner' }],
        }}
        searchText={(a) => `${a.name} ${a.city}`}
        filterValue={(a, key) => (key === 'stage' ? a.stage : null)}
        sortValue={(a, key) => (key === 'mrr' ? a.mrr : a.name)}
        groupOf={(a, key) => (key === 'owner' ? { key: a.owner ?? '', label: ownerName(a.owner) } : { key: a.stage, label: STAGES[a.stage] })}
        rowLabel={(a) => a.name}
        onOpen={(a) => go(a.id)}
        name={{ label: 'Account', render: (a) => <NameCell primary={a.name} secondary={a.city} /> }}
        columns={[
          { key: 'stage', label: 'Stage', width: 110, render: (a) => <Badge variant={STAGE_TONE[a.stage]}>{STAGES[a.stage]}</Badge> },
          { key: 'owner', label: 'Owner', width: 150, render: (a) => <UserChip userId={a.owner} showName /> },
          { key: 'mrr', label: 'MRR', width: 110, priority: 2, render: (a) => <Money value={a.mrr} currency='EUR' />, agg: { value: (a) => a.mrr, unit: 'currency', currency: { currency: 'EUR' } } },
        ]}
        rowActions={(a) => <ActionMenu size='sm' label={`Actions for ${a.name}`} items={[{ label: 'Open', onSelect: () => go(a.id) }, { label: 'Delete account', danger: true, onSelect: () => undefined }]} />}
        empty='No accounts yet. Add the first with New account.'
      />
    </>
  )
}

// STAND-IN, not a boilerplate: the record's page only shows where its acts go (a state and Delete in
// the top bar). The create page and the record's own page are Patterns/App record; New account and
// Delete do nothing here.
function AccountPage({ account }: { account: Account }) {
  const [stage, setStage] = useState(account.stage)
  return (
    <>
      <TopBarActions>
        <div className='w-32'>
          <SelectField aria-label='Stage' value={stage} onValueChange={setStage} options={Object.entries(STAGES).map(([value, label]) => ({ value: value as Account['stage'], label }))} />
        </div>
        <Button size='sm' variant='outline'>Delete account</Button>
      </TopBarActions>
      <div className='p-8 text-body-sm text-muted-foreground'>Stand-in for the account page: only its top bar acts are part of this pattern.</div>
    </>
  )
}

function Accounts({ width }: Args) {
  const [path, go] = useRoute()
  const account = ACCOUNTS.find((a) => a.id === path)
  const [activeId, setActiveId] = useState('overview')
  const crumbs = account
    ? [{ label: 'Accounts', href: '#accounts', onClick: () => go('') }, { label: account.name }]
    : [{ label: 'Accounts' }]
  return (
    <div style={{ width: width === 'full' ? '100%' : width }} className='mx-auto'>
      <AppShell groupNav={{ ...SAMPLE_GROUP_NAV, onSelectGroup: () => undefined }} items={SAMPLE_NAV_ITEMS} activeId={activeId} onSelect={setActiveId} topbar={{ crumbs }} navigationKey={path}>
        {account ? <AccountPage key={account.id} account={account} /> : <AccountsList go={go} />}
      </AppShell>
    </div>
  )
}

/** A page of records in the app frame: rows open the record's route; Back is the first crumb. */
export const Page: StoryObj<Args> = {
  render: (args) => (
    <UsersProvider users={SAMPLE_USERS}>
      <Accounts {...args} />
    </UsersProvider>
  ),
}
