// The web feature contract. Features live in features/<id>/web/.
// Register their entry modules in src/generated/features.ts, maintained alongside the source.
// See docs/core/SEAM.md for the runtime contracts and dependency direction.

import type { AnyRoute } from '@tanstack/react-router'
import type { ComponentType, ReactNode } from 'react'
import type { NavIcon } from '@silkweave/box-ui'
import type { DocSurface } from './lib/useDoc.ts'

/**
 * A sidebar section heading, declared by the nav entries that belong to it. Sections are keyed by
 * `id`; every entry that names the same id joins one section. Rules (lib/navSections.ts):
 * - the label and order of a section come from its first entry in nav order (entry `order`, then
 *   entry `id`); a later entry that declares the same id differently joins it as declared first,
 *   so the outcome never depends on registration order;
 * - sections sort by `order`, ties broken by `id`;
 * - entries inside a section sort by entry `order`, then `id`;
 * - entries without a section appear last, under "Other".
 * The label is also the key of a person's stored sidebar arrangement, so keep it stable.
 */
export interface NavSection {
  id: string
  label: string
  order: number
}

/**
 * Core's one section: Dashboard opens it, and features join it by naming it on their entries. It
 * lives here, not in lib/nav.ts, because feature entry modules may import this file at evaluation.
 */
export const WORKSPACE_SECTION: NavSection = { id: 'workspace', label: 'Workspace', order: 100 }

/** One top-level sidebar group. */
export interface NavEntry {
  id: string
  label: string
  icon: NavIcon
  /** False for a destination with no sub-navigation. */
  expandable?: boolean
  /** Absolute path of the group's index route. */
  to: string
  /**
   * Optional one-line description of what the app does, in the feature's vocabulary.
   */
  description?: string
  /** Sort key. Bands by feature (§ 5.2 of the seam); ties break on `id`. */
  order: number
  /** The sidebar section this entry belongs to; without one it appears under "Other". */
  section?: NavSection
}

/** One section of the Settings view. */
export interface SettingsSection {
  id: string
  label: string
  icon: NavIcon
  /** False for a destination with no sub-navigation. */
  expandable?: boolean
  order: number
  render: (params: string[]) => ReactNode
}

export interface WebFeature {
  id: string
  /** Direct children of `rootRoute` (import it from `@/router-root.tsx`). */
  routes: readonly AnyRoute[]
  nav?: readonly NavEntry[]
  settings?: readonly SettingsSection[]
  shell?: {
    /** Rendered in the top bar's right cluster, ascending `order`, left of the user menu. */
    topbar?: readonly { order: number; component: ComponentType }[]
  }
  /** Runs once a session exists (the App.tsx auth gate). Return the teardown. */
  onSession?: () => void | (() => void)
  /**
   * Components this feature contributes INTO another feature's surface, by slot name - the web
   * form of "the dependent registers into the dependency". The owning feature names the slot and
   * its props (`support.ticket.panel` renders `{ ticket }`); contributors never edit the owner.
   */
  slots?: Readonly<Record<string, readonly ComponentType<any>[]>>
  /**
   * Markdown doc families this feature's controller owns, by kind (`initiative`, `sink`).
   * `useDoc`/`DocEditor` are core's, the ROUTING is not: core named three features' tRPC
   * procedures until 2026-09-13. See lib/useDoc.ts.
   */
  docs?: Readonly<Record<string, DocSurface>>
}

/** `const` type parameter: keeps each feature's route tuple so `typeof router` knows its paths. */
export function defineWebFeature<const T extends WebFeature>(feature: T): T {
  return feature
}
