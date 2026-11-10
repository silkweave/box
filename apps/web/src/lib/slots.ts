import type { ComponentType } from 'react'
import { readableWebFeatures } from '../web-features.ts'
import { accessKey } from './access.ts'

/** Every component the present features contribute to one slot, in feature order. The owner of a
 *  slot types the props it renders with; contributors must match. Only features whose area the
 *  principal reads contribute (lib/access.ts). Computed at first use (the registry sits on an
 *  import cycle with every view) and rebuilt when access changes. */
const cache = new Map<string, ComponentType<never>[]>()
let cacheKey = ''
export function slotComponents<P>(name: string): ComponentType<P>[] {
  if (cacheKey !== accessKey()) {
    cache.clear()
    cacheKey = accessKey()
  }
  let list = cache.get(name)
  if (!list) {
    list = readableWebFeatures().flatMap((f) => [...(f.slots?.[name] ?? [])] as ComponentType<never>[])
    cache.set(name, list)
  }
  return list as ComponentType<P>[]
}
