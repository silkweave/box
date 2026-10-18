// Work access: what a member's Work session (the sidebar agent) may touch. docs/AUTH.md § Work
// sessions.
//
// Admins are not subject to any of this; an admin's Work session runs in the checkout as before.
// For a member the session's working directory is their own sandbox (`data/work/<user>/`), and the
// tool guard below allows file tools only inside the granted roots (the sandbox and the admin-set
// folders) and refuses shell commands that reach the checkout, `data/config`, git history or the
// `box` CLI. The settings live on the user row (`users.work`, JSON) and are read at session start
// and again on every guarded tool call, so an admin's change applies to a running session.
//
// This module is pure: path and command classification only, with the filesystem injected, so the
// server's hook and the tests share one decision. "Strong but not absolute": the shell runs as the
// server's OS user, and a hard guarantee needs a separate OS user or container.

import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { dataPath, repoRoot } from './io.js'

/** Per-user Work capabilities, the four checkboxes of Settings > Users. */
export interface WorkAccess {
  /** Work sessions may be started at all. */
  enabled: boolean
  /** "Work with all data and modules": the session gets the Box MCP tools. */
  data: boolean
  /** "Work in user-specific sandbox folder": `data/work/<user>/` is a granted root. */
  sandbox: boolean
  /** "Work in selected folders": `folder_paths` are granted roots. */
  folders: boolean
  /** Admin-set absolute directories, used only when `folders` is on. */
  folder_paths: string[]
}

export const DEFAULT_WORK_ACCESS: WorkAccess = { enabled: true, data: true, sandbox: true, folders: false, folder_paths: [] }

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

/** The stored JSON (or anything else) narrowed to a complete WorkAccess; unknown keys are dropped. */
export function normalizeWorkAccess(raw: unknown): WorkAccess {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_WORK_ACCESS, folder_paths: [] }
  const r = raw as Record<string, unknown>
  const paths = Array.isArray(r.folder_paths)
    ? [...new Set(r.folder_paths.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim()))]
    : []
  return {
    enabled: bool(r.enabled, DEFAULT_WORK_ACCESS.enabled),
    data: bool(r.data, DEFAULT_WORK_ACCESS.data),
    sandbox: bool(r.sandbox, DEFAULT_WORK_ACCESS.sandbox),
    folders: bool(r.folders, DEFAULT_WORK_ACCESS.folders),
    folder_paths: paths,
  }
}

/** A member's sandbox: inside the instance dir, so inside the worker's allowed cwd roots. */
export function workSandboxDir(userId: string): string {
  return dataPath('work', userId)
}

/** Filesystem facts the classification needs, injected so tests need no disk. */
export interface WorkFs {
  isDirectory: (path: string) => boolean
  /** Canonical path of an EXISTING path (fs.realpathSync). */
  realpath: (path: string) => string
  /** Names of the directories directly inside an existing directory (fs.readdirSync, dirs only). */
  listDirectories: (dir: string) => string[]
}

