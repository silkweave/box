// What the web client does when a policy change takes an area away from the signed-in principal:
// an open route of that area is left for the dashboard (the area's cached data is dropped by the
// stores' own refetch, lib/changeFeed.ts registerStoreReloads).

interface AreaRoutes {
  id: string
  nav?: readonly { to: string }[]
}

const under = (pathname: string, base: string): boolean => base !== '/' && (pathname === base || pathname.startsWith(`${base}/`))

/** The feature (area) whose routes `pathname` lies under: its nav entries' paths, else `/<id>`. */
export function areaOfPath(pathname: string, features: readonly AreaRoutes[]): string | null {
  for (const feature of features) {
    const bases = [`/${feature.id}`, ...(feature.nav ?? []).map((entry) => entry.to)]
    if (bases.some((base) => under(pathname, base))) return feature.id
  }
  return null
}

/** Navigate off the current route when it belongs to one of the `lost` areas. */
export async function leaveLostAreas(lost: readonly string[]): Promise<void> {
  if (lost.length === 0) return
  // Read lazily: the router and the feature list take part in the import cycle every view does.
  const [{ router }, { ALL_WEB_FEATURES }] = await Promise.all([import('../router.tsx'), import('../web-features.ts')])
  const area = areaOfPath(router.state.location.pathname, ALL_WEB_FEATURES)
  if (area && lost.includes(area)) await router.navigate({ to: '/', replace: true })
}
