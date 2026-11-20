import { SettingsDeleteButton, SettingsGroup, SettingsPage, SettingsSaveBar } from '@silkweave/box-ui'
import { useAuth } from '../../lib/useAuth.tsx'
import { useSettingsDialog } from '../../lib/settingsDialog.ts'
import type { Signal } from '../../types.ts'
import { signalsPath } from '../lib/signalLink.tsx'
import { SignalFields, useSignalEditor } from '../components/SignalForm.tsx'

const INFO = 'A signal is a number the team watches over time: typed in, recorded by an agent, or computed from a tracker or a data source.'

/** Signals › New signal at `#settings/signals/new` (archetype Create, docs/DESIGN.md 2.3). It opens
 *  the new signal's detail once created. */
export function SignalCreatePage() {
  const { open } = useSettingsDialog()
  const toList = () => open(signalsPath())
  const editor = useSignalEditor({
    onSaved: (id) => open(signalsPath(id)),
  })
  return (
    <SettingsPage title='New signal' info={INFO} onClose={toList}>
      <form {...editor.form.formProps} className='contents'>
        <SignalFields editor={editor} Group={SettingsGroup} autoFocus />
      </form>
      <SettingsSaveBar form={editor.form} create='Create signal' onCancel={toList} />
    </SettingsPage>
  )
}

/** A signal's definition at `#settings/signals/<id>/edit` (archetype Detail form): every writer
 *  edits it, like `signal-upsert`; Delete is administrators'. Saving returns to the signal's detail. */
export function SignalEditPage({ signal }: { signal: Signal }) {
  const { open } = useSettingsDialog()
  const { principal } = useAuth()
  const detail = signalsPath(signal.id)
  const toDetail = () => open(detail)
  const editor = useSignalEditor({
    signal,
    onSaved: (id) => open(signalsPath(id)),
  })
  return (
    <SettingsPage
      title='Edit'
      info={INFO}
      trail={[
        { title: signal.label, onSelect: toDetail },
      ]}
      onRoot={() => open(signalsPath())}
      onClose={toDetail}>
      <form {...editor.form.formProps} className='contents'>
        <SignalFields editor={editor} Group={SettingsGroup} />
      </form>
      <SettingsSaveBar
        form={editor.form}
        onCancel={toDetail}
        start={
          // Deleting is admin-only (the server refuses a member).
          principal?.role === 'admin' ? (
            <SettingsDeleteButton
              label='Delete signal'
              confirm={editor.deleteQuestion}
              onDelete={async () => {
                await editor.remove()
                open(signalsPath())
              }}
            />
          ) : undefined
        }
      />
    </SettingsPage>
  )
}
