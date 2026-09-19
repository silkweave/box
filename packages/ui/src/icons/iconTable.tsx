import type { ComponentType } from 'react'
import { Activity } from 'lucide-react'
import {
  IconBrandGithub,
  IconBrandLinkedin,
  IconBrandNpm,
  IconBrandReddit,
  IconBrandX,
  IconBrandYcombinator,
} from '@tabler/icons-react'

/*
 * A string-keyed glyph lookup with a fallback, plus the brand marks every Box can be assumed to
 * need.
 *
 * This was `channelIcons.tsx` until 2026-09-14, and the mechanism was always right - what was wrong
 * was WHO OWNED THE TABLE. It shipped one company's private channel ids next to the public brand
 * marks, i.e. that company's vocabulary hard-coded into a design system, alongside a
 * `'name@account'` splitting rule that is an id convention of one particular app.
 *
 * So ownership is inverted: the library supplies the machinery and the genuinely universal brand
 * marks; a Box calls `createIconTable` with its own keys, its own extras and its own key
 * normalisation. `apps/web/src/lib/channelIcons.tsx` is what that looks like.
 */

/** Lowest common denominator of a lucide icon and a tabler icon - call sites pass className only. */
export type IconComponent = ComponentType<{ className?: string }>

/**
 * The Substack wordmark glyph, the one brand neither icon set draws. Path data is the official
 * mark's, verbatim; it is inlined rather than imported because there is no svgr in this build and a
 * checked-in copy of an asset whose only consumer is this file would just be somewhere to drift.
 *
 * Two deliberate departures from the source file, both so it sits in the row rather than shouting
 * over it:
 *
 * • **Monochrome.** The brand orange (`#ff6719`) is dropped for `currentColor`, like every other
 *   glyph here - these render inside buttons, badges and table cells that set their own colour, and
 *   one hard-coded hue would ignore the theme and the disabled/muted states with it.
 * • **Optically sized.** The artwork is full-bleed 21x24; lucide and tabler draw inside a ~20-unit
 *   content box within their 24x24 grid. Dropped in at full height a SOLID mark reads noticeably
 *   heavier than its stroke-2 neighbours, so it is scaled to that same 20-unit box and centred.
 *   The transform is the whole adjustment - the path data is the source file's, untouched.
 */
export function IconBrandSubstack({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" className={className}>
      <g transform="translate(3.25 2) scale(0.833333)">
        <path d="M20.9991 5.40625H0V8.24275H20.9991V5.40625Z" />
        <path d="M0 10.8125V24.0004L10.4991 18.1107L21 24.0004V10.8125H0Z" />
        <path d="M20.9991 0H0V2.83603H20.9991V0Z" />
      </g>
    </svg>
  )
}

/**
 * Brands a Box can be assumed to know. Brand glyphs come from @tabler/icons-react - the one icon
 * set that draws these on the same 24px / stroke-2 grid as lucide, so brand and UI icons read as
 * one family.
 *
 * The bar for this table is "a reader would recognise the mark without a label". Anything that is a
 * name only THIS product uses belongs in the app's own extras.
 */
export const BRAND_ICONS: Record<string, IconComponent> = {
  github: IconBrandGithub,
  hackernews: IconBrandYcombinator,
  linkedin: IconBrandLinkedin,
  npm: IconBrandNpm,
  reddit: IconBrandReddit,
  substack: IconBrandSubstack, // neither icon set draws it - see the component above
  x: IconBrandX,
}

export interface IconTable {
  /** The glyph for a key, or the fallback. Never null - an unknown key still draws. */
  iconFor: (key: string) => IconComponent
  /** Inline glyph, for badges and chips where only the icon is wanted. */
  Glyph: (props: { name: string; className?: string }) => React.ReactElement
}

/**
 * Build a lookup from a key to a glyph.
 *
 * `keyOf` is how a Box normalises its own identifiers before the lookup - our app's channels carry
 * an account variant (`github@dan`), which is its convention to strip, not ours.
 */
export function createIconTable(
  icons: Record<string, IconComponent>,
  { fallback = Activity, keyOf = (k: string) => k }: { fallback?: IconComponent; keyOf?: (key: string) => string } = {},
): IconTable {
  const iconFor = (key: string): IconComponent => icons[keyOf(key)] ?? fallback
  return {
    iconFor,
    Glyph: ({ name, className }) => {
      const Icon = iconFor(name)
      return <Icon className={className ?? 'size-3.5 shrink-0'} />
    },
  }
}

/** The brand marks alone, for a Box that needs no extras of its own. */
export const brandIcons = createIconTable(BRAND_ICONS)
