import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, LayoutGrid } from 'lucide-react'
import { Button, Dialog } from '@silkweave/box-ui'
import { RECIPES, RECOMMENDED_RECIPES, type Recipe } from '../../lib/recipes.ts'
import { recipeBook } from '../../lib/recipeLedger.ts'
import { RecipeCard, RecipeDetail } from './RecipeCard.tsx'

/** Three recipes not adapted yet: the recommended ones first, then anything whose dependencies are met. */
function recommendations(): Recipe[] {
  const open = RECIPES.filter(recipe => !recipeBook.adapted(recipe.id))
  const preferred = RECOMMENDED_RECIPES.flatMap(id => open.filter(recipe => recipe.id === id))
  const rest = open.filter(recipe => !preferred.includes(recipe) && recipeBook.recipe(recipe).missing.length === 0)
  return [...preferred, ...rest].slice(0, 3)
}

/**
 * Onboarding's recipe step: three suggestions and a way into the Recipe Gallery. The full catalog
 * lives on its own route so it survives when the owner replaces this dashboard.
 */
export function RecommendedRecipes({ canAdapt }: { canAdapt: boolean }) {
  const navigate = useNavigate()
  const [openId, setOpenId] = useState<string>()
  const picks = recommendations()
  const open = RECIPES.find(recipe => recipe.id === openId)
  return (
    <section id='recipes' className='mt-10 scroll-mt-6'>
      {picks.length > 0 && <>
        <h2 className='text-heading-2 font-semibold text-text'>Which recipe should Builder adapt first?</h2>
        <p className='mt-1 max-w-2xl text-body-sm text-muted-foreground'>Small, useful places to start. Pick one and Builder adapts its source to this Box, verifies it, and waits for your review.</p>
        <div className='mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          {picks.map(recipe => <RecipeCard key={recipe.id} recipe={recipe} canAdapt={canAdapt} compact onOpen={() => setOpenId(recipe.id)} />)}
        </div>
      </>}

      <div className='mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-accent/30 bg-accent-bg p-5'>
        <div className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-accent'><LayoutGrid className='size-5' /></div>
        <div className='min-w-0 flex-1'>
          <p className='font-medium text-text'>Looking for something else?</p>
          <p className='mt-0.5 text-body-sm text-muted-foreground'>The Recipe Gallery has all {RECIPES.length} recipes and their powerups. It stays in the Work menu after onboarding.</p>
        </div>
        <Button variant='outline' onClick={() => void navigate({ to: '/recipes' })}>Open Recipe Gallery<ArrowRight /></Button>
      </div>

      <Dialog open={open !== undefined} onOpenChange={next => { if (!next) setOpenId(undefined) }}>
        {open && <RecipeDetail recipe={open} canAdapt={canAdapt} onOpenRecipe={setOpenId} />}
      </Dialog>
    </section>
  )
}
