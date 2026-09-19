import { lazy, Suspense } from 'react'
import { cn } from '../lib/utils.ts'
import type { DocEditorProps } from './types.ts'

// The lazy boundary IS the public DocEditor: TipTap is ~600 kB and must ship in its own chunk,
// loaded only by the pages that open an editor. This is the only editor module the barrel exports;
// a static re-export of DocEditorInner would pull TipTap back into the main graph.
const DocEditorInner = lazy(() => import('./DocEditorInner.tsx').then((m) => ({ default: m.DocEditor })))

export function DocEditor({ doc, docKey, variant, placeholder, compact }: DocEditorProps) {
  return (
    <Suspense
      fallback={
        <div
          className={cn(
            'grid flex-1 place-items-center bg-bg px-4 py-10 text-center text-body-sm text-muted-foreground',
            compact ? 'min-h-[9rem]' : 'min-h-[24rem]',
          )}>
          Loading editor…
        </div>
      }>
      <DocEditorInner doc={doc} docKey={docKey} variant={variant} placeholder={placeholder} compact={compact} />
    </Suspense>
  )
}
