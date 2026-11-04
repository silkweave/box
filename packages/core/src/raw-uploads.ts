// The raw-upload port. The server refuses a request body over 100 kB before routing unless it
// carries a credential (apps/server/src/main.ts). A feature whose route is authorised by a
// capability in its own path (a one-time upload link) registers that path here; such a request is
// let through to the route, which must stream the body and enforce its own size cap. Artifacts is the
// first user: `PUT /api/artifacts/upload/<secret>`.

export interface RawUploadRoute {
  /** Stable id (the feature's). */
  id: string
  method: 'PUT' | 'POST'
  /** Full request path prefix, under /api/, with a trailing slash: `/api/artifacts/upload/`. */
  prefix: string
}

const routes = new Map<string, RawUploadRoute>()

/** Register a route that limits its own body. Returns the unregister. */
export function registerRawUploadRoute(route: RawUploadRoute): () => void {
  if (!/^\/api\/[a-z0-9][a-z0-9/-]*\/$/.test(route.prefix)) throw new Error(`raw upload route "${route.id}": prefix must look like /api/name/`)
  if (routes.has(route.id)) throw new Error(`raw upload route "${route.id}" registered twice`)
  routes.set(route.id, route)
  return () => {
    if (routes.get(route.id) === route) routes.delete(route.id)
  }
}

/** Whether `method path` (query already stripped) is a registered self-limiting upload. */
export function isRawUploadRoute(method: string | undefined, path: string): boolean {
  for (const route of routes.values()) if (route.method === method && path.startsWith(route.prefix) && path.length > route.prefix.length) return true
  return false
}
