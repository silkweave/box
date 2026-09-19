import type { ComponentType } from 'react'
import { WEB_FEATURE_LIST } from '../generated/features.ts'

/** Every component the present features contribute to one slot, in feature order. The owner of a
 *  slot types the props it renders with; contributors must match. Computed at first use (the
 *  registry sits on an import cycle with every view). */
const cache = new Map<string, ComponentType<never>[]>()
export function slotComponents<P>(name: string): ComponentType<P>[] {
  let list = cache.get(name)
  if (!list) {
    list = WEB_FEATURE_LIST.flatMap((f) => [...(f.slots?.[name] ?? [])] as ComponentType<never>[])
    cache.set(name, list)
  }
  return list as ComponentType<P>[]
}
