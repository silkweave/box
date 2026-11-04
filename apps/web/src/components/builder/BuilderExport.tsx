import * as React from 'react'
import { Download } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@silkweave/box-ui'
import { BUILDER_EXPORT_URL, loadBuilderExportPreview, type BuilderExportPreview } from '../../lib/builderStore.ts'

const size = (bytes: number): string => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * "Export session": shows what the support zip contains (built exactly as the download is), then
 * downloads it. Secrets are redacted on the server; the owner still looks it over before sending.
 */
export function BuilderExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [preview, setPreview] = React.useState<BuilderExportPreview>()
  const [error, setError] = React.useState<string>()
  React.useEffect(() => {
    if (!open) return
    let alive = true
    setPreview(undefined)
    setError(undefined)
    loadBuilderExportPreview().then(
      result => { if (alive) setPreview(result) },
      cause => { if (alive) setError(cause instanceof Error ? cause.message : 'The export could not be prepared.') },
    )
    return () => { alive = false }
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-xl'>
        <DialogTitle>Export session</DialogTitle>
        <DialogDescription>
          One zip for support: the conversation, the git state after each turn, Box events and versions. Known secrets are replaced
          with [redacted]; anything typed or printed in the session is included, so look it over before sending.
        </DialogDescription>
        {error && <p className='text-body-sm text-danger'>{error}</p>}
        {!preview && !error && <p className='text-body-sm text-muted-foreground'>Preparing the export…</p>}
        {preview && <ul className='divide-y divide-border rounded-lg border border-border text-body-sm'>
          {preview.files.map(file => (
            <li key={file.name} className='flex items-baseline gap-3 px-3 py-1.5'>
              <code className='min-w-0 shrink-0 text-label text-text'>{file.name}</code>
              <span className='min-w-0 flex-1 truncate text-label text-muted-foreground'>{file.description}</span>
              <span className='shrink-0 text-label tabular-nums text-fg-4'>{size(file.bytes)}</span>
            </li>
          ))}
        </ul>}
        <div className='flex items-center justify-end gap-2'>
          {preview && <span className='mr-auto text-label text-muted-foreground'>{preview.fileName} · {size(preview.bytes)}</span>}
          <Button variant='ghost' onClick={() => onOpenChange(false)}>Close</Button>
          <Button disabled={!preview} nativeButton={false} render={<a href={BUILDER_EXPORT_URL} download={preview?.fileName} />}><Download />Download zip</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
