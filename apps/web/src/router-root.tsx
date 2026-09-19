import { createRootRoute, Outlet } from '@tanstack/react-router'

/** The one root every feature's routes hang from. Its own file so features can import it without
 *  importing router.tsx (which imports the features - that would be a cycle at module load). */
export const rootRoute = createRootRoute({ component: Outlet })
