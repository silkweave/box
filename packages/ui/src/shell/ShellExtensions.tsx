import { createContext, useContext, type ComponentType, type MouseEventHandler, type ReactNode } from 'react'

/** What the shell hands the link that wraps the wordmark - the anchor's own props, nothing more. */
export interface HomeLinkProps {
  className?: string
  'aria-label': string
  onClick?: MouseEventHandler
  children: ReactNode
}

/**
 * The default link home: a plain anchor to the origin root. Right for a page with no client-side
 * router, and what Storybook renders.
 */
export function PlainHomeLink({ children, ...rest }: HomeLinkProps) {
  return (
    <a href='/' {...rest}>
      {children}
    </a>
  )
}

/**
 * What an app hangs on the shell.
 *
 * The shell owns the frame - sidebar, drawer, top bar, the inset canvas - and has no opinion about
 * what a Box contains. The things that ARE app-specific (who is signed in, what the features
 * contribute to the top bar, whether an agent panel rides beside <main>, how the wordmark links
 * home) come in through here, set once at the app's root. The dependent registers into the
 * dependency, never the reverse.
 *
 * A context rather than a module-level registration list: these are React nodes and a flag, so the
 * runtime should do the bookkeeping (one value, replaced on HMR rather than accumulated), and a
 * story can override them per story. The default is `{}`, which is what lets <AppShell> render in
 * Storybook with no setup at all.
 */
export interface ShellExtensions {
  /** App-owned settings control, rendered in the sidebar footer. */
  settingsControl?: ComponentType

  /** The top bar's right cluster, after the view's own actions: feature bells, a user menu, an agent toggle. */
  trailing?: ReactNode
  /** Rendered beside the shell's main frame (for example, an app utility panel). */
  aside?: ReactNode
  /** Whether the aside is claiming space beside the whole shell. Keeps layout state app-owned. */
  asideOpen?: boolean
  /** <main> goes inert: the aside has claimed the canvas. */
  mainInert?: boolean
  /**
   * What wraps the wordmark as the link home. Defaults to `PlainHomeLink` (`<a href='/'>`). An
   * app on a client-side router supplies its own - apps/web hands in TanStack's `<Link to='/'>` -
   * because under browser history (2026-09-14) a bare anchor to the origin is a full document
   * reload, which drops every live feed the app holds. A component rather than an href + onClick
   * pair so the router's own link (modifier keys, middle click, prefetch) does the work; it renders
   * inside the shell, where the router context is in scope even though this provider sits above it.
   */
  homeLink?: ComponentType<HomeLinkProps>
  /**
   * localStorage namespace for the shell's own preferences (sidebar collapsed, group expanded,
   * theme). Defaults to `DEFAULT_STORAGE_PREFIX` (`ui`).
   *
   * Set it once at the app root so the persistent shell shares the application's preference
   * namespace. The explicit AppShell prop still wins where it is passed, which lets a story
   * override the namespace without changing app-wide extensions.
   */
  storagePrefix?: string
}

const ShellExtensionsContext = createContext<ShellExtensions>({})

export function ShellExtensionsProvider({ value, children }: { value: ShellExtensions; children: ReactNode }) {
  return <ShellExtensionsContext.Provider value={value}>{children}</ShellExtensionsContext.Provider>
}

export function useShellExtensions(): ShellExtensions {
  return useContext(ShellExtensionsContext)
}
