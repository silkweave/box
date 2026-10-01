// `bun run test:mobile`: analyze and test every Flutter package in the checkout - the framework
// (packages/mobile), the app (apps/mobile) and each feature module (features/<id>/mobile). The
// Flutter SDK is optional for a Box, so without `flutter` on PATH this reports a skip and passes;
// install Flutter to make the mobile app part of the verified chain. See docs/MOBILE.md.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { isMain, repoRoot } from './repo.ts'

/** Flutter package directories in check order: framework, modules, then the app that joins them. */
export function mobilePackages(root: string): string[] {
  const features = join(root, 'features')
  const modules = existsSync(features)
    ? readdirSync(features).sort().map(id => join(features, id, 'mobile')).filter(dir => existsSync(join(dir, 'pubspec.yaml')))
    : []
  return [join(root, 'packages/mobile'), ...modules, join(root, 'apps/mobile')].filter(dir => existsSync(join(dir, 'pubspec.yaml')))
}

function flutter(args: string[], cwd: string): boolean {
  const result = spawnSync('flutter', args, { cwd, stdio: 'inherit' })
  return result.status === 0
}

export function main(root = repoRoot): number {
  const packages = mobilePackages(root)
  if (!packages.length) { process.stdout.write('mobile: no Flutter packages in this checkout\n'); return 0 }
  if (spawnSync('flutter', ['--version'], { stdio: 'ignore' }).error) {
    process.stdout.write(`mobile: skipped, flutter is not installed (${packages.length} packages unchecked)\n`)
    return 0
  }
  let failed = 0
  for (const dir of packages) {
    const name = relative(root, dir)
    process.stdout.write(`\n== ${name}\n`)
    // Flutter 3.47 copies Swift Package plugins into build/ios/SourcePackages during `pub get` and
    // fails ("Failed to copy plugin") when that directory does not exist yet.
    if (existsSync(join(dir, 'ios'))) mkdirSync(join(dir, 'build/ios/SourcePackages'), { recursive: true })
    const ok = flutter(['pub', 'get'], dir)
      && flutter(['analyze', '--no-pub'], dir)
      && (!existsSync(join(dir, 'test')) || flutter(['test', '--no-pub', '--reporter=compact'], dir))
    if (!ok) { failed++; process.stdout.write(`mobile: ${name} FAILED\n`) }
  }
  process.stdout.write(`\nmobile: ${packages.length - failed}/${packages.length} packages passed\n`)
  return failed ? 1 : 0
}

if (isMain(import.meta.url)) process.exitCode = main()
