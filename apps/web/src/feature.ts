// The web feature contract. Features live in features/<id>/web/.
// Register their entry modules in src/generated/features.ts, maintained alongside the source.
// See docs/core/SEAM.md for the runtime contracts and dependency direction.

import type { AnyRoute } from '@tanstack/react-router'
import type { ComponentType, ReactNode } from 'react'
import type { NavIcon } from '@silkweave/box-ui'
import type { DocSurface } from './lib/useDoc.ts'

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
   * its props (`content.piece.panel` renders `{ piece }`); contributors never edit the owner.
   */
  slots?: Readonly<Record<string, readonly ComponentType<any>[]>>
  /**
   * Markdown doc families this feature's controller owns, by kind (`initiative`, `sink`, `topic`).
   * `useDoc`/`DocEditor` are core's, the ROUTING is not: core named three features' tRPC
   * procedures until 2026-09-13. See lib/useDoc.ts.
   */
  docs?: Readonly<Record<string, DocSurface>>
}

/** `const` type parameter: keeps each feature's route tuple so `typeof router` knows its paths. */
export function defineWebFeature<const T extends WebFeature>(feature: T): T {
  return feature
}
