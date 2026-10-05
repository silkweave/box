import { Check, Hammer, ImageIcon, Lock, Zap } from 'lucide-react'
import { Badge, Button, DialogContent, DialogDescription, DialogTitle, ImageGallery } from '@silkweave/box-ui'
import { RECIPES, RECOMMENDED_RECIPES, powerupBrief, recipeBrief, recipeTitles, type Powerup, type PowerupState, type Recipe, type Requirement } from '../../lib/recipes.ts'
import { recipeBook } from '../../lib/recipeLedger.ts'
import { openBuilderWithBrief } from '../../lib/builderBrief.ts'

/**
 * Recipe presentation shared by the Recipe Gallery and the onboarding dashboard. Adapted state and
 * added powerups come from the `recipes` ledger in `box.json` (plus registered features); "Adapt
 * recipe" and "Add powerup" only draft a Builder brief that the owner reviews and sends.
 */

export const adaptRecipe = (recipe: Recipe): void =>
  openBuilderWithBrief(recipeBrief(recipe, recipeTitles, recipeBook.adapted(recipe.id), recipe.powerups))

const addPowerup = (powerup: Powerup): void =>
  openBuilderWithBrief(powerupBrief(powerup, recipeTitles.get(powerup.recipe) ?? powerup.recipe))

const powerupTitle = (recipe: string, id: string): string =>
  RECIPES.find(entry => entry.id === recipe)?.powerups.find(entry => entry.id === id)?.title ?? id

const requirementLabel = (req: Requirement): string =>
  req.powerup ? `${powerupTitle(req.recipe, req.powerup)} (${recipeTitles.get(req.recipe) ?? req.recipe})` : recipeTitles.get(req.recipe) ?? req.recipe

/** Why a powerup is locked, in the owner's words: its own recipe first, then what it requires. */
export function lockReason(powerup: Powerup, state: Extract<PowerupState, { needs: Requirement[] }>): string {
  const [first, ...rest] = state.needs
  const base = first && first.recipe === powerup.recipe && !first.powerup
  const others = (base ? rest : state.needs).map(requirementLabel)
  if (base && others.length === 0) return `Adapt ${requirementLabel(first)} first`
  if (base) return `Adapt ${requirementLabel(first)} first; requires ${others.join(', ')}`
  return `Requires ${others.join(', ')}`
}

export function RecipeBadges({ recipe }: { recipe: Recipe }) {
  const state = recipeBook.recipe(recipe)
  if (state.adapted) return <>
    <Badge variant='success'>Adapted</Badge>
    {!state.recorded && <Badge variant='warning' title='Registered as a feature but missing from the recipes ledger in box.json'>Not recorded</Badge>}
  </>
  return RECOMMENDED_RECIPES.includes(recipe.id) ? <Badge variant='accent'>Recommended</Badge> : null
}

function BuildsOn({ recipe }: { recipe: Recipe }) {
  if (recipe.buildsOn.length === 0) return <>Core only</>
  return <>Builds on {recipe.buildsOn.map((id, index) => <span key={id}>{index > 0 && ', '}<span className={recipeBook.adapted(id) ? undefined : 'text-warning'}>{recipeTitles.get(id) ?? id}</span></span>)}</>
}

