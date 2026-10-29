// `bun run test:mobile`: analyze and test every Flutter package in the checkout - the framework
// (packages/mobile), the app (apps/mobile) and each feature module (features/<id>/mobile). The
// Flutter SDK is optional for a Box, so without `flutter` on PATH this reports a skip and passes;
// install Flutter to make the mobile app part of the verified chain. See docs/MOBILE.md.
//
// A package whose inputs match its last passing check is skipped: its tracked and untracked
// (not ignored) files, those of every local path dependency it reaches, and the Flutter version.
// `--force` checks every package again.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { isMain, repoRoot } from './repo.ts'

/** Flutter package directories in check order: framework, modules, then the app that joins them. */
export function mobilePackages(root: string): string[] {
  const features = join(root, 'features')
  const modules = existsSync(features)
    ? readdirSync(features).sort().map(id => join(features, id, 'mobile')).filter(dir => existsSync(join(dir, 'pubspec.yaml')))
    : []
  return [join(root, 'packages/mobile'), ...modules, join(root, 'apps/mobile')].filter(dir => existsSync(join(dir, 'pubspec.yaml')))
}

/** Local `path:` dependencies named in a package's pubspec.yaml, as absolute directories. */
export function pathDependencies(dir: string): string[] {
  const pubspec = readFileSync(join(dir, 'pubspec.yaml'), 'utf8')
  return [...pubspec.matchAll(/^\s+path:\s*['"]?([^'"#\s]+)/gm)].map(match => resolve(dir, match[1]!))
}

/** Files git would track in `dir`: tracked plus untracked, without ignored output. Null outside git. */
function packageFiles(root: string, dir: string): string[] | null {
  const result = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard', '--', relative(root, dir) || '.'], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) return null
  return result.stdout.split('\0').filter(Boolean).sort()
}

/**
 * Content hash of what a package check depends on: its own files and those of every path
 * dependency it reaches, plus the Flutter version. Null when the files cannot be listed.
 */
export function packageHash(root: string, dir: string, flutterVersion: string): string | null {
  const hash = createHash('sha256').update(flutterVersion)
  const seen = new Set<string>()
  const visit = (pkg: string): boolean => {
    if (seen.has(pkg) || !existsSync(join(pkg, 'pubspec.yaml'))) return true
    seen.add(pkg)
    const files = packageFiles(root, pkg)
    if (!files) return false
    for (const file of files) {
      const path = join(root, file)
      // A tracked file deleted in the working tree is part of the change, not an error.
      hash.update(`\0${file}\0`).update(existsSync(path) ? readFileSync(path) : '<deleted>')
    }
    return pathDependencies(pkg).every(visit)
  }
  return visit(dir) ? hash.digest('hex') : null
}

const cacheFile = (root: string): string => join(root, 'node_modules', '.cache', 'silkweave-mobile.json')
function readCache(root: string): Record<string, string> {
  try { return JSON.parse(readFileSync(cacheFile(root), 'utf8')) as Record<string, string> } catch { return {} }
}
function writeCache(root: string, cache: Record<string, string>): void {
  try { mkdirSync(dirname(cacheFile(root)), { recursive: true }); writeFileSync(cacheFile(root), JSON.stringify(cache) + '\n') }
  catch { /* The cache only saves time. */ }
}

function flutter(args: string[], cwd: string): boolean {
  const result = spawnSync('flutter', args, { cwd, stdio: 'inherit' })
  return result.status === 0
}

export function main(root = repoRoot, { force = false } = {}): number {
  const packages = mobilePackages(root)
  if (!packages.length) { process.stdout.write('mobile: no Flutter packages in this checkout\n'); return 0 }
  const version = spawnSync('flutter', ['--version', '--machine'], { encoding: 'utf8' })
  if (version.error) {
    process.stdout.write(`mobile: skipped, flutter is not installed (${packages.length} packages unchecked)\n`)
    return 0
  }
  const cache = readCache(root)
  let failed = 0, unchanged = 0
  for (const dir of packages) {
    const name = relative(root, dir)
    const hash = packageHash(root, dir, version.stdout)
    if (!force && hash && cache[name] === hash) {
      unchanged++
      process.stdout.write(`== ${name}: unchanged since its last passing check\n`)
      continue
    }
    process.stdout.write(`\n== ${name}\n`)
    // Flutter 3.47 copies Swift Package plugins into build/ios/SourcePackages during `pub get` and
    // fails ("Failed to copy plugin") when that directory does not exist yet.
    if (existsSync(join(dir, 'ios'))) mkdirSync(join(dir, 'build/ios/SourcePackages'), { recursive: true })
    const ok = flutter(['pub', 'get'], dir)
      && flutter(['analyze', '--no-pub'], dir)
      && (!existsSync(join(dir, 'test')) || flutter(['test', '--no-pub', '--reporter=compact'], dir))
    if (ok && hash) cache[name] = hash
    else delete cache[name]
    if (!ok) { failed++; process.stdout.write(`mobile: ${name} FAILED\n`) }
  }
  writeCache(root, cache)
  process.stdout.write(`\nmobile: ${packages.length - failed}/${packages.length} packages passed${unchanged ? `, ${unchanged} unchanged` : ''}\n`)
  // The Turbo summary format, so verify reports a run that checked nothing as cached.
  if (unchanged === packages.length) process.stdout.write(`Cached:    ${unchanged} cached, ${packages.length} total\n`)
  return failed ? 1 : 0
}

if (isMain(import.meta.url)) process.exitCode = main(repoRoot, { force: process.argv.includes('--force') })
