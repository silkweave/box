import type { ReactNode } from 'react'
import { Badge, type BadgeProps } from '../components/Badge.tsx'
import { cn } from '../lib/utils.ts'

export interface NameCellBadge {
  label: ReactNode
  variant?: BadgeProps['variant']
}

/**
 * The name cell of a list row: the record's name, an optional second line, a leading mark and a
 * compact badge, on fixed line boxes so sibling rows line up at any data.
 *
 * Use it for: `DataGrid`'s `name.render` wherever a row names a record (a user with their email, a
 * server with its address, a channel with its kind). The same anatomy on every list, app and
 * Settings alike.
 * Not for: domain content that is not a name and a note (a sparkline, an editor; keep a custom
 * renderer), a value column (columns render their own values).
 * Props: `primary` is the name (plain text: it truncates); `secondary` is one quiet line (an email,
 * an address, "Invited"); `mark` sits before both, 24px (an `Avatar size='sm'`, a letter tile, a
 * kind glyph); `badge` is one compact state right after the name ("You", "Invited"), drawn as an
 * `xs` badge so the line stays 20px.
 * Rules: the primary line is 20px and the secondary 16px; a row is 48px either way. Do not pass
 * classes to restyle it: one state per row, more states belong in a column. A row's icon column
 * (`DataGrid` `icon`, 10 to 14px) is not the mark: use one or the other.
 */
export function NameCell({ primary, secondary, mark, badge, mono = false, title }: {
  primary: ReactNode
  secondary?: ReactNode
  mark?: ReactNode
  badge?: NameCellBadge | null
  /** The name is an identifier (a slug, a key): monospace. */
  mono?: boolean
  /** The full text on hover when the name is not plain text. Defaults to `primary` when it is. */
  title?: string
}) {
  const hover = title ?? (typeof primary === 'string' ? primary : undefined)
  return (
    <span className='flex min-w-0 items-center gap-2.5'>
      {mark != null && <span className='flex size-6 shrink-0 items-center justify-center'>{mark}</span>}
      <span className='flex min-w-0 flex-col'>
        <span className='flex h-5 min-w-0 items-center gap-1.5'>
          <span title={hover} className={cn('truncate text-body-sm leading-5 font-medium text-text', mono && 'font-mono')}>{primary}</span>
          {badge && <Badge size='xs' variant={badge.variant ?? 'neutral'} className='shrink-0'>{badge.label}</Badge>}
        </span>
        {secondary != null && secondary !== '' && <span className='h-4 truncate text-label leading-4 text-muted-foreground'>{secondary}</span>}
      </span>
    </span>
  )
}
