import { useSignalReferences } from '../lib/useSignalReferences.ts'

/** "Used by": the objects that name a signal, one line each: what it is, its label (a link when it
 *  has a page) and how it uses the signal. Nothing renders when nothing uses it. */
export function SignalUsage({ signalId, className }: { signalId: string; className?: string }) {
  const { references } = useSignalReferences(signalId)
  if (!references || references.length === 0) return null
  return (
    <div className={className}>
      <p className='text-label text-muted-foreground'>Used by</p>
      <ul className='mt-1 flex flex-col gap-0.5 text-body-sm'>
        {references.map((r) => (
          <li key={`${r.kind}:${r.id}`} className='flex flex-wrap items-baseline gap-x-2'>
            <span className='text-label capitalize text-muted-foreground'>{r.kind}</span>
            {r.href ? (
              <a href={r.href} className='text-accent hover:underline'>
                {r.label}
              </a>
            ) : (
              <span>{r.label}</span>
            )}
            <span className='text-label text-muted-foreground'>{r.via}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
