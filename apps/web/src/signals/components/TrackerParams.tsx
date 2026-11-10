import { DateInput, SelectField, UserPicker } from '@silkweave/box-ui'
import type { TrackerInfo } from '../lib/useTrackers.ts'

const inputCls =
  'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body-sm text-text transition-colors hover:border-accent/40 focus:border-accent focus:outline-none'

/** A Box tracker's parameter fields, one per param (`hide` leaves some out, e.g. a goal's own
 *  `since`). Renders nothing when there is nothing to ask. */
export function TrackerParams({
  tracker,
  value,
  onChange,
  hide = [],
}: {
  tracker: TrackerInfo
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
  hide?: string[]
}) {
  const params = tracker.params.filter((p) => !hide.includes(p.key))
  if (params.length === 0) return null
  const put = (key: string, val: string): void => onChange({ ...value, [key]: val })
  return (
    <div className='grid grid-cols-2 gap-3 rounded-md border border-border-light p-3'>
      {params.map((p) => (
        <label key={p.key} className='flex flex-col gap-1' title={p.description ?? undefined}>
          <span className='text-label text-muted-foreground'>{`${p.label}${p.required ? '' : ' (optional)'}`}</span>
          {p.kind === 'enum' ? (
            <SelectField
              value={value[p.key] ?? ''}
              onValueChange={(val) => put(p.key, val)}
              options={[{ value: '', label: p.required ? 'Pick one…' : 'Any' }, ...p.options.map((o) => ({ value: o.value, label: o.label }))]}
            />
          ) : p.kind === 'date' ? (
            <DateInput value={value[p.key] ?? ''} onChange={(val) => put(p.key, val)} ariaLabel={p.label} noToday />
          ) : p.kind === 'user' ? (
            <UserPicker value={value[p.key] || null} onChange={(u) => put(p.key, u ?? '')} className='w-full' />
          ) : (
            <input value={value[p.key] ?? ''} onChange={(e) => put(p.key, e.target.value)} className={inputCls} />
          )}
        </label>
      ))}
    </div>
  )
}