/** True when `path` is `root` or below it. Both must already be absolute and canonical. */
export function insideRoot(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Canonical form of an absolute path that may not exist yet: the nearest existing ancestor is
 * resolved through symlinks and the remainder re-appended, so a link planted inside a root cannot
 * point the guard elsewhere.
 */
export function canonicalPath(path: string, fs: WorkFs): string {
  let existing = path
  let rest = ''
  for (;;) {
    try {
      const real = fs.realpath(existing)
      return rest ? join(real, rest) : real
    } catch {
      const parent = dirname(existing)
      if (parent === existing) return path
      rest = rest ? join(existing.slice(parent.length + 1), rest) : existing.slice(parent.length + 1)
      existing = parent
    }
  }
}

/**
 * Why `path` cannot be an admin-set Work folder, or null when it can. Absolute, no `..`, an
 * existing directory, and neither the checkout nor the instance dir (those are what Work protects).
 */
export function workFolderProblem(path: string, fs: WorkFs, roots: { checkout?: string; instance?: string } = {}): string | null {
  const checkout = roots.checkout ?? repoRoot()
  const instance = roots.instance ?? dataPath()
  if (!isAbsolute(path)) return `"${path}" is not an absolute path`
  if (path.split(/[\\/]/).includes('..')) return `"${path}" contains ".."`
  if (!fs.isDirectory(path)) return `"${path}" is not an existing directory`
  const real = canonicalPath(path, fs)
  if (insideRoot(real, canonicalPath(instance, fs))) return `"${path}" is inside the Box instance data`
  if (insideRoot(real, canonicalPath(checkout, fs))) return `"${path}" is inside the Box checkout`
  return null
}

/**
 * Why `path` cannot be created as a Work folder, or null when it can: the same bounds as
 * `workFolderProblem` for a directory that does not exist yet and whose parent does. Creation is
 * one level only, so the admin sees exactly the folder they named appear.
 */
export function workFolderCreateProblem(path: string, fs: WorkFs, roots: { checkout?: string; instance?: string } = {}): string | null {
  const checkout = roots.checkout ?? repoRoot()
  const instance = roots.instance ?? dataPath()
  if (!isAbsolute(path)) return `"${path}" is not an absolute path`
  if (path.split(/[\\/]/).includes('..')) return `"${path}" contains ".."`
  if (path.endsWith(sep) || basename(path) === '') return `"${path}" has no folder name`
  if (fs.isDirectory(path)) return `"${path}" already exists`
  if (!fs.isDirectory(dirname(path))) return `the parent of "${path}" is not an existing directory`
  const real = canonicalPath(path, fs)
  if (insideRoot(real, canonicalPath(instance, fs))) return `"${path}" is inside the Box instance data`
  if (insideRoot(real, canonicalPath(checkout, fs))) return `"${path}" is inside the Box checkout`
  return null
}

/** What the folder picker offers for a partial path. */
export interface WorkFolderSuggestions {
  /** The directory whose children were listed, or null when `query` names none. */
  parent: string | null
  /** Grantable directories under `parent` whose name starts with the typed remainder, absolute. */
  directories: string[]
  /** The typed path when it could be created as a Work folder (parent exists, in bounds), else null. */
  create: string | null
}

/**
 * Directories an admin could pick that complete `query`: the children of the typed path's parent
 * (the path itself when it ends with a separator) whose name starts with the remainder. Only
 * directories `workFolderProblem` would accept are listed, so the picker never shows what the
 * admin could not type by hand. Dot-directories appear only when the remainder starts with a dot.
 */
export function workFolderSuggestions(
  query: string,
  fs: WorkFs,
  roots: { checkout?: string; instance?: string } = {},
  limit = 25,
): WorkFolderSuggestions {
  const q = query.trim()
  const none = (create: string | null = null): WorkFolderSuggestions => ({ parent: null, directories: [], create })
  if (!isAbsolute(q) || q.split(/[\\/]/).includes('..')) return none()
  const endsWithSep = /[\\/]$/.test(q)
  const parent = endsWithSep ? resolve(q) : dirname(q)
  const prefix = endsWithSep ? '' : basename(q)
  if (!fs.isDirectory(parent)) return none()
  const create = !endsWithSep && workFolderCreateProblem(q, fs, roots) === null ? q : null
  const lower = prefix.toLowerCase()
  const directories = fs
    .listDirectories(parent)
    .filter((name) => name.toLowerCase().startsWith(lower) && (prefix.startsWith('.') || !name.startsWith('.')))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(parent, name))
    .filter((dir) => workFolderProblem(dir, fs, roots) === null)
    .slice(0, limit)
  return { parent, directories, create }
}

/** The granted roots of a session, canonical; throws on the first folder that cannot be granted. */
export function workRoots(access: WorkAccess, sandboxDir: string, fs: WorkFs): string[] {
  const roots: string[] = []
  if (access.sandbox) roots.push(canonicalPath(sandboxDir, fs))
  if (access.folders) {
    for (const p of access.folder_paths) {
      const problem = workFolderProblem(p, fs)
      if (problem) throw new Error(problem)
      roots.push(canonicalPath(p, fs))
    }
  }
  return roots
}

/**
 * The path arguments of the engine's built-in file tools. A tool not listed here is not a file tool
 * (WebFetch, Agent, the MCP tools), and the guard leaves it alone. Glob, Grep and LS default to the
 * working directory when `path` is absent.
 */
const FILE_TOOL_PATH_KEYS: Record<string, { keys: string[]; defaultsToCwd: boolean }> = {
  Read: { keys: ['file_path'], defaultsToCwd: false },
  Write: { keys: ['file_path'], defaultsToCwd: false },
  Edit: { keys: ['file_path'], defaultsToCwd: false },
  MultiEdit: { keys: ['file_path'], defaultsToCwd: false },
  NotebookEdit: { keys: ['notebook_path'], defaultsToCwd: false },
  Glob: { keys: ['path'], defaultsToCwd: true },
  Grep: { keys: ['path'], defaultsToCwd: true },
  LS: { keys: ['path'], defaultsToCwd: true },
}

/** The paths a file-tool call touches, or null when the tool is not a file tool. */
export function fileToolPaths(toolName: string, input: unknown, cwd: string): string[] | null {
  const spec = FILE_TOOL_PATH_KEYS[toolName]
  if (!spec) return null
  const rec = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const paths: string[] = []
  for (const key of spec.keys) {
    const v = rec[key]
    if (typeof v === 'string' && v.trim() !== '') paths.push(resolve(cwd, v.trim()))
  }
  if (paths.length === 0) {
    // A file tool that names no path cannot be checked: treat it as the working directory when
    // that is its documented default, otherwise as nothing (and the guard refuses it).
    if (spec.defaultsToCwd) paths.push(cwd)
  }
  return paths
}

