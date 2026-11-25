import type { ReactNode } from 'react'
import { Disclosure } from '@silkweave/box-ui'

/**
 * A structured message pinned above the Builder conversation: what is about to happen (a brief) or
 * what has happened (the agent's ready-to-wrap-up report). A title and a line of context, named
 * lists, numbered steps, an optional fold with the raw text, and the acts.
 *
 * Builder-only: it lives with the Builder shell, which ships with core and is not a page of the app.
 */
export function BuilderCard({ icon, eyebrow, title, summary, groups, steps, stepsLabel, raw, rawLabel, actions, tone = 'accent' }: {
  icon: ReactNode
  /** A short label above the title: "Brief", "Ready to wrap up". */
  eyebrow: string
  title: string
  summary?: string | undefined
  groups?: { label: string; items: string[] }[] | undefined
  steps?: string[] | undefined
  stepsLabel?: string
  /** The full text behind the card (the prompt sent, the commit message), folded away. */
  raw?: string | undefined
  rawLabel?: string
  actions: ReactNode
  tone?: 'accent' | 'success'
}) {
  const frame = tone === 'success' ? 'border-success/30 bg-success-bg' : 'border-accent/30 bg-accent-tint'
  const mark = tone === 'success' ? 'text-success' : 'text-accent'
  return (
    <section aria-label={`${eyebrow}: ${title}`} className={`mx-2 mb-2 flex shrink-0 flex-col rounded-lg border ${frame}`}>
      <div className='p-3'>
        <p className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider ${mark}`}>{icon}{eyebrow}</p>
        <h2 className='mt-1 text-body-sm font-semibold text-text'>{title}</h2>
        {summary && <p className='mt-1 text-label leading-relaxed text-fg-2'>{summary}</p>}
        {groups?.map(group => (
          <div key={group.label} className='mt-2.5'>
            <p className='text-label font-medium text-fg-3'>{group.label}</p>
            <ul className='mt-1 flex flex-wrap gap-1'>
              {group.items.map(item => <li key={item} className='rounded-md border border-border bg-bg px-1.5 py-0.5 text-label text-fg-2'>{item}</li>)}
            </ul>
          </div>
        ))}
        {steps && steps.length > 0 && (
          <div className='mt-2.5'>
            <p className='text-label font-medium text-fg-3'>{stepsLabel ?? 'Steps'}</p>
            <ol className='mt-1 space-y-0.5'>
              {steps.map((step, index) => (
                <li key={step} className='flex gap-2 text-label leading-relaxed text-fg-2'>
                  <span className={`w-4 shrink-0 text-right tabular-nums ${mark}`}>{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {raw && (
          <Disclosure title={rawLabel ?? 'Full text'} className='mt-2.5'>
            <p className='whitespace-pre-wrap rounded-md border border-border bg-bg p-2 font-mono text-label leading-relaxed text-fg-3'>{raw}</p>
          </Disclosure>
        )}
      </div>
      <div className='flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-t border-border/60 px-3 py-2'>{actions}</div>
    </section>
  )
}
