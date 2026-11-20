// Archetypes: CREATE and DETAIL in the app frame (docs/DESIGN.md 1.7). THE BOILERPLATE for one
// record outside Settings: copy `NewAccountForm` in a `RecordDialog` for a create form,
// `AccountPage` for the record's own page, and the `Accounts` router for the crumbs. The route
// decides what shows (here the story's URL hash: `#accounts#new` is the list with New account over
// it, `#accounts/<id>` a record; in the app the router and `useHashDialog('new')`, `/crm#new`), so
// a reload or a shared link lands on the same page or dialog.
//
// Create: a `RecordDialog` over the list, fields only, in `SettingsGroup`s on a `FieldGrid`,
// `useSettingsForm` with `create: true` and `validate`, and `SettingsSaveBar create='Create
// account' onCancel` in the dialog's footer. Create opens the new record; Cancel closes without
// asking. In the app, `useHashDialog` blocks closing a dirty form (`askToLeave(leaveCheck)`; here
// the story only shows the form).
//
// Detail: the record's name is its last crumb (`onRename`), its description that crumb's `info`.
// Its state and Delete ride in the top bar (`TopBarActions`). Fields save one by one as they change
// (no footer, no Save); a write that fails says so with `notifyError` and the field shows the stored
// value again. Read-only values are `SettingsFacts`. Loading, error and a missing record are the
// kit states. A record page with a document (a ticket's summary) puts the `RecordPage` beside its
// editor in a `SplitPane`, with `SaveStatus` in the editor.

import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { confirm } from '../../components/Confirm.tsx'
import { Field, FieldGrid } from '../../components/Field.tsx'
import { Money } from '../../components/Figures.tsx'
import { InlineEdit } from '../../components/InlineEdit.tsx'
import { Input } from '../../components/Input.tsx'
import { notifyError } from '../../components/Notify.tsx'
import { SelectField } from '../../components/SelectField.tsx'
import { Textarea } from '../../components/Textarea.tsx'
import { SettingsEmpty, SettingsError, SettingsFact, SettingsFacts, SettingsGroup, SettingsLoading, SettingsSaveBar, useSettingsForm } from '../../settings/index.ts'
import { later } from '../../settings/storyFrame.tsx'
import { AppShell } from '../../shell/AppShell.tsx'
import { RecordDialog, RecordPage } from '../../shell/RecordPage.tsx'
import type { Crumb } from '../../shell/TopBar.tsx'
import { TopBarActions } from '../../shell/TopBarActions.tsx'
import { UserPicker } from '../../users/UserPicker.tsx'
import { SAMPLE_GROUP_NAV, SAMPLE_NAV_ITEMS, SAMPLE_USERS } from '../fixtures.ts'

type State = 'ready' | 'loading' | 'error'
type Args = { state: State; failWrites: boolean }
const meta: Meta<Args> = {
  title: 'Patterns/App record',
  parameters: { layout: 'fullscreen' },
  args: { state: 'ready', failWrites: false },
  argTypes: {
    state: { control: 'inline-radio', options: ['ready', 'loading', 'error'], description: 'How the record page\'s read went (Retry does nothing in the story).' },
    failWrites: { control: 'boolean', description: 'Every write fails: Create reports in the footer and keeps the draft; a field write says why at the bottom and the field shows the stored value again.' },
  },
}
export default meta

type Stage = 'lead' | 'trial' | 'customer'
type Account = { id: string; name: string; description: string; stage: Stage; owner: string | null; city: string; website: string; mrr: number; created: string }
const STAGES: { value: Stage; label: string }[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'trial', label: 'Trial' },
  { value: 'customer', label: 'Customer' },
]
const SEED: Account[] = [
  { id: 'acme', name: 'Acme Leeds', description: 'Wholesale, two warehouses.', stage: 'customer', owner: SAMPLE_USERS[0]!.id, city: 'Leeds', website: 'acme.example', mrr: 1200, created: '2026-03-02' },
  { id: 'globex', name: 'Globex', description: '', stage: 'trial', owner: null, city: 'Vienna', website: '', mrr: 0, created: '2026-10-28' },
]

