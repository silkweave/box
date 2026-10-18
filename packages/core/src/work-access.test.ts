import { describe, expect, it } from 'vitest'
import {
  bashCommandProblem,
  canonicalPath,
  fileToolPaths,
  insideRoot,
  normalizeWorkAccess,
  workFolderCreateProblem,
  workFolderProblem,
  workFolderSuggestions,
  workToolDecision,
  type WorkFs,
} from './work-access.js'

/** A fake filesystem: `dirs` exist, `links` resolve to another path. */
const fakeFs = (dirs: string[], links: Record<string, string> = {}): WorkFs => ({
  isDirectory: (p) => dirs.includes(p),
  realpath: (p) => {
    if (links[p]) return links[p]!
    if (dirs.includes(p)) return p
    throw new Error('ENOENT')
  },
  listDirectories: (dir) => {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`
    return dirs.filter((d) => d.startsWith(prefix) && d.length > prefix.length && !d.slice(prefix.length).includes('/')).map((d) => d.slice(prefix.length))
  },
})

const checkout = '/box'
const sandbox = '/box/data/work/alice'
const projects = '/home/team/projects'
const fs = fakeFs([checkout, '/box/data', '/box/data/work', sandbox, '/home', '/home/team', projects, '/tmp'], {
  [`${sandbox}/escape`]: '/box/apps',
})
const ctx = { cwd: sandbox, roots: [sandbox, projects], checkout, fs }

describe('normalizeWorkAccess', () => {
  it('fills defaults and drops junk', () => {
    expect(normalizeWorkAccess(null)).toEqual({ enabled: true, data: true, sandbox: true, folders: false, folder_paths: [] })
    expect(normalizeWorkAccess({ enabled: false, folders: true, folder_paths: [' /a ', '', 3, '/a'], extra: 1 })).toEqual({
      enabled: false, data: true, sandbox: true, folders: true, folder_paths: ['/a'],
    })
  })
})

describe('paths', () => {
  it('insideRoot is prefix by segment, not by string', () => {
    expect(insideRoot('/a/b/c', '/a/b')).toBe(true)
    expect(insideRoot('/a/b', '/a/b')).toBe(true)
    expect(insideRoot('/a/bc', '/a/b')).toBe(false)
    expect(insideRoot('/a', '/a/b')).toBe(false)
  })

  it('canonicalPath resolves the nearest existing ancestor and keeps the rest', () => {
    expect(canonicalPath(`${sandbox}/new/file.txt`, fs)).toBe(`${sandbox}/new/file.txt`)
    expect(canonicalPath(`${sandbox}/escape/x.ts`, fs)).toBe('/box/apps/x.ts')
  })

  it('workFolderProblem refuses relative, dotted, missing, checkout and instance paths', () => {
    const roots = { checkout, instance: '/box/data' }
    expect(workFolderProblem('projects', fs, roots)).toMatch(/absolute/)
    expect(workFolderProblem('/home/team/../team/projects', fs, roots)).toMatch(/\.\./)
    expect(workFolderProblem('/nope', fs, roots)).toMatch(/existing directory/)
    expect(workFolderProblem('/box', fs, roots)).toMatch(/checkout/)
    expect(workFolderProblem('/box/data/work', fs, roots)).toMatch(/instance/)
    expect(workFolderProblem(projects, fs, roots)).toBeNull()
  })

  it('workFolderSuggestions lists only grantable children of the typed parent', () => {
    const roots = { checkout, instance: '/box/data' }
    const fs2 = fakeFs(['/', '/home', '/home/team', '/home/team/projects', '/home/team/.cache', '/home/team/photos', '/box', '/box/data', '/box/features'])
    expect(workFolderSuggestions('', fs2, roots)).toEqual({ parent: null, directories: [], create: null })
    expect(workFolderSuggestions('home', fs2, roots).directories).toEqual([])
    expect(workFolderSuggestions('/home/team/', fs2, roots)).toEqual({ parent: '/home/team', directories: ['/home/team/photos', '/home/team/projects'], create: null })
    expect(workFolderSuggestions('/home/team/P', fs2, roots).directories).toEqual(['/home/team/photos', '/home/team/projects'])
    expect(workFolderSuggestions('/home/team/.', fs2, roots).directories).toEqual(['/home/team/.cache'])
    // The checkout's children are never offered, nor the checkout or instance themselves.
    expect(workFolderSuggestions('/box/', fs2, roots).directories).toEqual([])
    expect(workFolderSuggestions('/', fs2, roots).directories).toEqual(['/home'])
    expect(workFolderSuggestions('/home/team/../x', fs2, roots).parent).toBeNull()
  })

  it('workFolderCreateProblem allows one new level in bounds and reports why not', () => {
    const roots = { checkout, instance: '/box/data' }
    expect(workFolderCreateProblem('/home/team/new', fs, roots)).toBeNull()
    expect(workFolderSuggestions('/home/team/new', fs, roots).create).toBe('/home/team/new')
    expect(workFolderSuggestions('/home/team/projects', fs, roots).create).toBeNull()
    expect(workFolderCreateProblem(projects, fs, roots)).toMatch(/already exists/)
    expect(workFolderCreateProblem('/home/team/a/b', fs, roots)).toMatch(/parent/)
    expect(workFolderCreateProblem('/home/team/', fs, roots)).toMatch(/no folder name/)
    expect(workFolderCreateProblem('/box/data/new', fs, roots)).toMatch(/instance/)
    expect(workFolderCreateProblem('/box/new', fs, roots)).toMatch(/checkout/)
    expect(workFolderCreateProblem('rel', fs, roots)).toMatch(/absolute/)
  })
})

describe('file tools', () => {
  it('reads path arguments and defaults search tools to cwd', () => {
    expect(fileToolPaths('Read', { file_path: 'a.txt' }, sandbox)).toEqual([`${sandbox}/a.txt`])
    expect(fileToolPaths('Grep', { pattern: 'x' }, sandbox)).toEqual([sandbox])
    expect(fileToolPaths('Write', {}, sandbox)).toEqual([])
    expect(fileToolPaths('WebFetch', { url: 'https://x' }, sandbox)).toBeNull()
  })

  it('allows inside the roots and refuses the checkout, config and symlink escapes', () => {
    expect(workToolDecision('Write', { file_path: `${sandbox}/notes.md` }, ctx)).toEqual({ allow: true })
    expect(workToolDecision('Edit', { file_path: `${projects}/app/index.ts` }, ctx)).toEqual({ allow: true })
    expect(workToolDecision('Read', { file_path: '/box/apps/server/src/main.ts' }, ctx).allow).toBe(false)
    expect(workToolDecision('Read', { file_path: '/box/data/config/agents/nova.md' }, ctx).allow).toBe(false)
    expect(workToolDecision('Write', { file_path: `${sandbox}/escape/evil.ts` }, ctx).allow).toBe(false)
    expect(workToolDecision('Read', { file_path: '../../../box.json' }, ctx).allow).toBe(false)
    expect(workToolDecision('Write', {}, ctx).allow).toBe(false)
    expect(workToolDecision('Glob', { pattern: '**/*.ts' }, ctx)).toEqual({ allow: true })
  })

  it('leaves non-file tools alone and refuses everything with no roots', () => {
    expect(workToolDecision('mcp__box__TasksList', {}, ctx)).toEqual({ allow: true })
    expect(workToolDecision('Grep', { pattern: 'x' }, { ...ctx, roots: [] }).allow).toBe(false)
  })
})

describe('bash', () => {
  const problem = (command: string, roots = ctx.roots) => bashCommandProblem(command, { checkout, roots, fs })

  it('allows ordinary work inside the roots', () => {
    expect(problem('ls -la')).toBeNull()
    expect(problem(`bun install && bun run build`)).toBeNull()
    expect(problem(`cat ${sandbox}/notes.md`)).toBeNull()
    expect(problem(`cd ${projects}/app && git status && git diff`)).toBeNull()
    expect(problem('git log --oneline -5')).toBeNull()
    expect(problem('curl -L https://example.com/file.zip -o file.zip')).toBeNull()
  })

  it('refuses the checkout, data/config, "..", git writes, the box CLI and cd outside', () => {
    expect(problem(`cat ${checkout}/box.json`)).toMatch(/checkout/)
    expect(problem(`sed -i s/a/b/ ${checkout}/apps/web/src/App.tsx`)).toMatch(/checkout/)
    expect(problem(`cat data/config/agents/nova.md`)).toMatch(/config/)
    expect(problem(`cat ../../box.json`)).toMatch(/\.\./)
    expect(problem(`cd ..`)).toMatch(/\.\./)
    expect(problem(`git add -A && git commit -m x`)).toMatch(/git/)
    expect(problem(`git push origin main`)).toMatch(/git/)
    expect(problem(`git -C /tmp/x checkout main`)).toMatch(/git/)
    expect(problem(`box verify`)).toMatch(/box CLI/)
    expect(problem(`cd /tmp && ls`)).toMatch(/cd outside/)
    expect(problem(`cd /box/apps`)).toMatch(/checkout/)
  })

  it('`box --help` and words containing box are not the CLI', () => {
    expect(problem('box --help')).toBeNull()
    expect(problem('echo toolbox value')).toBeNull()
    expect(problem('echo "the box"')).toBeNull()
  })
})