const GIT_WRITE = /\bgit\b(?:\s+-[-\w=]+(?:\s+[^\s-]\S*)?)*\s+(?:commit|push|add|rm|mv|reset|checkout|switch|restore|stash|rebase|merge|cherry-pick|am|apply|tag|clean|notes|filter-branch|worktree|submodule|branch\s+-[dDmMf]|update-ref|symbolic-ref)\b/
const BOX_CLI = /(?:^|[\s;&|(`])(?:\.\/)?box\s+(?!--help\b|help\b)\w/
const PARENT_SEGMENT = /(?:^|[\s'"=:(,])\.\.(?:[\\/]|$|[\s'"):,])/
const DATA_CONFIG = /data[\\/]config(?:[\\/]|\b)/

/** A token following `start` in `command`: up to whitespace or a quote. */
const tokenAt = (command: string, start: number): string => {
  const rest = command.slice(start)
  const m = /^[^\s'"`;|&)]+/.exec(rest)
  return m ? m[0] : ''
}

/**
 * Why a shell command is refused in a guarded Work session, or null when it may run. Heuristic by
 * design (a shell can always be talked around); the point is that the ordinary ways of touching the
 * Box source, its history, its config and its CLI are closed rather than merely discouraged.
 */
export function bashCommandProblem(
  command: string,
  ctx: { checkout: string; roots: string[]; fs: WorkFs },
): string | null {
  const checkout = canonicalPath(ctx.checkout, ctx.fs)
  // The checkout path as a whole token or a token prefix (`/box` or `/box/...`), never a substring
  // of another word (`../box.json` is a different problem, caught below).
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const needle of new Set([ctx.checkout, checkout])) {
    const re = new RegExp(`(?:^|[\\s'"=:(,])(${escape(needle)})(?=[\\\\/\\s'"\`;|&):,]|$)`, 'g')
    for (let m = re.exec(command); m; m = re.exec(command)) {
      const start = m.index + m[0].length - m[1]!.length
      const token = tokenAt(command, start)
      const target = canonicalPath(token.replace(/[.,:;]+$/, ''), ctx.fs)
      if (!ctx.roots.some((r) => insideRoot(target, r))) return `the command names the Box checkout (${token})`
    }
  }
  if (DATA_CONFIG.test(command)) return 'the command names the Box configuration (data/config)'
  if (PARENT_SEGMENT.test(command)) return 'the command walks up with ".." (use absolute paths inside your work folders)'
  if (GIT_WRITE.test(command)) return 'git history writes are not allowed in a Work session'
  if (BOX_CLI.test(command)) return 'the box CLI is not allowed in a Work session'
  // `cd` (and pushd) to an absolute directory outside every root would turn relative paths loose.
  const cd = /(?:^|[\s;&|(])(?:cd|pushd)\s+(['"]?)(\/[^\s'"`;|&)]*)\1/g
  for (let m = cd.exec(command); m; m = cd.exec(command)) {
    const target = canonicalPath(m[2]!, ctx.fs)
    if (!ctx.roots.some((r) => insideRoot(target, r))) return `cd outside your work folders (${m[2]})`
  }
  return null
}

export type WorkToolDecision = { allow: true } | { allow: false; reason: string }

/**
 * The guard's verdict on one tool call. File tools must stay inside a granted root; Bash is
 * screened by `bashCommandProblem`; everything else passes (the engine's own permission flow and
 * the session's tool lists still apply).
 */
export function workToolDecision(
  toolName: string,
  input: unknown,
  ctx: { cwd: string; roots: string[]; checkout: string; fs: WorkFs },
): WorkToolDecision {
  const where = ctx.roots.length > 0 ? `your work folders (${ctx.roots.join(', ')})` : 'no folder (none is granted to this Work session)'
  if (toolName === 'Bash') {
    const rec = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
    const command = typeof rec.command === 'string' ? rec.command : ''
    const problem = bashCommandProblem(command, ctx)
    return problem ? { allow: false, reason: `${problem}; Work sessions may only work in ${where}` } : { allow: true }
  }
  const paths = fileToolPaths(toolName, input, ctx.cwd)
  if (paths === null) return { allow: true }
  if (paths.length === 0) return { allow: false, reason: `${toolName} without a path cannot be checked; name a path inside ${where}` }
  for (const p of paths) {
    const target = canonicalPath(p, ctx.fs)
    if (!ctx.roots.some((r) => insideRoot(target, r))) {
      return { allow: false, reason: `${p} is outside ${where}` }
    }
  }
  return { allow: true }
}

/** Separator re-exported for callers that build display paths; keeps `sep` out of the hook. */
export const WORK_PATH_SEP = sep