export function RecipeCard({ recipe, canAdapt, onOpen, compact = false }: { recipe: Recipe; canAdapt: boolean; onOpen: () => void; compact?: boolean }) {
  const cover = recipe.screenshots[0]
  const adapted = recipeBook.adapted(recipe.id)
  return (
    <article className='group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-accent/40'>
      <button type='button' onClick={onOpen} className='flex flex-1 flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40'>
        <div className='aspect-[16/8] overflow-hidden border-b border-border bg-bg'>
          {cover ? <img src={cover.src} alt='' className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]' /> : <div className='flex h-full items-center justify-center text-fg-4'><ImageIcon className='size-6' /></div>}
        </div>
        <div className='flex flex-1 flex-col p-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='font-medium text-text'>{recipe.title}</h3>
            <RecipeBadges recipe={recipe} />
          </div>
          <p className='mt-1.5 line-clamp-3 text-body-sm text-muted-foreground'>{recipe.summary}</p>
          <p className='mt-auto pt-3 text-label text-fg-3'><BuildsOn recipe={recipe} /></p>
        </div>
      </button>
      {!compact && recipe.powerups.length > 0 && <ul className='border-t border-border px-2 py-1.5' aria-label={`${recipe.title} powerups`}>
        {recipe.powerups.map(powerup => <PowerupRow key={powerup.id} powerup={powerup} canAdd={canAdapt} />)}
      </ul>}
      <div className='flex items-center justify-between gap-2 border-t border-border px-4 py-2.5'>
        <Button variant='ghost' size='sm' onClick={onOpen}>Details</Button>
        {canAdapt && <Button size='sm' variant={adapted ? 'outline' : 'default'} onClick={() => adaptRecipe(recipe)}><Hammer />{adapted ? 'Update recipe' : 'Adapt recipe'}</Button>}
      </div>
    </article>
  )
}

/** One powerup as a list row: added, available (admins can add it) or locked with the reason. */
function PowerupRow({ powerup, canAdd }: { powerup: Powerup; canAdd: boolean }) {
  const state = recipeBook.powerup(powerup)
  const locked = state.kind === 'locked'
  return (
    <li className='flex min-h-9 items-center gap-2 rounded-md px-2 py-1' title={locked ? lockReason(powerup, state) : powerup.summary}>
      {locked ? <Lock className='size-3.5 shrink-0 text-fg-4' /> : <Zap className={`size-3.5 shrink-0 ${state.kind === 'added' ? 'text-success' : 'text-accent'}`} />}
      <div className='min-w-0 flex-1'>
        <p className={`truncate text-body-sm ${locked ? 'text-fg-3' : 'text-text'}`}>{powerup.title}</p>
        {locked && <p className='truncate text-[11px] leading-4 text-fg-4'>{lockReason(powerup, state)}</p>}
      </div>
      {state.kind === 'added'
        ? state.needs.length
          ? <Badge variant='warning' size='sm' title={`Recorded as added, but: ${lockReason(powerup, state)}`}>Added · check</Badge>
          : <Badge variant='success' size='sm'><Check className='size-3' />Added</Badge>
        : state.kind === 'available' && (canAdd
          ? <Button size='xs' variant='outline' onClick={() => addPowerup(powerup)}><Zap />Add</Button>
          : <Badge variant='neutral' size='sm'>Available</Badge>)}
    </li>
  )
}

