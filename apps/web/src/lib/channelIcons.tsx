import { Briefcase, Rss } from 'lucide-react'
import { IconNews } from '@tabler/icons-react'
import { BRAND_ICONS, createIconTable, type IconComponent } from '@silkweave/box-ui'

/**
 * THIS Box's channel vocabulary, drawn.
 *
 * The library owns the mechanism and the universal brand marks; the rows below are ours and only
 * ours - `business` is our own category, `linkedin-article` is our id for a channel LinkedIn does
 * not name, and the `github@dan` account-variant convention is our id format. None of that belongs
 * in a design system, which is why it moved here on 2026-09-14. Add this Box's own channels here.
 *
 * Non-brand channels stay on lucide; brand glyphs come from the library's tabler-based table.
 */
const CHANNEL_EXTRAS: Record<string, IconComponent> = {
  blog: Rss,
  business: Briefcase,
  'linkedin-article': IconNews,
}

/** 'github@dan' -> 'github'; plain channels pass through. */
const baseChannel = (c: string): string => c.split('@')[0] ?? c

/** Every channel this Box draws. Exported for the views that enumerate them (a channel picker). */
export const CHANNEL_ICON: Record<string, IconComponent> = { ...BRAND_ICONS, ...CHANNEL_EXTRAS }

const table = createIconTable(CHANNEL_ICON, { keyOf: baseChannel })

/** Icon for any channel string, account-variant aware ('github@dan' → github). */
export const channelIcon = table.iconFor

/** Inline channel glyph, for badges/chips where only the icon is wanted. */
export function ChannelGlyph({ channel, className }: { channel: string; className?: string }) {
  return <table.Glyph name={channel} className={className} />
}

export type { IconComponent as ChannelIconComponent }
