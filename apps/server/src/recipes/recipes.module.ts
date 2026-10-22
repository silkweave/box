import { Module } from '@nestjs/common'
import { RecipesController } from './recipes.controller.js'

/** Core: the Recipe Gallery's view of the recipe registry. */
@Module({ controllers: [RecipesController] })
export class RecipesModule {}
