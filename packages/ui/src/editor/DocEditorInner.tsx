import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { Check, ClipboardCopy, Clock, Code2, FileText, Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { SplitPaneToggle } from '../components/SplitPane.tsx'
import type { DocEditorProps, DocStatus } from './types.ts'

/**
 * Unified WYSIWYG markdown editor (TipTap). Storage stays markdown (see `DocHandle` in ./types.ts):
 * the file's
 * markdown is parsed into the editor on load and serialized back on every edit (debounced-autosave).
 * GFM tables + task lists round-trip via the Table/TaskList extensions + the Markdown extension.
 *
 * `variant='card'` is the standalone rounded panel; `variant='panel'` fills its container's height
 * with no outer border (the SplitPane handle is the left separator) and scrolls its content body.
 *
 * `placeholder` is drawn in an empty document. It earns its keep on the topic brief, which is the one
 * doc kind that routinely starts from nothing (an initiative's rationale doc arrives written by
 * /ingest-sink; a topic's brief is often a blank pane a human is meant to fill in).
 */
export function DocEditor({
  doc,
  docKey,
  variant = 'card',
  placeholder,
  compact = false,
}: DocEditorProps) {
  const { content, status, path, editorUri, update } = doc
  const [copied, setCopied] = useState(false)

  // Keep the latest save closure + active doc key in refs so the editor's onUpdate (bound once at
  // creation) always targets the current doc and never fires for a programmatic load.
  const key = docKey
  const keyRef = useRef(key)
  keyRef.current = key
  const updateRef = useRef(update)
  updateRef.current = update
  const loadedKey = useRef<string | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      Markdown.configure({ markedOptions: { gfm: true } }),
      // The CSS (globals.css) draws it only on the FIRST line of an `is-editor-empty` document, so the
      // hint is gone the moment there is anything in the doc rather than following you down the page.
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    editorProps: {
      attributes: {
        class: `markdown-body tiptap ${compact ? 'min-h-[9rem]' : 'min-h-[24rem]'} px-4 py-3 focus:outline-none`,
      },
    },
    onUpdate: ({ editor }) => {
      // Only persist edits for the doc we've actually loaded - skips the programmatic setContent and
      // the gap between a route change and the new doc's markdown arriving.
      if (loadedKey.current !== keyRef.current) return
      updateRef.current(editor.getMarkdown())
    },
  })

  // Load the fetched markdown into the editor once per doc (parse markdown → rich content). emitUpdate
  // is false so this load never triggers a save.
  useEffect(() => {
    // `editor.isDestroyed`: guards the TipTap v3 mount race where the eagerly-created editor is torn
    // down by its 1ms scheduleDestroy before this seed effect runs (see SinkBodyEditor for the full
    // note). Skipping lets TipTap recreate a fresh instance and this effect re-seeds it.
    if (!editor || editor.isDestroyed || content == null || loadedKey.current === key) return
    editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false })
    loadedKey.current = key
  }, [editor, content, key])

  const copyMarkdown = () => {
    if (!editor) return
    navigator.clipboard.writeText(editor.getMarkdown()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const panel = variant === 'panel'

  return (
    <div
      className={cn(
        'flex flex-col',
        panel
          ? 'h-full min-h-0 bg-bg'
          : 'overflow-hidden rounded-lg border border-border bg-surface shadow-(--shadow-sm)',
      )}>
      <header className='flex shrink-0 items-center gap-2 border-b border-border px-3 py-2'>
        <SplitPaneToggle className='-ml-1' />
        <FileText className='size-3.5 shrink-0 text-muted-foreground' />
        <code className='line-clamp-1 text-label text-muted-foreground'>{path || 'doc'}</code>
        <SaveBadge status={status} />
        <div className='ml-auto flex shrink-0 items-center gap-1'>
          <a
            href={editorUri || undefined}
            aria-disabled={!editorUri}
            title='Open in VS Code'
            className={cn(
              'inline-flex items-center gap-1 rounded-md bg-bg px-2 py-1 text-label transition-colors',
              'text-muted-foreground hover:text-text aria-disabled:pointer-events-none aria-disabled:opacity-50',
            )}>
            <Code2 className='size-3' />
            <span className='hidden sm:inline'>Open</span>
          </a>
          <button
            type='button'
            onClick={copyMarkdown}
            disabled={content == null}
            title='Copy as markdown'
            className={cn(
              'inline-flex items-center gap-1 rounded-md bg-bg px-2 py-1 text-label transition-colors',
              'text-muted-foreground hover:text-text disabled:opacity-50',
            )}>
            {copied ? <Check className='size-3 text-accent' /> : <ClipboardCopy className='size-3' />}
            <span className='hidden sm:inline'>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </header>

      {content == null ? (
        <div className='min-h-[24rem] px-4 py-10 text-center text-body-sm text-muted-foreground'>Loading…</div>
      ) : (
        <EditorContent editor={editor} className={cn('bg-bg', panel && 'min-h-0 flex-1 overflow-y-auto')} />
      )}
    </div>
  )
}

function SaveBadge({ status }: { status: DocStatus }) {
  const map: Record<DocStatus, { cls: string; icon: React.ReactNode }> = {
    loading: { cls: 'text-muted-foreground', icon: <Loader2 className='size-3 animate-spin' /> },
    saved: { cls: 'text-muted-foreground', icon: <Check className='size-3' /> },
    dirty: { cls: 'text-muted-foreground', icon: <Clock className='size-3' /> },
    saving: { cls: 'text-accent', icon: <Loader2 className='size-3 animate-spin' /> },
    error: { cls: 'text-danger', icon: <TriangleAlert className='size-3' /> },
  }
  const m = map[status]
  return <span className={cn('inline-flex items-center gap-1 text-label', m.cls)}>{m.icon}</span>
}
