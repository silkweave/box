import { DocEditor as Editor, type DocEditorProps } from '@silkweave/box-ui/editor'
import { useDoc, type DocKind } from '../lib/useDoc.ts'

/**
 * This app's half of the document seam: `useDoc`'s tRPC routing (three controllers, selected by
 * `kind`) on top of the library's controlled editor. The library knows nothing about a `DocKind`.
 */
export function DocEditor({
  kind,
  id,
  ...rest
}: { kind: DocKind; id: string } & Omit<DocEditorProps, 'doc' | 'docKey'>) {
  const doc = useDoc(kind, id)
  return <Editor doc={doc} docKey={`${kind}/${id}`} {...rest} />
}
