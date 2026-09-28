import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Bot,
  Check,
  Circle,
  Copy,
  Hammer,
  Layers3,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react'
import { Badge, Button, PageContainer, PageHeader } from '@silkweave/box-ui'
import { RouteChrome } from '../lib/routeShell.tsx'
import { WEB_FEATURE_LIST } from '../generated/features.ts'
import { builderReadiness, loadBuilderControlState, type BuilderControlState } from '../lib/builderStore.ts'
import { openBuilderWithBrief } from '../lib/builderBrief.ts'
import { RECIPES } from '../lib/recipes.ts'
import { useAuth } from '../lib/useAuth.tsx'
import { slotComponents } from '../lib/slots.ts'
import { RecipeCatalog } from '../components/recipes/RecipeCatalog.tsx'

const FIRST_RECIPE_PROMPT = `Adapt a useful first recipe from Silkweave Stack into this Box. Start by recommending Reminders unless another small, dependency-free recipe better fits my needs. Read the recipe docs in recipes/ and follow the adapt skill. Preserve this Box's local decisions, record the source SHA and intended scope, back up before migrations, adapt registration and dependencies, run the complete validation chain, and let me review the result before finishing.`

const DASHBOARD_PROMPT = `Help me replace the onboarding dashboard with a dashboard for how I actually use this Box. First ask what I open the Box to decide, which installed areas matter every day, what needs attention, and whether the dashboard is personal or team-wide. Then implement it as a feature's home.dashboard slot contribution, preview it, run the complete validation chain, and let me review the result before finishing.`


/**
 * The Dashboard. A feature that contributes `home.dashboard` (a component, no props) owns it: the Box
 * has been made useful, and the dashboard is that feature's front page. With none, the first-run
 * onboarding below stays; its last quest is exactly to contribute one.
 */
export function HomeView() {
  const [Dashboard] = slotComponents<object>('home.dashboard')
  if (!Dashboard) return <OnboardingView />
  return (
    <RouteChrome items={[]} activeId='' onSelect={() => {}} topbar={{ crumbs: [{ label: 'Dashboard' }] }}>
      <Dashboard />
    </RouteChrome>
  )
}

