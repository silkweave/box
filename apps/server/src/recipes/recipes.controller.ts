import { Controller, Get, Header, NotFoundException, Param, StreamableFile, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { Trpc } from '@silkweave/nestjs'
import { z } from 'zod/v4'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { boxJson, cachedRecipe, configRoot, fetchRecipe, RegistryError, registryCatalog, type RegistryRecipe } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'

// The Recipe Gallery's registry half. The gallery's own list is built from the `recipes/` docs that
// ship with this Box; this adds what the recipe registry offers beyond them (with this Box's access
// key, if any), and the latest registry version of every recipe. A recipe whose docs are not in this
// Box is fetched into the verified `.recipes/<id>/<version>/` cache so its card can show its
// RECIPE.md, powerups and screenshots. The access key is used here and never leaves the server.

const SCREENSHOT = /^[\w.-]+\.(png|jpe?g|webp|svg)$/
const CONTENT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }
const TTL_MS = 10 * 60_000

const registryOutput = z.object({
  status: z.enum(['ok', 'unavailable', 'key-rejected']),
  keySet: z.boolean(),
  recipes: z.array(z.object({
    id: z.string(),
    title: z.string(),
    latest: z.string(),
    powerups: z.array(z.string()),
    local: z.boolean(),
    docs: z.object({
      recipe: z.string(),
      powerups: z.array(z.object({ id: z.string(), markdown: z.string() })),
      screenshots: z.array(z.string()),
    }).nullable(),
  })),
})

class RegistryRecipeDto {
  @ApiProperty() id!: string
  @ApiProperty() title!: string
  @ApiProperty() latest!: string
  @ApiProperty({ type: [String] }) powerups!: string[]
  @ApiProperty({ description: 'Its docs ship in this Box (recipes/<id>/)' }) local!: boolean
  @ApiProperty({ nullable: true, description: 'RECIPE.md, POWERUP.md texts and screenshot URLs, for recipes whose docs are not in this Box' })
  docs!: { recipe: string; powerups: { id: string; markdown: string }[]; screenshots: string[] } | null
}

class RegistryDto {
  @ApiProperty({ enum: ['ok', 'unavailable', 'key-rejected'] }) status!: 'ok' | 'unavailable' | 'key-rejected'
  @ApiProperty() keySet!: boolean
  @ApiProperty({ type: [RegistryRecipeDto] }) recipes!: RegistryRecipeDto[]
}

let cache: { key: string; at: number; value: RegistryDto } | null = null

function readDocs(dir: string, id: string, version: string): RegistryRecipeDto['docs'] {
  const docs = join(dir, 'recipes', id)
  const recipeFile = join(docs, 'RECIPE.md')
  if (!existsSync(recipeFile)) return null
  const powerupsDir = join(docs, 'powerups')
  const powerups = existsSync(powerupsDir)
    ? readdirSync(powerupsDir).filter(name => existsSync(join(powerupsDir, name, 'POWERUP.md'))).sort().map(name => ({ id: name, markdown: readFileSync(join(powerupsDir, name, 'POWERUP.md'), 'utf8') }))
    : []
  const shotsDir = join(docs, 'screenshots')
  const screenshots = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter(name => SCREENSHOT.test(name)).sort().map(name => `/api/recipes/registry/${id}/${version}/screenshots/${name}`)
    : []
  return { recipe: readFileSync(recipeFile, 'utf8'), powerups, screenshots }
}

async function load(): Promise<RegistryDto> {
  const root = configRoot()
  const registry = boxJson().registry
  const key = createHash('sha256').update(`${registry.url}\n${registry.token ?? ''}`).digest('hex')
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.value
  let catalog: RegistryRecipe[]
  try {
    catalog = await registryCatalog(registry)
  } catch (error) {
    const status = error instanceof RegistryError && error.code === 'key-rejected' ? 'key-rejected' : 'unavailable'
    // Not cached: the next gallery visit tries again.
    return { status, keySet: registry.token !== null, recipes: [] }
  }
  const recipes: RegistryRecipeDto[] = []
  for (const entry of catalog) {
    const latest = entry.versions.find(v => v.version === entry.latest)
    const local = existsSync(join(root, 'recipes', entry.id, 'RECIPE.md'))
    let docs: RegistryRecipeDto['docs'] = null
    if (!local && latest) {
      try {
        const dir = cachedRecipe(root, entry.id, latest.version, latest.sha256) ?? (await fetchRecipe(root, registry, entry.id, latest.version)).path
        docs = readDocs(dir, entry.id, latest.version)
      } catch {
        docs = null
      }
    }
    recipes.push({ id: entry.id, title: entry.title, latest: entry.latest, powerups: latest?.powerups ?? [], local, docs })
  }
  const value: RegistryDto = { status: 'ok', keySet: registry.token !== null, recipes }
  cache = { key, at: Date.now(), value }
  return value
}

@Controller('recipes')
@UseGuards(AuthGuard)
export class RecipesController {
  /** tRPC query `recipesRegistry` - what the recipe registry offers this Box, for the Recipe Gallery. */
  @Get('registry')
  @ApiOkResponse({ type: RegistryDto })
  @Trpc({ output: registryOutput })
  async registry(): Promise<RegistryDto> {
    return await load()
  }

  /** GET /recipes/registry/:id/:version/screenshots/:file - a screenshot from a verified cached recipe. */
  @Get('registry/:id/:version/screenshots/:file')
  @Header('Cache-Control', 'private, max-age=86400, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  // An SVG opened directly is a document: sandboxed, no script, no requests.
  @Header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
  screenshot(@Param('id') id: string, @Param('version') version: string, @Param('file') file: string): StreamableFile {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || !/^[0-9a-f]{40}$/.test(version) || !SCREENSHOT.test(file)) throw new NotFoundException('no such screenshot')
    const dir = cachedRecipe(configRoot(), id, version)
    const path = dir ? join(dir, 'recipes', id, 'screenshots', file) : null
    if (!path || !existsSync(path) || !statSync(path).isFile()) throw new NotFoundException('no such screenshot')
    const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
    return new StreamableFile(createReadStream(path), { type: CONTENT_TYPES[ext] ?? 'application/octet-stream' })
  }
}
