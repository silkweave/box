// `box recipe list|fetch` and `box registry status|key`: the recipes this Box may adapt, fetched
// from the recipe registry (`registry.url` in box.json) with the access key in box.local.json
// (`registry.token`). A fetched version lands in the gitignored `.recipes/<id>/<version>/` cache,
// verified against the catalog digest, and is never modified afterwards.
//
// The access key is never printed. `box registry key` reads it from a hidden prompt or stdin (never
// from an argument, which would land in shell history), checks it against the registry, and only
// then writes it to box.local.json.
import { readBoxConfig, removeBoxLocal, writeBoxLocal, type BoxRegistry } from '@silkweave/box-core/box-json'
import { checkRegistryKey, fetchRecipe, RECIPE_CACHE_DIR, RegistryError, registryCatalog, type RegistryRecipe } from '@silkweave/box-core/recipe-registry'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { commandError, commandSuccess, commandWarning } from './command-ui.js'
import { isMain, repoRoot } from './repo.js'

const RECIPE_USAGE = 'Expected: box recipe list [--json], or box recipe fetch <id> [--version <sha>] [--quiet]'
const REGISTRY_USAGE = 'Expected: box registry status, box registry key [--stdin], or box registry key --clear'

export type RecipeCommand =
  | { verb: 'list'; json: boolean }
  | { verb: 'fetch'; id: string; version?: string; quiet: boolean }

