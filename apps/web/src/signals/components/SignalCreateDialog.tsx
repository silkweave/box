import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, FieldSection } from '@silkweave/box-ui'
import { SignalFields, useSignalEditor, type Form } from './SignalForm.tsx'

/**
 * Create a signal without leaving what you are doing: a milestone's "New signal" makes one and
 * binds it in the same panel. The same editor as the Settings page `signals/new`, in a dialog
 * because the caller is a panel outside Settings and needs the new id back. Editing a signal is
 * always its Settings page.
 */
export function SignalCreateDialog({
  open,
  onOpenChange,
  onSaved,
  defaults,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new signal's (id, channel) after it is created. */
  onSaved?: (id: string, channel: string) => void
  defaults?: Partial<Pick<Form, 'label' | 'channel' | 'group' | 'description'>>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open, so each opening starts from a fresh draft. */}
      {open && <CreateBody defaults={defaults} onSaved={onSaved} onClose={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function CreateBody({ defaults, onSaved, onClose }: { defaults?: Partial<Pick<Form, 'label' | 'channel' | 'group' | 'description'>>; onSaved?: (id: string, channel: string) => void; onClose: () => void }) {
  const editor = useSignalEditor({
    defaults,
    onSaved: (id, channel) => {
      onClose()
      onSaved?.(id, channel)
    },
  })
  const { form } = editor
  const note = form.error ?? (form.dirty ? form.invalid : null)
  return (
    <DialogContent className='max-w-xl'>
      <div className='flex flex-col gap-1'>
        <DialogTitle>New signal</DialogTitle>
        <DialogDescription>A number the team watches over time. It can exist before any data does. The id is derived from the label.</DialogDescription>
      </div>
      <form {...form.formProps} className='flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1'>
        <SignalFields editor={editor} Group={FieldSection} autoFocus />
      </form>
      <div className='flex items-center justify-end gap-2'>
        <p role='status' aria-live='polite' className={`mr-auto min-w-0 truncate text-body-sm ${form.error ? 'text-danger' : 'text-muted-foreground'}`} title={note ?? undefined}>
          {note}
        </p>
        <Button type='button' variant='ghost' size='sm' onClick={onClose} disabled={form.saving}>
          Cancel
        </Button>
        <Button type='submit' size='sm' form={form.formProps.id} disabled={form.saving || !!form.invalid}>
          {form.saving ? 'Creating…' : 'Create signal'}
        </Button>
      </div>
    </DialogContent>
  )
}
