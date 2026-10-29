import { useCallback, useEffect, useRef, useState } from 'react'
import { ALL_WEB_FEATURES } from '../web-features.ts'
// One definition, and it lives with the editor that reads it. What this hook returns is structurally
// the library's `DocHandle`, which is the whole contract between them.
import type { DocStatus } from '@silkweave/box-ui/editor'

export type { DocStatus }

/** A markdown doc as its owning controller returns it. */
export interface DocPayload {
  content: string
  path: string
  editorUri: string
}

/**
 * One addressable family of markdown docs, provided by the feature that owns the controller behind
 * it (`docs` on the web feature manifest). `kind` is the family name; `id` is whatever that family
 * addresses a doc by - an initiative slug, a task id, a filename.
 */
export interface DocSurface {
  read: (id: string) => Promise<DocPayload>
  save: (id: string, content: string) => Promise<DocPayload>
}

/**
 * A doc `kind` is a FEATURE's, never core's.
 *
 * This hook named `trpc.planningDoc`, `trpc.sinkDoc` and `trpc.contentDoc` directly until
 * 2026-09-13, which made a core web module depend on three features and broke the web typecheck on
 * a Box with none of them. Each of them now registers its own surface, exactly like `slots`.
 */
export type DocKind = string

/** Resolved at first use, not at module scope: the registry sits on an import cycle with every
 *  view (AGENTS.md, SEAM § 5.4). */
const cache = new Map<string, DocSurface | null>()
function docSurface(kind: string): DocSurface | null {
  let found = cache.get(kind)
  if (found === undefined) {
    found = ALL_WEB_FEATURES.reduce<DocSurface | null>((hit, f) => hit ?? f.docs?.[kind] ?? null, null)
    cache.set(kind, found)
  }
  return found
}

/** Read a doc once, outside an editor (a copy or open action). Rejects when no feature provides `kind`. */
export function readDoc(kind: DocKind, id: string): Promise<DocPayload> {
  const surface = docSurface(kind)
  return surface ? surface.read(id) : Promise.reject(new Error(`No feature provides doc kind "${kind}"`))
}

const AUTOSAVE_MS = 1000

/**
 * Load a markdown doc over tRPC and **debounced-autosave** edits back (~1s after the last
 * keystroke). `content` is null while loading. The save closure captures the kind/id at edit time,
 * so a pending write still targets the right doc if the route changes. A `kind` no present feature
 * provides resolves to `error` - the same verdict as a failed read, because to a reader it is the
 * same thing: the doc is not there.
 *
 * A CRM account doc is NOT a surface here: its panel edits two regions around static headings
 * rather than one document, so it has its own hook (see useCrmDoc).
 */
export function useDoc(
  kind: DocKind,
  id: string,
): {
  content: string | null
  status: DocStatus
  path: string
  editorUri: string
  update: (next: string) => void
} {
  const [content, setContent] = useState<string | null>(null)
  const [status, setStatus] = useState<DocStatus>('loading')
  const [path, setPath] = useState('')
  const [editorUri, setEditorUri] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    setContent(null)
    setStatus('loading')
    const surface = docSurface(kind)
    if (!surface) {
      console.error(`[useDoc] no feature provides doc kind "${kind}"`)
      setStatus('error')
      return
    }
    surface
      .read(id)
      .then((d) => {
        if (!alive) return
        setContent(d.content)
        setPath(d.path)
        setEditorUri(d.editorUri)
        setStatus('saved')
      })
      .catch(() => alive && setStatus('error'))
    return () => {
      alive = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [kind, id])

  const update = useCallback(
    (next: string) => {
      setContent(next)
      setStatus('dirty')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const surface = docSurface(kind)
        if (!surface) return setStatus('error')
        setStatus('saving')
        surface
          .save(id, next)
          .then((d) => {
            setPath(d.path)
            setEditorUri(d.editorUri)
            setStatus((s) => (s === 'saving' ? 'saved' : s)) // a newer edit may have re-dirtied
          })
          .catch(() => setStatus('error'))
      }, AUTOSAVE_MS)
    },
    [kind, id],
  )

  return { content, status, path, editorUri, update }
}
