import { useMemo, useState } from 'react'
import { ClipboardList, KeyRound, SearchX } from 'lucide-react'
import { Button, Dialog, PageContainer, PageHeader, SearchInput, SegmentedControl } from '@silkweave/box-ui'
import { RouteChrome } from '../lib/routeShell.tsx'
import { allRecipes, matchesRecipe, recipeTitles } from '../lib/recipes.ts'
import { useRegistryOffer } from '../lib/registryRecipes.ts'
import { recipeBook } from '../lib/recipeLedger.ts'
import { useAuth } from '../lib/useAuth.tsx'
import { openBuilderWithBrief } from '../lib/builderBrief.ts'
import { RecipeCard, RecipeDetail } from '../components/recipes/RecipeCard.tsx'

type Filter = 'all' | 'available' | 'adapted'

/** Drafted when registered features are missing from the ledger, e.g. a Box adapted before it existed. */
const recordBrief = (ids: readonly string[]): string => `Record the recipes this Box has already adapted in the \`recipes\` ledger of \`box.json\`. These are registered as features but not recorded: ${ids.map(id => `${recipeTitles.get(id) ?? id} (\`${id}\`)`).join(', ')}. Add each as \`"<id>": { "powerups": [] }\`. For each, check its powerups in \`recipes/<id>/powerups/\` with the \`## Detect\` section of their INSTALL.md and list the ones this Box already has. Check \`recipes/mobile/INSTALL.md\` the same way and record \`mobile\` if the mobile app is set up. Change nothing else, run the complete validation chain, and let me review the result before finishing.`

/**
 * The Recipe Gallery: every recipe that ships in `recipes/` plus what the recipe registry offers
 * this Box beyond them (lib/registryRecipes.ts), searchable and filterable by whether
 * this Box has adapted it, with each recipe's powerups listed on its card. Linked from the Work menu
 * ("Recipe Gallery"); unlike onboarding it stays after the dashboard is replaced.
 */
export function RecipeGalleryView() {
  const { principal } = useAuth()
  const canAdapt = principal?.role === 'admin'
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string>()
  const offer = useRegistryOffer().data
  // Re-read on every render: the registry offer arrives after the first one.
  const recipes = useMemo(() => allRecipes(), [offer])
  const adaptedCount = recipes.filter(recipe => recipeBook.adapted(recipe.id)).length
  const unrecorded = recipes.filter(recipe => { const state = recipeBook.recipe(recipe); return state.adapted && !state.recorded }).map(recipe => recipe.id)
  const visible = useMemo(() => recipes.filter(recipe => {
    const adapted = recipeBook.adapted(recipe.id)
    if (filter === 'adapted' && !adapted) return false
    if (filter === 'available' && adapted) return false
    return matchesRecipe(recipe, query, recipeTitles)
  }), [recipes, query, filter])
  const open = recipes.find(recipe => recipe.id === openId)

  return (
    <RouteChrome items={[]} activeId='' onSelect={() => {}} topbar={{ crumbs: [{ label: 'Recipe Gallery' }] }}>
      <PageContainer width='wide'>
        <PageHeader
          title='Recipe Gallery'
          description="Ready-made capabilities, with the powerups each one unlocks. They are not one-click packages: Builder adapts a recipe's source to this Box, verifies it, and waits for your review."
        />

        {canAdapt && unrecorded.length > 0 && <div className='mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning-bg p-4'>
          <ClipboardList className='size-5 shrink-0 text-warning' />
          <p className='min-w-0 flex-1 text-body-sm text-text'>{unrecorded.length === 1 ? '1 adapted recipe is' : `${unrecorded.length} adapted recipes are`} not recorded in the <code>recipes</code> ledger of <code>box.json</code>, so their powerups cannot show as added.</p>
          <Button size='sm' variant='outline' onClick={() => openBuilderWithBrief(recordBrief(unrecorded))}>Record with Builder</Button>
        </div>}

        {offer?.status === 'key-rejected' && <div className='mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning-bg p-4'>
          <KeyRound className='size-5 shrink-0 text-warning' />
          <p className='min-w-0 flex-1 text-body-sm text-text'>The recipe registry did not accept this Box's access key, so only the recipes shipped with this Box are listed. Adapted recipes keep working. To set a new key, run <code>box registry key</code> in this Box's folder.</p>
        </div>}

        <div className='flex flex-wrap items-center justify-between gap-3'>
          <SegmentedControl<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All ${recipes.length}` },
              { value: 'available', label: `Available ${recipes.length - adaptedCount}` },
              { value: 'adapted', label: `Adapted ${adaptedCount}` },
            ]}
          />
          <SearchInput value={query} onChange={setQuery} placeholder='Search recipes and powerups' className='w-full sm:w-80' />
        </div>

        {recipes.length === 0
          ? <p className='mt-4 rounded-xl border border-dashed border-border p-6 text-body-sm text-muted-foreground'>No recipes ship with this Box. They live in <code>recipes/</code> and arrive with core.</p>
          : visible.length === 0
            ? <div className='mt-4 flex flex-col items-center rounded-xl border border-dashed border-border p-8 text-center'>
                <SearchX className='size-6 text-fg-4' />
                <p className='mt-2 text-body-sm text-muted-foreground'>{query ? `No recipe matches "${query}" here.` : filter === 'adapted' ? 'No recipe is adapted yet.' : 'Every recipe is adapted.'}</p>
                <Button className='mt-3' variant='ghost' size='sm' onClick={() => { setQuery(''); setFilter('all') }}>Show all recipes</Button>
              </div>
            : <div className='mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                {visible.map(recipe => <RecipeCard key={recipe.id} recipe={recipe} canAdapt={canAdapt} onOpen={() => setOpenId(recipe.id)} />)}
              </div>}

        <Dialog open={open !== undefined} onOpenChange={next => { if (!next) setOpenId(undefined) }}>
          {open && <RecipeDetail recipe={open} canAdapt={canAdapt} onOpenRecipe={setOpenId} />}
        </Dialog>
      </PageContainer>
    </RouteChrome>
  )
}
