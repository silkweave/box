// Per-user swatch colors - a FIXED categorical palette (Material hues), assigned in order, never
// cycled/generated (dataviz rule: color follows the entity). Each swatch has a light-mode and a
// dark-mode accent, both validated with the dataviz palette validator against the app surfaces
// (#fafafa / #12121a): lightness band, chroma floor, adjacent-pair CVD separation, contrast.
// Identity is never color-alone - cards always pair the tint with the owner's avatar + name.
//
// THE HEXES LIVE IN CSS, and only there: ../styles/globals.css sets `--swatch` per `.swatch-<name>`
// per theme, and everything that needs a color reads `var(--swatch)`. This file owns what CSS
// cannot express - the NAMES, their order, and which one a given user gets.
//
// Until 2026-09-15 it also carried a `SWATCH_ACCENT` map of the same sixteen hexes, described as
// "single source for the CSS and the Settings picker dots". It was neither: the CSS had its own
// copy, the picker dots read `var(--swatch)` off the class, and nothing in the repo imported the
// map. Two files each documented the other as derived and neither was - a second copy whose only
// job was to drift. It was deleted rather than generated, because the fix for an unused duplicate
// is not a generator. **If JS ever needs the hex, read `--swatch` off the element** (which is also
// the only reading that follows the active theme) rather than restating the palette here.

export const SWATCHES = ['indigo', 'cyan', 'amber', 'pink', 'teal', 'purple', 'orange', 'green'] as const
export type Swatch = (typeof SWATCHES)[number]

const isSwatch = (v: string | null | undefined): v is Swatch => !!v && (SWATCHES as readonly string[]).includes(v)

/** Deterministic fallback for users without an explicit color - stable per id, never re-ranked. */
function fallbackSwatch(id: string): Swatch {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return SWATCHES[h % SWATCHES.length]!
}

/** The swatch for a user (explicit `color` if valid, else the deterministic fallback). */
export function userSwatch(user: { id: string; color: string | null } | null | undefined): Swatch | null {
  if (!user) return null
  return isSwatch(user.color) ? user.color : fallbackSwatch(user.id)
}

/** Class that scopes `--swatch` (see globals.css) - pair with `.swatch-card` for the tinted card. */
export const swatchClass = (s: Swatch): string => `swatch-${s}`
