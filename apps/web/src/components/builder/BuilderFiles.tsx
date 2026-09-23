import { useEffect, useState } from 'react'
import { useHostFileTree, useHostFileSearch, useOpenFiles, isDirty } from '@workerdeck/react'
import { FileTree, FileViewer, EditorTabs } from '@workerdeck/ui/workspace'
import { Button, confirm } from '@silkweave/box-ui'
import { PanelLeftOpen } from 'lucide-react'
import { builderClient } from '../../lib/builderStore.ts'

export function BuilderFiles({ cwd, readOnly, openPath, onUnsaved }: { cwd: string; readOnly: boolean; openPath?: string; onUnsaved: (value: boolean) => void }) {
  const tree = useHostFileTree(builderClient, cwd)
  const search = useHostFileSearch(builderClient, cwd)
  const files = useOpenFiles(builderClient)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => { if (openPath) files.open(openPath) }, [openPath, files.open])
  useEffect(() => { onUnsaved(files.hasUnsaved); return () => onUnsaved(false) }, [files.hasUnsaved, onUnsaved])
  useEffect(() => {
    if (!files.hasUnsaved) return
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [files.hasUnsaved])
  const close = async (path: string): Promise<void> => {
    const file = files.files.find(candidate => candidate.path === path)
    if (file && isDirty(file) && !await confirm({ title: 'Discard unsaved edits?', message: path, confirmLabel: 'Discard', danger: true })) return
    files.close(path)
  }
  return <div className='flex h-full min-h-0 min-w-0'>
    {collapsed ? <Button variant='ghost' size='icon' aria-label='Show project files' onClick={() => setCollapsed(false)}><PanelLeftOpen /></Button> : <FileTree className='w-60 shrink-0 border-r border-border' tree={tree} search={search} activePath={files.activePath} onOpenFile={files.open} onCollapse={() => setCollapsed(true)} />}
    <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <EditorTabs files={files.files} activePath={files.activePath} onActivate={files.activate} onClose={path => void close(path)} />
      {files.active ? <FileViewer file={files.active} canWrite={!readOnly} onChange={files.edit} onSave={path => void files.save(path)} onRevert={files.revert} onReload={files.reload} onOverwrite={path => void files.overwrite(path)} onDismissConflict={files.dismissConflict} /> : <div className='grid flex-1 place-items-center text-body-sm text-fg-3'>Choose a file to inspect or edit.</div>}
    </div>
  </div>
}
