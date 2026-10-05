import ledger from 'virtual:box-recipes'
import { WEB_FEATURE_LIST } from '../generated/features.ts'
import { RecipeBook } from './recipeFormat.ts'

/**
 * This Box's recipe state: the `recipes` ledger of `box.json` (build time, see
 * apps/web/recipeLedger.ts) plus the registered web features. Kept apart from lib/recipes.ts so the
 * catalog stays importable without the virtual module.
 */
export const RECIPE_LEDGER = ledger
export const recipeBook = new RecipeBook(ledger, new Set(WEB_FEATURE_LIST.map(feature => feature.id)))