// The route: the story's URL hash stands in for the app's router.
function useRoute(): [string, (path: string) => void] {
  const read = () => window.location.hash.replace(/^#accounts\/?/, '')
  const [path, setPath] = useState(read)
  useEffect(() => {
    const on = () => setPath(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [path, (next) => { window.location.hash = next.startsWith('#') ? `accounts${next}` : next ? `accounts/${next}` : 'accounts' }]
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function NewAccountForm({ onCreate, onCancel, fail }: { onCreate: (a: Account) => void; onCancel: () => void; fail: boolean }) {
  const form = useSettingsForm({
    stored: { name: '', owner: null as string | null, city: '', description: '' },
    create: true,
    validate: (v) => (v.name.trim() ? null : 'Name the account.'),
    onSave: async (v) => {
      await later()
      // A failed create: the save bar's note says why, the draft stays.
      if (fail) throw new Error('An account with this name exists already.')
      // Not awaited in the app: the leave guard waits for this save.
      onCreate({ id: slug(v.name), name: v.name.trim(), description: v.description.trim(), stage: 'lead', owner: v.owner, city: v.city.trim(), website: '', mrr: 0, created: '2026-11-20' })
    },
  })
  return (
    <>
      <form {...form.formProps} className='contents'>
        <SettingsGroup title='Account'>
          <FieldGrid columns={2}>
            <Field label='Name'>
              <Input autoFocus value={form.values.name} onChange={(e) => form.set('name', e.target.value)} />
            </Field>
            <Field label='Owner'>
              <UserPicker value={form.values.owner} onChange={(owner) => form.set('owner', owner)} emptyLabel='Nobody' caret className='w-full' />
            </Field>
            <Field label='City'>
              <Input value={form.values.city} onChange={(e) => form.set('city', e.target.value)} />
            </Field>
            <Field label='Description' span='full' hint='One line on who they are; it shows behind the info icon on the account page.'>
              <Textarea rows={3} value={form.values.description} onChange={(e) => form.set('description', e.target.value)} />
            </Field>
          </FieldGrid>
        </SettingsGroup>
      </form>
      <SettingsSaveBar form={form} create='Create account' onCancel={onCancel} />
    </>
  )
}

function AccountPage({ account, state, onWrite, onDelete, onRetry }: {
  account: Account | undefined
  state: State
  onWrite: (patch: Partial<Account>, what: string) => Promise<void>
  onDelete: () => void
  onRetry: () => void
}) {
  if (state === 'loading') return <RecordPage><SettingsLoading label='Loading the account' /></RecordPage>
  if (state === 'error') return <RecordPage><SettingsError error={new Error('The server did not answer.')} onRetry={onRetry} /></RecordPage>
  if (!account) return <RecordPage><SettingsEmpty>No account with this address. It may have been deleted; open Accounts to find it.</SettingsEmpty></RecordPage>
  return (
    <RecordPage>
      <TopBarActions>
        <SelectField aria-label='Stage' className='w-32' value={account.stage} onValueChange={(stage) => void onWrite({ stage }, 'the stage').catch(() => undefined)} options={STAGES} />
        <Button size='sm' variant='outline' onClick={onDelete}>Delete account</Button>
      </TopBarActions>
      <SettingsGroup title='Details'>
        <FieldGrid columns={3}>
          <Field label='Owner'>
            <UserPicker value={account.owner} onChange={(owner) => void onWrite({ owner }, 'the owner').catch(() => undefined)} emptyLabel='Nobody' caret className='w-full' />
          </Field>
          <Field label='City'>
            <InlineEdit key={`city:${account.city}`} aria-label='City' defaultValue={account.city} placeholder='Not set' onCommit={(city) => onWrite({ city }, 'the city')} />
          </Field>
          <Field label='Website'>
            <InlineEdit key={`web:${account.website}`} aria-label='Website' defaultValue={account.website} placeholder='Not set' onCommit={(website) => onWrite({ website }, 'the website')} />
          </Field>
        </FieldGrid>
      </SettingsGroup>
      <SettingsGroup title='Figures'>
        <SettingsFacts columns={3}>
          <SettingsFact label='MRR'><Money value={account.mrr} currency='EUR' /></SettingsFact>
          <SettingsFact label='Created'>{account.created}</SettingsFact>
          <SettingsFact label='Id' mono copy={account.id}>{account.id}</SettingsFact>
        </SettingsFacts>
      </SettingsGroup>
    </RecordPage>
  )
}

function Accounts({ state, failWrites, start }: Args & { start: string }) {
  // Each story opens on its own page; from there the hash routes like the app's router.
  useState(() => { window.location.hash = start.startsWith('#') ? `accounts${start}` : `accounts/${start}` })
  const [path, go] = useRoute()
  const [accounts, setAccounts] = useState(SEED)
  const account = accounts.find((a) => a.id === path)
  const [activeId, setActiveId] = useState('overview')

  // In the app: the update call, then a reload. A failure says why and rejects, so an `InlineEdit`
  // shows the stored value again; pickers and selects show it anyway (they are controlled).
  const write = async (id: string, patch: Partial<Account>, what: string): Promise<void> => {
    await later(200)
    if (failWrites) {
      const err = new Error('The account was changed by someone else meanwhile.')
      notifyError(`Could not save ${what}`, err)
      throw err
    }
    setAccounts((all) => all.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }
  const remove = async (a: Account) => {
    const ok = await confirm({ title: `Delete ${a.name}?`, message: 'Its contacts and deals go with it. This cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    setAccounts((all) => all.filter((x) => x.id !== a.id))
    go('')
  }

  // `#new` after the list's address: the list with New account over it.
  const creating = path === '#new'
  const list: Crumb = { label: 'Accounts', href: '#accounts', onClick: () => go('') }
  const crumbs: Crumb[] =
    path && !creating ? [list, { key: path, label: account?.name ?? path, ...(account && { onRename: (name: string) => void write(account.id, { name }, 'the name').catch(() => undefined), info: account.description ? <p>{account.description}</p> : undefined }) }]
    : [{ label: 'Accounts' }]

  return (
    <AppShell groupNav={{ ...SAMPLE_GROUP_NAV, onSelectGroup: () => undefined }} items={SAMPLE_NAV_ITEMS} activeId={activeId} onSelect={setActiveId} topbar={{ crumbs }} navigationKey={path}>
      {path && !creating ? (
        <AccountPage key={path} account={account} state={state} onWrite={(patch, what) => (account ? write(account.id, patch, what) : Promise.resolve())} onDelete={() => account && void remove(account)} onRetry={() => undefined} />
      ) : (
        <>
          <TopBarActions>
            <Button size='sm' onClick={() => go('#new')}><Plus /> New account</Button>
          </TopBarActions>
          <RecordPage>
            <SettingsEmpty>The list is Patterns/List view. Open New account, or an account: {accounts.map((a) => <a key={a.id} href={`#accounts/${a.id}`} className='mr-2 text-accent underline-offset-2 hover:underline'>{a.name}</a>)}</SettingsEmpty>
          </RecordPage>
          {/* The form is a CHILD of the dialog, so its draft and save bar reach it. */}
          <RecordDialog open={creating} onClose={() => go('')} title='New account'>
            <NewAccountForm
              onCreate={(a) => {
                setAccounts((all) => [...all, a])
                go(a.id)
              }}
              onCancel={() => go('')}
              fail={failWrites}
            />
          </RecordDialog>
        </>
      )}
    </AppShell>
  )
}

/** A create dialog over the list (`#new`): fields only, Create disabled until valid, Create opens the record. */
export const Create: StoryObj<Args> = {
  render: (args) => <Accounts {...args} start='#new' />,
}

/** A record's own page: name in the crumb, state and Delete in the top bar, fields that save as they change. */
export const Detail: StoryObj<Args> = {
  render: (args) => <Accounts {...args} start='acme' />,
}