export function parseRecipeArgs(argv: readonly string[]): RecipeCommand {
  const [verb, ...args] = argv
  if (verb === 'list') {
    const extra = args.filter(arg => arg !== '--json')
    if (extra.length) throw new Error(`Unknown option ${extra[0]}. ${RECIPE_USAGE}`)
    return { verb, json: args.includes('--json') }
  }
  if (verb !== 'fetch') throw new Error(RECIPE_USAGE)
  let id: string | undefined
  let version: string | undefined
  let quiet = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--quiet' || arg === '-q') quiet = true
    else if (arg === '--version') version = args[++index]
    else if (arg.startsWith('--version=')) version = arg.slice('--version='.length)
    else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}. ${RECIPE_USAGE}`)
    else if (id === undefined) id = arg
    else throw new Error(`One recipe at a time. ${RECIPE_USAGE}`)
  }
  if (!id) throw new Error(`Name the recipe to fetch. ${RECIPE_USAGE}`)
  if (version !== undefined && !/^[0-9a-f]{40}$/.test(version)) throw new Error('--version needs a registry version (the 40-character SHA box recipe list shows)')
  return { verb: 'fetch', id, ...(version ? { version } : {}), quiet }
}

const registryOf = (root: string): BoxRegistry => readBoxConfig(root).registry

export function formatCatalog(recipes: readonly RegistryRecipe[], root: string): string[] {
  const config = readBoxConfig(root)
  const lines: string[] = []
  const width = Math.max(4, ...recipes.map(r => r.id.length))
  for (const recipe of recipes) {
    const latest = recipe.versions.find(v => v.version === recipe.latest)
    const adapted = config.recipes[recipe.id]
    const local = existsSync(join(root, 'recipes', recipe.id, 'RECIPE.md'))
    const state = adapted ? `adapted${adapted.version ? ` at ${adapted.version.slice(0, 7)}${adapted.version !== recipe.latest ? ', update available' : ''}` : ''}` : local ? 'docs in this Box' : 'available'
    lines.push(`${recipe.id.padEnd(width)}  ${recipe.latest.slice(0, 7)}  ${recipe.title}  (${state})${latest?.powerups.length ? `  powerups: ${latest.powerups.join(', ')}` : ''}`)
  }
  return lines
}

/** Read one line showing a dot per character instead of the text (a TTY), or all of stdin (a pipe). */
export async function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin
  if (!stdin.isTTY) {
    let data = ''
    for await (const chunk of stdin) data += String(chunk)
    return data.trim()
  }
  process.stderr.write(prompt)
  return await new Promise<string>((resolve, reject) => {
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const done = (error?: Error): void => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      process.stderr.write('\n')
      if (error) reject(error)
      else resolve(value.trim())
    }
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return done()
        if (char === '\u0003') return done(new Error('cancelled'))
        if (char === '\u007f' || char === '\b') {
          if (value) process.stderr.write('\b \b')
          value = value.slice(0, -1)
        } else if (char >= ' ') {
          value += char
          process.stderr.write('•')
        }
      }
    }
    stdin.on('data', onData)
  })
}

const KEY = /^[A-Za-z0-9_-]{16,200}$/

/** Check `token` against the registry and store it in box.local.json. Returns the recipe counts. */
export async function setRegistryKey(root: string, token: string): Promise<{ withKey: number; open: number }> {
  if (!KEY.test(token)) throw new Error('That does not look like an access key (letters, digits, _ and -, as issued). Nothing was saved.')
  const { url } = registryOf(root)
  let counts: { withKey: number; open: number }
  try {
    counts = await checkRegistryKey({ url, token })
  } catch (error) {
    if (error instanceof RegistryError && error.code === 'key-rejected') throw new Error('The registry did not accept this key (mistyped, expired or revoked). Nothing was saved.', { cause: error })
    throw error
  }
  writeBoxLocal(root, { registry: { token } })
  return counts
}

async function recipeMain(argv: readonly string[], root: string): Promise<number> {
  const command = parseRecipeArgs(argv)
  const registry = registryOf(root)
  if (command.verb === 'list') {
    const recipes = await registryCatalog(registry)
    if (command.json) console.log(JSON.stringify(recipes, null, 2))
    else for (const line of formatCatalog(recipes, root)) console.log(line)
    return 0
  }
  const fetched = await fetchRecipe(root, registry, command.id, command.version).catch((error: unknown) => {
    if (error instanceof RegistryError && error.code === 'not-found' && !registry.token) {
      throw new Error(`${(error as Error).message}. If you have an access key, set it with: box registry key`, { cause: error })
    }
    throw error
  })
  if (command.quiet) { console.log(fetched.path); return 0 }
  console.log(`path      ${fetched.path}`)
  console.log(`recipe    ${fetched.id}`)
  console.log(`version   ${fetched.version}`)
  console.log(`sha256    ${fetched.sha256}`)
  console.log(`powerups  ${fetched.powerups.join(', ') || 'none'}`)
  console.log(`docs      ${join(fetched.path, 'recipes', fetched.id)}`)
  console.log(`source    ${join(fetched.path, 'features', fetched.id)}`)
  console.log(`state     ${fetched.downloaded ? 'downloaded and verified' : 'already cached (verified)'}`)
  return 0
}

async function registryMain(argv: readonly string[], root: string): Promise<number> {
  const [verb, ...args] = argv
  if (verb === 'status' && !args.length) {
    const registry = registryOf(root)
    console.log(`url       ${registry.url}`)
    console.log(`key       ${registry.token ? 'set (box.local.json)' : 'not set'}`)
    try {
      const recipes = await registryCatalog(registry)
      console.log(`recipes   ${recipes.length} available to this Box`)
    } catch (error) {
      console.log(`recipes   unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
    console.log(`cache     ${join(root, RECIPE_CACHE_DIR)}`)
    return 0
  }
  if (verb === 'key' && args.length === 1 && args[0] === '--clear') {
    removeBoxLocal(root, ['registry', 'token'])
    commandSuccess('Access key removed from box.local.json. Adapted recipes keep working.')
    return 0
  }
  if (verb === 'key' && (args.length === 0 || (args.length === 1 && args[0] === '--stdin'))) {
    const token = await readSecret('Paste your access key (shown as dots), then press Enter: ')
    if (!token) { commandWarning('No key entered. Nothing was saved.'); return 1 }
    const { withKey, open } = await setRegistryKey(root, token)
    commandSuccess(`Key saved. This Box can now adapt ${withKey} recipes (${withKey - open} beyond the open ones).`)
    return 0
  }
  throw new Error(REGISTRY_USAGE)
}

export async function main(argv: readonly string[], root: string = repoRoot): Promise<number> {
  const [group, ...rest] = argv
  try {
    if (group === 'recipe') return await recipeMain(rest, root)
    if (group === 'registry') return await registryMain(rest, root)
    throw new Error(`${RECIPE_USAGE}\n${REGISTRY_USAGE}`)
  } catch (error) {
    commandError(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2))
