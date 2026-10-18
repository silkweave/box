import * as React from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, FolderPlus } from 'lucide-react'
import { ChipList, groupCls, itemCls, popupCls } from '@silkweave/box-ui'
import { createWorkFolder, workFolderSuggestions } from '../lib/useUsersData.ts'
import { cn } from '@/lib/utils'

// The "Work in selected folders" picker of Settings > Users: a chip per granted folder, and an
// input that completes an absolute host path from the directories the server would accept
// (`usersWorkFolders`, the same classification `usersUpsert` applies). Enter adds what is typed,
// a listed directory adds itself, and a path whose parent exists can be created in place.
// The server stays authoritative: whatever is added here is checked again on Save.

/** One row of the popup: an existing directory, or the offer to make the typed one. */
interface FolderItem {
  path: string
  create: boolean
}

const DEBOUNCE_MS = 150

export function WorkFoldersInput({ value, onChange, disabled }: { value: string[]; onChange: (paths: string[]) => void; disabled?: boolean }) {
  const [query, setQuery] = React.useState('')
  const [items, setItems] = React.useState<FolderItem[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const latest = React.useRef(0)

  // Suggestions follow the query with a short debounce; a stale answer never overwrites a newer one.
  React.useEffect(() => {
    const seq = ++latest.current
    const q = query.trim()
    if (!q.startsWith('/')) {
      setItems([])
      return
    }
    const timer = window.setTimeout(() => {
      workFolderSuggestions(q)
        .then((s) => {
          if (seq !== latest.current) return
          const listed: FolderItem[] = s.directories.filter((d) => !value.includes(d)).map((path) => ({ path, create: false }))
          if (s.create && !value.includes(s.create)) listed.push({ path: s.create, create: true })
          setItems(listed)
        })
        .catch(() => {
          if (seq === latest.current) setItems([])
        })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, value])

  const add = (path: string) => {
    const p = path.trim().replace(/(.)\/+$/, '$1')
    if (!p || value.includes(p)) return
    onChange([...value, p])
    setQuery('')
    setError(null)
  }

  const create = (path: string) => {
    setBusy(true)
    setError(null)
    createWorkFolder(path)
      .then(add)
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(false))
  }

  const selected = React.useMemo<FolderItem[]>(() => value.map((path) => ({ path, create: false })), [value])

  // Enter with nothing highlighted adds the typed path as is; the server judges it on Save.
  const onInputKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key !== 'Enter' || busy) return
    if (items.some((i) => i.path === query.trim())) return
    if (query.trim().startsWith('/')) {
      e.preventDefault()
      add(query)
    }
  }

  return (
    <div className='flex flex-col gap-1'>
      <Combobox.Root<FolderItem, true>
        items={items}
        multiple
        value={selected}
        inputValue={query}
        disabled={disabled || busy}
        onInputValueChange={(next: string) => setQuery(next)}
        isItemEqualToValue={(a, b) => a.path === b.path}
        itemToStringValue={(item) => item.path}
        filter={() => true}
        onValueChange={(next: FolderItem[]) => {
          const added = next.find((n) => !value.includes(n.path))
          if (added) {
            if (added.create) create(added.path)
            else add(added.path)
            return
          }
          onChange(next.map((n) => n.path))
        }}>
        <Combobox.Chips className={cn(groupCls, 'font-mono')}>
          <Combobox.Value>
            {(vals: FolderItem[]) => (
              <ChipList values={vals.map((v) => v.path)} placeholder='/home/team/projects' labelOf={(v) => v} onInputKeyDown={onInputKeyDown} />
            )}
          </Combobox.Value>
        </Combobox.Chips>
        <Combobox.Portal>
          <Combobox.Positioner className='isolate z-60 outline-none' sideOffset={6}>
            <Combobox.Popup className={popupCls}>
              <Combobox.Empty className='px-2 py-2 text-body-sm text-muted-foreground'>
                {query.trim().startsWith('/') ? 'No folder here that can be granted. Press Enter to add the path as typed.' : 'Type an absolute path on the Box host.'}
              </Combobox.Empty>
              <Combobox.List>
                {(item: FolderItem) => (
                  <Combobox.Item key={`${item.create ? 'new:' : ''}${item.path}`} value={item} className={itemCls}>
                    <Combobox.ItemIndicator className='col-start-1 text-accent'>
                      {item.create ? <FolderPlus className='size-3.5' /> : <Check className='size-3.5' />}
                    </Combobox.ItemIndicator>
                    {item.create && <FolderPlus className='col-start-1 size-3.5 text-muted-foreground' />}
                    <span className='col-start-2 truncate font-mono'>
                      {item.create ? (
                        <>
                          Create folder <span className='text-text'>{item.path}</span>
                        </>
                      ) : (
                        item.path
                      )}
                    </span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {error && <p className='text-label text-danger'>{error}</p>}
    </div>
  )
}
