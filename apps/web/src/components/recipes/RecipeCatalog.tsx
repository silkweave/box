import { useMemo, useState } from 'react'
import { Check, Hammer, ImageIcon, SearchX, Smartphone } from 'lucide-react'
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle, ImageGallery, SearchInput } from '@silkweave/box-ui'
import { RECIPES, RECOMMENDED_RECIPE, matchesRecipe, recipeBrief, type Recipe } from '../../lib/recipes.ts'
import { openBuilderWithBrief } from '../../lib/builderBrief.ts'

/**
 * The onboarding recipe explorer: every recipe that ships in `recipes/`, a search over titles,
 * summaries and highlights, and a detail dialog. "Adapt recipe" only drafts a Builder brief; the
 * owner reviews and sends it. Adapted state comes from the registered features, never a stored flag.
 */
export function RecipeCatalog({ installed, canAdapt }: { installed: ReadonlySet<string>; canAdapt: boolean }) {
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string>()
  const titles = useMemo(() => new Map(RECIPES.map(recipe => [recipe.id, recipe.title])), [])
  const visible = useMemo(() => RECIPES.filter(recipe => matchesRecipe(recipe, query, titles)), [query, titles])
  const open = RECIPES.find(recipe => recipe.id === openId)
  const adapt = (recipe: Recipe): void => openBuilderWithBrief(recipeBrief(recipe, titles, installed.has(recipe.id)))

  return (
    <section id='recipes' className='mt-10 scroll-mt-6'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h2 className='text-heading-2 font-semibold text-text'>Recipes</h2>
          <p className='mt-1 max-w-2xl text-body-sm text-muted-foreground'>Ready-made capabilities from the Stack. They are not one-click packages: Builder adapts a recipe's source to this Box, verifies it, and waits for your review.</p>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder='Search recipes' className='w-full sm:w-72' />
      </div>

      {RECIPES.length === 0
        ? <p className='mt-4 rounded-xl border border-dashed border-border p-6 text-body-sm text-muted-foreground'>No recipes ship with this Box. They live in <code>recipes/</code> and arrive with core.</p>
        : visible.length === 0
          ? <div className='mt-4 flex flex-col items-center rounded-xl border border-dashed border-border p-8 text-center'>
              <SearchX className='size-6 text-fg-4' />
              <p className='mt-2 text-body-sm text-muted-foreground'>No recipe matches "{query}".</p>
              <Button className='mt-3' variant='ghost' size='sm' onClick={() => setQuery('')}>Clear search</Button>
            </div>
          : <div className='mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              {visible.map(recipe => <RecipeCard key={recipe.id} recipe={recipe} titles={titles} adapted={installed.has(recipe.id)} canAdapt={canAdapt} onOpen={() => setOpenId(recipe.id)} onAdapt={() => adapt(recipe)} />)}
            </div>}

      <Dialog open={open !== undefined} onOpenChange={next => { if (!next) setOpenId(undefined) }}>
        {open && <RecipeDetail recipe={open} titles={titles} installed={installed} canAdapt={canAdapt} onAdapt={() => adapt(open)} onOpenRecipe={setOpenId} />}
      </Dialog>
    </section>
  )
}

