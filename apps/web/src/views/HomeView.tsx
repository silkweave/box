import { Link } from '@tanstack/react-router'
import { AppShell, PageContainer, PageHeader } from '@silkweave/box-ui'
import { appEntries, useGroupNav } from '../lib/nav.ts'

/**
 * The app dashboard at `/` - one card per app this Box has, from the present features' `nav`.
 *
 * It replaced a `/` that redirected into whichever feature sorted first (2026-09-15). That made
 * every sign-in land inside ONE team's tool - a Box that kept `data` greeted everybody with an
 * empty Signals chart about downloads and stars - and it made "what does this Box even do?"
 * a question you answered by reading the sidebar. The dashboard answers it.
 *
 * `appEntries()` reads the generated registry, which sits on an import cycle with every view
 * (`view -> nav.ts -> generated/features -> feature index -> view`). It is called INSIDE the
 * component for that reason. A module-scope read here throws `Cannot access 'WEB_FEATURE_LIST'
 * before initialization` at load and white-screens the whole SPA, `pnpm verify` has no runtime
 * step and cannot see it, and that is exactly how the app was broken from bf5a3f2 to 2026-09-13.
 *
 * A Box with no apps never reaches this view: the index route redirects to `homePath()` instead,
 * so a blank Box still lands on Settings rather than on an empty grid.
 */
export function HomeView() {
  const groupNav = useGroupNav('home')
  const apps = appEntries()

  return (
    <AppShell
      items={[]}
      activeId=''
      onSelect={() => {}}
      groupNav={groupNav}
      topbar={{ crumbs: [{ label: 'Home' }] }}>
      <PageContainer width='wide'>
        <PageHeader title='Apps' description='What this Box does. Open one to get started.' />
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {apps.map((app) => {
            const Icon = app.icon
            return (
              <Link
                key={app.id}
                to={app.to as never}
                className='group flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-(--shadow-sm) transition-colors hover:border-accent/40'>
                <div className='flex items-center gap-2'>
                  <Icon className='size-4 shrink-0 text-accent' />
                  <span className='line-clamp-1 flex-1 text-body-sm font-medium text-text'>{app.label}</span>
                </div>
                {app.description && (
                  <p className='line-clamp-3 text-label leading-relaxed text-muted-foreground'>{app.description}</p>
                )}
              </Link>
            )
          })}
        </div>
      </PageContainer>
    </AppShell>
  )
}
