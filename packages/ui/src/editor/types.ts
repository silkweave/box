/**
 * The document seam.
 *
 * Loading and saving a document is an app's business - apps/web routes it over tRPC to three
 * different controllers by `kind` - so none of that may cross into the library. What the editor
 * actually needs is these five fields and a way to tell one document from the next; the app hands
 * them in and owns the transport, exactly as a controlled <input> takes `value` and `onChange`.
 */
export type DocStatus = 'loading' | 'saved' | 'dirty' | 'saving' | 'error'

export interface DocHandle {
  /** null while loading. */
  content: string | null
  status: DocStatus
  /** Shown in the header; '' until known. */
  path: string
  /** Deep link for the Open button; '' disables it. */
  editorUri: string
  /** Called on every keystroke. Debouncing and persistence are the app's business, not the editor's. */
  update: (markdown: string) => void
}

export interface DocEditorProps {
  doc: DocHandle
  /**
   * Identity of the document. A change re-seeds the editor and gates autosave, so it must change
   * whenever `doc` starts pointing at a different document (apps/web passes `${kind}/${id}`).
   */
  docKey: string
  variant?: 'card' | 'panel'
  placeholder?: string
  /** A shorter writing area, for a surface that is not the whole page (a modal). */
  compact?: boolean
}
