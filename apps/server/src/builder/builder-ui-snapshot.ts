import { diagnostic, errorKind } from '../diagnostics/runtime.js'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import type { ServerResponse } from 'node:http'

const commands = new Map<ChildProcess, Promise<void>>()
export function runBuilderCommand(root: string, args: string[], options: { onOutput?: (text: string) => void } = {}): Promise<void> {
  const started = performance.now()
  const commandId = randomUUID()
  diagnostic('builder-command', 'start', { commandId, command: args[0], task: args[1] })
  const child = spawn(process.execPath, ['--no-env-file', ...args], { cwd: root, detached: true, stdio: options.onOutput ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] })
  if (options.onOutput) {
    child.stdout?.on('data', data => options.onOutput!(String(data)))
    child.stderr?.on('data', data => options.onOutput!(String(data)))
  }
  const result = new Promise<void>((resolveCommand, reject) => {
    child.once('error', error => { diagnostic('builder-command', 'error', { commandId, error: errorKind(error) }); reject(error) })
    child.once('exit', (code, signal) => {
      diagnostic('builder-command', 'exit', { commandId, childPid: child.pid, code, signal, durationMs: Math.round(performance.now() - started) })
      if (code === 0) resolveCommand()
      else reject(new Error(`Command failed (${code}): bun ${args.join(' ')}`))
    })
  })
  commands.set(child, result)
  return result.finally(() => { commands.delete(child) })
}
export async function stopBuilderCommands(): Promise<void> {
  await Promise.allSettled([...commands].map(async ([child, completion]) => {
    const kill = (signal: NodeJS.Signals): void => {
      if (!child.pid) return
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal) } catch { /* child already exited */ }
    }
    kill('SIGTERM')
    const timer = setTimeout(() => kill('SIGKILL'), 2_000)
    try { await completion } finally { clearTimeout(timer) }
  }))
}

const VERSION = /^[a-f0-9-]{36}$/

export function builderUiVersion(root: string | undefined): string | null {
  return root && VERSION.test(basename(root)) ? basename(root) : null
}

export function currentBuilderUi(instance: string): string | undefined {
  const parent = join(instance, 'builder')
  try {
    const version = readFileSync(join(parent, 'ui-current'), 'utf8').trim()
    const directory = join(parent, 'ui-releases', version)
    if (VERSION.test(version) && existsSync(join(directory, 'index.html'))) return directory
  } catch { /* A first boot or an older instance has no version pointer. */ }
  for (const name of ['ui', 'ui-previous']) {
    const directory = join(parent, name)
    if (existsSync(join(directory, 'index.html'))) return directory
  }
  return undefined
}

/** Publish only complete builds. Older releases stay available to tabs with lazy-loaded assets. */
export async function prepareBuilderUi(root: string, instance: string, options: {
  fallback?: boolean
  build?: typeof runBuilderCommand
} = {}): Promise<string> {
  const parent = join(instance, 'builder')
  const version = randomUUID()
  const releases = join(parent, 'ui-releases')
  const target = join(releases, version)
  const staging = join(parent, `ui-next-${version}`)
  const pointer = join(parent, `ui-current-${version}`)
  mkdirSync(releases, { recursive: true })
  const build = options.build ?? runBuilderCommand
  try {
    await build(root, ['run', '--filter', '@silkweave/box-provider-kit', 'build'])
    await build(join(root, 'apps/web'), ['run', 'build', '--mode=builder', `--base=/builder-assets/${version}/`, `--outDir=${staging}`])
    const index = join(staging, 'index.html')
    if (existsSync(join(staging, 'builder.html'))) renameSync(join(staging, 'builder.html'), index)
    if (!existsSync(index)) throw new Error('Builder UI build produced no index')
    const html = readFileSync(index, 'utf8')
    if (!html.includes('</head>')) throw new Error('Builder UI build produced invalid HTML')
    writeFileSync(index, html.replace('</head>', `<meta name="box-builder-ui" content="${version}"></head>`))
    renameSync(staging, target)
    writeFileSync(pointer, version)
    renameSync(pointer, join(parent, 'ui-current'))
    return target
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    rmSync(pointer, { force: true })
    const current = currentBuilderUi(instance)
    if (options.fallback === false || !current) throw error
    console.warn('Builder UI build failed; keeping the last working snapshot.')
    return current
  }
}
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }
export function serveBuilderUi(root: string, pathname: string, res: ServerResponse): void {
  let path: string
  let assetRoot = root
  let versioned = false
  const html = pathname === '/builder' || pathname === '/builder/'
  try {
    if (html) path = join(root, 'index.html')
    else {
      const relative = decodeURIComponent(pathname.slice('/builder-assets/'.length))
      const [version, ...parts] = relative.split('/')
      const parent = builderUiVersion(root) ? dirname(dirname(root)) : dirname(root)
      if (VERSION.test(version)) {
        assetRoot = join(parent, 'ui-releases', version)
        versioned = true
        path = resolve(assetRoot, parts.join('/'))
      } else {
        // Tabs opened before versioned snapshots continue using the original snapshot.
        assetRoot = join(parent, 'ui')
        path = resolve(assetRoot, relative)
      }
    }
  } catch { res.writeHead(400); res.end(); return }
  if (!path.startsWith(`${assetRoot}${sep}`) || !existsSync(path) || !statSync(path).isFile()) { res.writeHead(404); res.end(); return }
  if (!realpathSync(path).startsWith(`${realpathSync(assetRoot)}${sep}`)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': versioned && !html ? 'public, max-age=31536000, immutable' : 'no-store' })
  if (html) res.end(readFileSync(path))
  else createReadStream(path).pipe(res)
}
