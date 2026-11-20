import { DateInput, Field, FieldGrid, Input, SelectField, UserPicker } from '@silkweave/box-ui'
import type { TrackerInfo } from '../lib/useTrackers.ts'

/** A Box tracker's parameter fields, one `Field` per param (`hide` leaves some out, e.g. a goal's
 *  own `since`). The param's description is the field's hint. Renders nothing when there is
 *  nothing to ask. */
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
    <FieldGrid columns={2}>
      {params.map((p) => (
        <Field key={p.key} label={p.label} hint={p.description ?? undefined}>
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
            <Input value={value[p.key] ?? ''} onChange={(e) => put(p.key, e.target.value)} />
          )}
        </Field>
      ))}
    </FieldGrid>
  )
}