/** Temporary first-run workspace. Its final quest is to replace this view with the owner's dashboard. */
function OnboardingView() {
  const { principal } = useAuth()
  const isAdmin = principal?.role === 'admin'
  const installed = useMemo(() => WEB_FEATURE_LIST.filter(feature => feature.id !== 'artifacts'), [])
  const installedIds = useMemo(() => new Set(installed.map(feature => feature.id)), [installed])
  const recipeTitle = (id: string): string => RECIPES.find(recipe => recipe.id === id)?.title ?? id
  const [builder, setBuilder] = useState<BuilderControlState>()
  const [builderError, setBuilderError] = useState<string>()
  const [copied, setCopied] = useState<'feature' | 'dashboard'>()

  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const state = await loadBuilderControlState()
        if (alive) { setBuilder(state); setBuilderError(undefined) }
      } catch (cause) {
        if (alive) setBuilderError(cause instanceof Error ? cause.message : 'Builder state is unavailable.')
      }
    }
    void load()
    window.addEventListener('focus', load)
    return () => { alive = false; window.removeEventListener('focus', load) }
  }, [isAdmin])

  const readiness = builder ? builderReadiness(builder) : null
  const providerReady = readiness?.provider === 'ready'
  const featureReady = installed.length > 0
  const completeCount = 1 + Number(providerReady) + Number(featureReady)
  const next = !isAdmin
    ? { title: 'Explore what is installed', detail: 'An administrator owns setup and Builder changes.', action: null, prompt: null }
    : !providerReady
      ? { title: 'Connect Codex or Claude', detail: 'Builder needs one signed-in provider profile before it can change this Box.', action: null, prompt: null }
      : !featureReady
        ? { title: 'Adapt your first recipe', detail: 'Pick a recipe below, or let Builder recommend a small one from the Stack.', action: 'Open Builder', prompt: FIRST_RECIPE_PROMPT }
        : { title: 'Make the dashboard yours', detail: 'Ask Builder to replace this onboarding surface with the decisions and work that matter to you.', action: 'Open Builder', prompt: DASHBOARD_PROMPT }

  const copyPrompt = async (kind: 'feature' | 'dashboard', prompt: string): Promise<void> => {
    await navigator.clipboard.writeText(prompt)
    setCopied(kind)
    window.setTimeout(() => setCopied(undefined), 1600)
  }

  return (
    <RouteChrome items={[]} activeId='' onSelect={() => {}} topbar={{ crumbs: [{ label: 'Dashboard' }] }}>
      <PageContainer width='wide'>
        <PageHeader
          title={<>Welcome{principal?.display ? `, ${principal.display}` : ''}.</>}
          description='Your Box is running. Now make it useful.'
          actions={<Badge variant='silk'>First run</Badge>}
        />

        <section className='overflow-hidden rounded-2xl border border-border bg-surface shadow-(--shadow-sm)'>
          <div className='grid gap-8 p-6 md:grid-cols-[1fr_auto] md:p-8'>
            <div>
              <p className='text-label font-medium uppercase tracking-wider text-accent'>Recommended next</p>
              <h2 className='mt-2 font-serif text-display-sm text-text'>{next.title}</h2>
              <p className='mt-2 max-w-2xl text-body text-muted-foreground'>{next.detail}</p>
              {next.prompt && <div className='mt-5 max-w-2xl rounded-lg border border-border bg-bg p-3'>
                <div className='flex items-center justify-between gap-3'>
                  <p className='text-label font-medium text-text'>Builder brief</p>
                  <Button variant='ghost' size='xs' onClick={() => void copyPrompt(featureReady ? 'dashboard' : 'feature', next.prompt!)}><Copy />{copied === (featureReady ? 'dashboard' : 'feature') ? 'Copied' : 'Copy'}</Button>
                </div>
                <p className='mt-2 line-clamp-3 text-label leading-relaxed text-muted-foreground'>{next.prompt}</p>
              </div>}
              {next.action && next.prompt && <Button className='mt-5' onClick={() => openBuilderWithBrief(next.prompt!)}><Hammer />{next.action}<ArrowRight /></Button>}
            </div>
            <div className='flex min-w-40 flex-col justify-center rounded-xl bg-accent-bg px-6 py-5 text-center'>
              <span className='text-4xl font-semibold tracking-tight text-accent'>{completeCount}/4</span>
              <span className='mt-1 text-label font-medium text-muted-foreground'>quests complete</span>
              <div className='mt-3 h-1.5 overflow-hidden rounded-full bg-border-light'><div className='h-full rounded-full bg-accent transition-all' style={{ width: `${completeCount * 25}%` }} /></div>
            </div>
          </div>
        </section>

        <div className='mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.75fr)]'>
          <section>
            <div className='mb-3 flex items-center justify-between'><h2 className='text-heading-2 font-semibold text-text'>Onboarding quests</h2><span className='text-label text-muted-foreground'>The last quest removes this dashboard.</span></div>
            <div className='space-y-3'>
              <Quest complete icon={<UserRoundCheck />} title='Meet your Box' description='You are signed in and this Box is ready for its human owner.' />
              <Quest complete={providerReady} active={isAdmin && !providerReady} icon={<Bot />} title='Connect a Builder provider' description={providerDescription(readiness, builderError)}>
                {isAdmin && !providerReady && <ProviderSetup />}
              </Quest>
              <Quest complete={featureReady} active={isAdmin && providerReady && !featureReady} icon={<Layers3 />} title='Adapt and use a recipe' description={featureReady ? `${installed.length} ${installed.length === 1 ? 'recipe is' : 'recipes are'} adapted: ${installed.map(feature => recipeTitle(feature.id)).join(', ')}.` : 'Choose a recipe, then let Builder adapt and verify its source.'}>
                {isAdmin && providerReady && !featureReady && <Button className='mt-4' size='sm' onClick={() => document.getElementById('recipes')?.scrollIntoView({ behavior: 'smooth' })}><Layers3 />Browse recipes</Button>}
              </Quest>
              <Quest active={isAdmin && providerReady && featureReady} icon={<Sparkles />} title='Make the dashboard yours' description='Replace onboarding with a dashboard shaped around your adapted recipes and daily decisions.'>
                {isAdmin && providerReady && featureReady && <Button className='mt-4' size='sm' onClick={() => openBuilderWithBrief(DASHBOARD_PROMPT)}><Hammer />Design with Builder</Button>}
              </Quest>
            </div>
          </section>

          <aside className='space-y-6'>
            <section className='rounded-xl border border-border bg-surface p-5'>
              <h2 className='text-heading-sm font-semibold text-text'>Your Box now</h2>
              <dl className='mt-4 space-y-3 text-body-sm'>
                <StatusRow label='Owner' value={principal?.display ?? 'Signed in'} tone='success' />
                <StatusRow label='Builder' value={!isAdmin ? 'Admin only' : builderError ? 'Unavailable' : providerReady ? 'Ready' : builder ? 'Needs setup' : 'Checking'} tone={providerReady ? 'success' : builderError ? 'danger' : 'warning'} />
                <StatusRow label='Recipes' value={installed.length ? `${installed.length} adapted` : 'Core only'} tone={installed.length ? 'success' : 'neutral'} />
                <StatusRow label='Safety backup' value={builder?.backups[0] ? new Date(builder.backups[0].createdAt).toLocaleDateString() : 'Created when Builder starts'} tone='neutral' />
              </dl>
            </section>
            <section className='rounded-xl border border-border bg-surface p-5'>
              <div className='flex items-center gap-2'><ShieldCheck className='size-5 text-accent' /><h2 className='text-heading-sm font-semibold text-text'>How changes work</h2></div>
              <p className='mt-3 text-body-sm leading-relaxed text-muted-foreground'>Builder creates a safety backup and a dedicated branch. You preview the result, then Wrap Up walks you through reviewing the changes, verifying them and committing.</p>
              <p className='mt-3 font-mono text-label text-fg-3'>BACKUP → BUILD → PREVIEW → WRAP UP (REVIEW → VERIFY → COMMIT)</p>
            </section>
          </aside>
        </div>

        <RecipeCatalog installed={installedIds} canAdapt={isAdmin} />
      </PageContainer>
    </RouteChrome>
  )
}

