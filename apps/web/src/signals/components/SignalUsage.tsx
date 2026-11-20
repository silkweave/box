import { Badge } from '@silkweave/box-ui'
import { useSignalReferences } from '../lib/useSignalReferences.ts'

/** "Used by": the objects that name a signal, one line each: what it is, its label (a link when it
 *  has a page) and how it uses the signal. Nothing renders when nothing uses it. */
export function SignalUsage({ signalId, className }: { signalId: string; className?: string }) {
  const { references } = useSignalReferences(signalId)
  if (!references || references.length === 0) return null
  return (
    <div className={className}>
      <p className='text-label text-muted-foreground'>Used by</p>
      <ul aria-label='Used by' className='mt-1 flex flex-col gap-1 text-body-sm'>
        {references.map((r) => (
          <li key={`${r.kind}:${r.id}`} className='flex flex-wrap items-baseline gap-x-2'>
            <Badge size='sm' className='capitalize'>
              {r.kind}
            </Badge>
            {r.href ? (
              <a href={r.href} className='text-accent hover:underline'>
                {r.label}
              </a>
            ) : (
              <span className='text-text'>{r.label}</span>
            )}
            <span className='text-label text-fg-4'>{r.via}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