function RecipeCard({ recipe, titles, adapted, canAdapt, onOpen, onAdapt }: { recipe: Recipe; titles: ReadonlyMap<string, string>; adapted: boolean; canAdapt: boolean; onOpen: () => void; onAdapt: () => void }) {
  const cover = recipe.screenshots[0]
  return (
    <article className='group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-accent/40'>
      <button type='button' onClick={onOpen} className='flex flex-1 flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40'>
        <div className='aspect-[16/9] overflow-hidden border-b border-border bg-bg'>
          {cover ? <img src={cover.src} alt='' className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]' /> : <div className='flex h-full items-center justify-center text-fg-4'><ImageIcon className='size-6' /></div>}
        </div>
        <div className='flex flex-1 flex-col p-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='font-medium text-text'>{recipe.title}</h3>
            {adapted ? <Badge variant='success'>Adapted</Badge> : recipe.id === RECOMMENDED_RECIPE && <Badge variant='accent'>Recommended first</Badge>}
          </div>
          <p className='mt-1.5 line-clamp-3 text-body-sm text-muted-foreground'>{recipe.summary}</p>
          <p className='mt-auto pt-3 text-label text-fg-3'>{recipe.buildsOn.length ? `Builds on ${recipe.buildsOn.map(id => titles.get(id) ?? id).join(', ')}` : 'Core only'}</p>
        </div>
      </button>
      <div className='flex items-center justify-between gap-2 border-t border-border px-4 py-2.5'>
        <Button variant='ghost' size='sm' onClick={onOpen}>Details</Button>
        {canAdapt && <Button size='sm' variant={adapted ? 'outline' : 'default'} onClick={onAdapt}><Hammer />{adapted ? 'Update recipe' : 'Adapt recipe'}</Button>}
      </div>
    </article>
  )
}

function RecipeDetail({ recipe, titles, installed, canAdapt, onAdapt, onOpenRecipe }: { recipe: Recipe; titles: ReadonlyMap<string, string>; installed: ReadonlySet<string>; canAdapt: boolean; onAdapt: () => void; onOpenRecipe: (id: string) => void }) {
  const adapted = installed.has(recipe.id)
  return (
    <DialogContent className='max-h-[min(90dvh,52rem)] max-w-3xl overflow-y-auto p-6'>
      <div className='flex flex-wrap items-center gap-2 pr-10'>
        <DialogTitle className='pr-0'>{recipe.title}</DialogTitle>
        {adapted ? <Badge variant='success'>Adapted</Badge> : recipe.id === RECOMMENDED_RECIPE && <Badge variant='accent'>Recommended first</Badge>}
        {canAdapt && <Button size='sm' className='ml-auto' variant={adapted ? 'outline' : 'default'} onClick={onAdapt}><Hammer />{adapted ? 'Update recipe' : 'Adapt recipe'}</Button>}
      </div>
      <DialogDescription className='text-body'>{recipe.summary}</DialogDescription>
      {recipe.screenshots.length > 0 && <ImageGallery key={recipe.id} images={recipe.screenshots} />}
      {recipe.highlights.length > 0 && <div>
        <h3 className='text-label font-medium uppercase tracking-wider text-fg-3'>What you get</h3>
        <ul className='mt-2 space-y-1.5'>
          {recipe.highlights.map(item => <li key={item} className='flex gap-2 text-body-sm text-text'><Check className='mt-0.5 size-4 shrink-0 text-accent' />{item}</li>)}
        </ul>
      </div>}
      {recipe.mobile.length > 0 && <div>
        <h3 className='text-label font-medium uppercase tracking-wider text-fg-3'>Mobile app (optional)</h3>
        <ul className='mt-2 space-y-1.5'>
          {recipe.mobile.map(item => <li key={item} className='flex gap-2 text-body-sm text-text'><Smartphone className='mt-0.5 size-4 shrink-0 text-accent' />{item}</li>)}
        </ul>
      </div>}
      <div>
        <h3 className='text-label font-medium uppercase tracking-wider text-fg-3'>Builds on</h3>
        <div className='mt-2 flex flex-wrap items-center gap-2 text-body-sm'>
          {recipe.buildsOn.length === 0
            ? <span className='text-muted-foreground'>Core only. Nothing else to adapt first.</span>
            : recipe.buildsOn.map(id => <button key={id} type='button' onClick={() => onOpenRecipe(id)} className='rounded-full border border-border px-2.5 py-0.5 text-label text-text transition-colors hover:border-accent/40'>{titles.get(id) ?? id}{installed.has(id) ? ' · adapted' : ''}</button>)}
        </div>
      </div>
    </DialogContent>
  )
}