export function RecipeDetail({ recipe, canAdapt, onOpenRecipe }: { recipe: Recipe; canAdapt: boolean; onOpenRecipe: (id: string) => void }) {
  const adapted = recipeBook.adapted(recipe.id)
  return (
    <DialogContent className='max-h-[min(90dvh,52rem)] max-w-3xl overflow-y-auto p-6'>
      <div className='flex flex-wrap items-center gap-2 pr-10'>
        <DialogTitle className='pr-0'>{recipe.title}</DialogTitle>
        <RecipeBadges recipe={recipe} />
        {canAdapt && <Button size='sm' className='ml-auto' variant={adapted ? 'outline' : 'default'} onClick={() => adaptRecipe(recipe)}><Hammer />{adapted ? 'Update recipe' : 'Adapt recipe'}</Button>}
      </div>
      <DialogDescription className='text-body'>{recipe.summary}</DialogDescription>
      {recipe.screenshots.length > 0 && <ImageGallery key={recipe.id} images={recipe.screenshots} />}
      {recipe.highlights.length > 0 && <div>
        <h3 className='text-label font-medium uppercase tracking-wider text-fg-3'>What you get</h3>
        <ul className='mt-2 space-y-1.5'>
          {recipe.highlights.map(item => <li key={item} className='flex gap-2 text-body-sm text-text'><Check className='mt-0.5 size-4 shrink-0 text-accent' />{item}</li>)}
        </ul>
      </div>}
      <div>
        <h3 className='text-label font-medium uppercase tracking-wider text-fg-3'>Builds on</h3>
        <div className='mt-2 flex flex-wrap items-center gap-2 text-body-sm'>
          {recipe.buildsOn.length === 0
            ? <span className='text-muted-foreground'>Core only. Nothing else to adapt first.</span>
            : recipe.buildsOn.map(id => <button key={id} type='button' onClick={() => onOpenRecipe(id)} className='rounded-full border border-border px-2.5 py-0.5 text-label text-text transition-colors hover:border-accent/40'>{recipeTitles.get(id) ?? id}{recipeBook.adapted(id) ? ' · adapted' : ' · adapt first'}</button>)}
        </div>
      </div>
      {recipe.powerups.length > 0 && <div>
        <h3 className='text-label font-medium uppercase tracking-wider text-fg-3'>Powerups</h3>
        <p className='mt-1 text-body-sm text-muted-foreground'>Optional capabilities. The recipe works without them; each unlocks once the recipe and anything it requires are adapted.</p>
        <ul className='mt-3 space-y-2'>
          {recipe.powerups.map(powerup => <PowerupDetail key={powerup.id} powerup={powerup} canAdd={canAdapt} onOpenRecipe={onOpenRecipe} />)}
        </ul>
      </div>}
    </DialogContent>
  )
}

function PowerupDetail({ powerup, canAdd, onOpenRecipe }: { powerup: Powerup; canAdd: boolean; onOpenRecipe: (id: string) => void }) {
  const state = recipeBook.powerup(powerup)
  return (
    <li className='rounded-lg border border-border p-3'>
      <div className='flex flex-wrap items-start gap-2'>
        {state.kind === 'locked' ? <Lock className='mt-0.5 size-4 shrink-0 text-fg-4' /> : <Zap className={`mt-0.5 size-4 shrink-0 ${state.kind === 'added' ? 'text-success' : 'text-accent'}`} />}
        <div className='min-w-0 flex-1'>
          <p className='font-medium text-text'>{powerup.title}</p>
          <p className='mt-0.5 text-body-sm text-muted-foreground'>{powerup.summary}</p>
        </div>
        {state.kind === 'added' && (state.needs.length ? <Badge variant='warning'>Added · check</Badge> : <Badge variant='success'><Check className='size-3.5' />Added</Badge>)}
        {state.kind === 'available' && canAdd && <Button size='sm' variant='outline' onClick={() => addPowerup(powerup)}><Zap />Add powerup</Button>}
        {state.kind === 'locked' && <Badge variant='neutral'><Lock className='size-3' />Locked</Badge>}
      </div>
      {powerup.highlights.length > 0 && <ul className='mt-2 space-y-1 pl-6'>
        {powerup.highlights.map(item => <li key={item} className='flex gap-2 text-body-sm text-text'><Check className='mt-0.5 size-3.5 shrink-0 text-accent' />{item}</li>)}
      </ul>}
      {state.kind !== 'available' && state.needs.length > 0 && <p className={`mt-2 flex flex-wrap items-center gap-1.5 pl-6 text-label ${state.kind === 'added' ? 'text-warning' : 'text-fg-3'}`}>
        {state.kind === 'added' ? `Recorded as added, but: ${lockReason(powerup, state)}` : lockReason(powerup, state)}.
        {state.needs.filter(req => req.recipe !== powerup.recipe).map(req => <button key={`${req.recipe}/${req.powerup ?? ''}`} type='button' onClick={() => onOpenRecipe(req.recipe)} className='rounded-full border border-border px-2 py-0 text-label text-text transition-colors hover:border-accent/40'>Open {recipeTitles.get(req.recipe) ?? req.recipe}</button>)}
      </p>}
      {powerup.needs.length > 0 && <p className='mt-2 pl-6 text-label text-fg-3'>Needs: {powerup.needs.join(' · ')}</p>}
    </li>
  )
}
