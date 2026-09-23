import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const receipt = join(root, 'node_modules/.workerdeck-local.json')
type Link = { path: string; original: string; target: string }
type Receipt = { source: string; links: Link[] }
const saved: Receipt | undefined = existsSync(receipt) ? JSON.parse(readFileSync(receipt, 'utf8')) : undefined
const arg = process.argv[2]

if (arg === '--restore') {
  if (!saved) throw new Error('No local WorkerDeck links recorded.')
  // Check every link before changing any, so a subsequent install cannot be overwritten.
  for (const link of saved.links) {
    if (!lstatSync(link.path).isSymbolicLink() || readlinkSync(link.path) !== link.target) {
      throw new Error(`Dependency changed since linking: ${link.path}. Restore with bun install --frozen-lockfile --force instead.`)
    }
  }
  for (const link of saved.links) {
    unlinkSync(link.path)
    symlinkSync(link.original, link.path)
  }
  unlinkSync(receipt)
  console.log(`Restored ${saved.links.length} registry package links.`)
} else {
  if (!arg) throw new Error('Usage: bun scripts/workerdeck-local.ts /path/to/workerdeck | --restore')
  if (saved) throw new Error(`Already linked to ${saved.source}. Restore before changing the source.`)
  const source = realpathSync(resolve(arg))
  const packages = new Map<string, string>()
  for (const entry of readdirSync(join(source, 'packages'))) {
    const dir = join(source, 'packages', entry)
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    packages.set(pkg.name, dir)
  }
  const workspaces = [root, ...['apps', 'packages'].flatMap((folder) =>
    readdirSync(join(root, folder)).map((entry) => join(root, folder, entry)))]
  const links: Link[] = []
  for (const workspace of workspaces) {
    const scope = join(workspace, 'node_modules/@workerdeck')
    if (!existsSync(scope)) continue
    for (const entry of readdirSync(scope)) {
      const path = join(scope, entry)
      const target = packages.get(`@workerdeck/${entry}`)
      if (!target || !existsSync(join(target, 'build/index.mjs'))) throw new Error(`Build the local @workerdeck/${entry} package first.`)
      if (!lstatSync(path).isSymbolicLink()) throw new Error(`Refusing to replace a directory: ${path}`)
      links.push({ path, target, original: readlinkSync(path) })
    }
  }
  if (!links.length) throw new Error('Install Stack dependencies before linking.')
  mkdirSync(dirname(receipt), { recursive: true })
  writeFileSync(receipt, JSON.stringify({ source, links }, null, 2) + '\n')
  for (const link of links) {
    unlinkSync(link.path)
    symlinkSync(link.target, link.path)
  }
  console.log(`Linked ${links.length} dependency paths to ${source}.`)
}
console.log('Rebuild and typecheck without Turbo cache: bun run build --force && bun run typecheck --force')