function providerDescription(readiness: ReturnType<typeof builderReadiness> | null, error?: string): string {
  if (error) return error
  if (!readiness) return 'Checking the Box host for Codex or Claude profiles.'
  if (readiness.provider === 'ready') return readiness.message
  if (readiness.provider === 'sign-in-required') return `A profile exists, but its provider still needs sign-in. ${readiness.message}`
  return 'Builder needs a Codex or Claude profile mapped to your account on this host.'
}

function ProviderSetup() {
  return <div className='mt-4 rounded-lg border border-border bg-bg p-4 text-body-sm'>
    <p className='font-medium text-text'>On the Box host:</p>
    <ol className='mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground'>
      <li>Sign in with <code>codex login</code> or start <code>claude</code> and complete its login.</li>
      <li>Add that provider profile under <code>workerdeck</code> in <code>box.local.json</code>, and map your user ID under <code>agentProfiles</code>.</li>
      <li>Restart <code>box dev</code>, then return here. The status is read from Builder itself.</li>
    </ol>
    <p className='mt-3 text-label text-fg-3'>Use <code>docs/examples/workerdeck.json</code> as the configuration template. Profile homes must be absolute paths to <code>.codex</code> or <code>.claude</code>.</p>
  </div>
}

function Quest({ complete = false, active = false, icon, title, description, children }: { complete?: boolean; active?: boolean; icon: ReactNode; title: string; description: string; children?: ReactNode }) {
  return <article className={`rounded-xl border bg-surface p-5 transition-colors ${active ? 'border-accent/40 shadow-(--shadow-sm)' : 'border-border'}`}>
    <div className='flex gap-4'>
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${complete ? 'bg-success-bg text-success' : active ? 'bg-accent-bg text-accent' : 'bg-bg text-fg-4'}`}>{complete ? <Check className='size-5' /> : icon}</div>
      <div className='min-w-0 flex-1'><div className='flex flex-wrap items-center gap-2'><h3 className='font-medium text-text'>{title}</h3>{complete ? <Badge variant='success'>Complete</Badge> : active ? <Badge variant='accent'>Next</Badge> : <Badge variant='neutral'>Later</Badge>}</div><p className='mt-1 text-body-sm text-muted-foreground'>{description}</p>{children}</div>
    </div>
  </article>
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const dot = tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : tone === 'danger' ? 'bg-danger' : 'bg-fg-4'
  return <div className='flex items-center justify-between gap-4'><dt className='flex items-center gap-2 text-muted-foreground'><Circle className={`size-2 fill-current ${dot}`} />{label}</dt><dd className='truncate text-right font-medium text-text'>{value}</dd></div>
}
