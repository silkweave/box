#!/usr/bin/env node
// Install the present features' skills into `.claude/skills/`, where Claude Code looks for them.
//
//   pnpm skills          symlink every installed feature's skills into .claude/skills/
//                        and .agents/skills/
//   pnpm skills --check  fail (exit 1) if the links are stale, naming what is wrong
//
// WHY THIS EXISTS. A feature's skills live with the feature, at `features/<id>/skills/<name>/`,
// because they belong to the feature: delete the feature and its recipes go with it,
// which is the same rule SPEC.md and AGENT.md follow. But Claude Code discovers skills in
// `.claude/skills/` and nowhere else, so until 2026-09-14 all nine of them were inert directories
// - shipped, documented in `docs/FEATURES.md`, and impossible for anyone to actually invoke.
//
// SYMLINKS, NOT COPIES. A copy is a second source of truth that silently rots the moment someone
// edits the real one, and the edit a person makes is always to the file they found by grepping -
// which is the one under `features/`. A link cannot drift. The cost is that `.claude/skills/` is
// not portable to a machine that does not have this checkout, which is fine: it is generated, and
// it is gitignored for the same reason the other registries are generated rather than hand-kept.
//
// `setup-box` is NOT managed here. It is core's own skill, it is committed, and it has to work on
// a clone before anything has been installed or generated - which is exactly when someone needs it.
//
// A SKILL DECLARES EVERY FEATURE IT DRIVES, not just the one that ships it (2026-09-15). Until then
// this script asked one question - is the OWNING feature's code installed - and two of the nine
// skills reach past their owner: `consult` routes into engagement's `/engage`, and `ingest-sink`
// reads `data/docs/sink/` and writes planning initiatives and tasks, while content declares
// `dependsOn: ['data', 'planning']` and NOT sink. So a Box with content and no sink installed a
// skill whose entire input source did not exist. That is the same failure the comment above
// describes - a skill that still resolves, that an agent still invokes, and that then calls tools
// the Box does not serve - one level out, and it survived the 2026-09-14 fix because that fix only
// closed the owner case.
//
// The declaration is a `requires:` list in the SKILL.md frontmatter, defaulting to the owner alone.
// `lint:deps` does this for code and refused to be optional about it; there is no reason a recipe
// that drives four features should be held to a looser rule than a file that imports one.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { repoRoot } from './repo.ts'

const root = repoRoot
const featuresDir = join(root, 'features')
const skillsDir = join(root, '.claude', 'skills')

/**
 * Both agents discover skill DIRECTORIES: Claude Code in `.claude/skills/`, Codex in
 * `.agents/skills/`. Link the whole directory so supporting files stay available too.
 * Both use the same `requires:` gating and the same source recipes.
 * Core skill links are committed for discovery before install; feature links are generated.
 */
const codexDir = join(root, '.agents', 'skills')

/**
 * Skills this repo owns directly rather than generating - committed, and never touched here.
 *
 * `setup-box` has to work on a clone before anything is installed. `consult` joined it on
 * 2026-09-15: 130 of its 252 lines are access tokens and MCP connectivity, it routes across seven
 * features, and it shipped with `content` purely by accident of history - so a Box that dropped
 * content also dropped its own answer to "I can't log in" and "my MCP won't connect", which the
 * skill itself calls the most common self-inflicted outage. A concierge that only exists when one
 * particular feature does is not a concierge. It degrades instead: it reads the installed set and
 * routes only to flows this Box actually has.
 */
const CORE_SKILLS = new Set(['setup-box', 'consult', 'adapt', 'upgrade', 'verify'])

const check = process.argv.includes('--check')

/**
 * The `requires:` frontmatter list, or null when absent (meaning "just my owner").
 *
 * Parsed textually because this has to run before anything
 * type-checks and there is no YAML dependency in this repo. Both spellings YAML allows are read:
 * `requires: [a, b]` and a block list of `  - a`.
 */
function readRequires(skillMd: string): string[] | null {
  const text = readFileSync(skillMd, 'utf8')
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!fm) return null
  const inline = /^requires:[ \t]*\[([^\]]*)\][ \t]*$/m.exec(fm[1])
  if (inline) return [...inline[1].matchAll(/[a-z0-9-]+/g)].map((m) => m[0])
  const block = /^requires:[ \t]*\r?\n((?:[ \t]*-[ \t]*[a-z0-9-]+[ \t]*\r?\n?)+)/m.exec(fm[1])
  if (block) return [...block[1].matchAll(/-[ \t]*([a-z0-9-]+)/g)].map((m) => m[1])
  return null
}

/**
 * Is the feature's CODE installed? Not "are its docs present" - removing a feature deletes the three
 * source directories and deliberately LEAVES `features/<id>/`, because the SPEC and the AGENT
 * recipe are documentation and outlive the code.
 *
 * Keying on the docs was this script's first bug, caught by the blank-slate proof on 2026-09-14:
 * strip every feature core directory and all nine skills still installed, which is the exact failure the
 * script exists to prevent - a skill that still resolves, that an agent still invokes, and that
 * then calls MCP tools the Box no longer serves.
 *
 * A feature is present iff its shared core manifest exists.
 */
const codeInstalled = (id: string): boolean => existsSync(join(root, 'features', id, 'core', 'manifest.ts'))

/** A directory to link: the name it is installed under, and the source directory it points at. */
type Linkable = { name: string; from: string }

/** A feature's own skill, which additionally knows which feature ships it. */
type FeatureSkill = Linkable & { id: string }

/** Every `features/<id>/skills/<name>` that carries a SKILL.md, as `{ id, name, from }`. */
const skipped: { id: string; name: string; missing: string[] }[] = []

function discover(): FeatureSkill[] {
  if (!existsSync(featuresDir)) return []
  const out: FeatureSkill[] = []
  for (const id of readdirSync(featuresDir).sort()) {
    const dir = join(featuresDir, id, 'skills')
    if (!existsSync(dir)) continue
    if (!codeInstalled(id)) continue
    for (const name of readdirSync(dir).sort()) {
      const from = join(dir, name)
      const skillMd = join(from, 'SKILL.md')
      if (!existsSync(skillMd)) continue
      if (CORE_SKILLS.has(name)) {
        console.error(`skills: ${id} ships a skill called "${name}", which collides with a core skill`)
        process.exit(1)
      }
      const requires = readRequires(skillMd) ?? [id]
      // An id nobody here has heard of is NOT fatal, and used to be. That check assumed a checkout
      // holding the whole catalogue, where an unrecognised id could only be a typo. A Box adopts
      // apps one at a time, so `content/ingest-sink` legitimately requires `sink` on a Box that
      // has never installed it; failing there broke `pnpm install` immediately after a feature
      // integration, because prepare runs this script. Found by the first integration against the
      // public source tree
      // on 2026-09-17. An unsatisfiable requirement is now just unsatisfied, and the skip is
      // printed by name on every run, so a typo shows up as a skill permanently withheld for a
      // reason you can read rather than silently vanishing.
      if (!requires.includes(id)) {
        console.error(`skills: ${id}/${name} does not list its own feature "${id}" in requires`)
        process.exit(1)
      }
      const missing = requires.filter((r) => !codeInstalled(r))
      if (missing.length) {
        skipped.push({ id, name, missing })
        continue
      }
      out.push({ id, name, from })
    }
  }
  return out
}

const wanted = discover()

// Say what was withheld and why. Silence here would look identical to "that feature ships no
// skills", which is the confusion that made the 2026-09-14 bug survive a whole day.
for (const { id, name, missing } of skipped) {
  console.log(`skills: ${id}/${name} not installed - it also drives ${missing.join(', ')}, which this Box does not have`)
  // Integrate the required feature and the skill appears on the next run; that is the whole of the mechanism.
}

// A skill name has to be unique across features: it is the thing a person types.
const seen = new Set()
for (const s of wanted) {
  const key = `${s.name}`
  if (seen.has(key)) {
    console.error(`skills: two features ship a skill called "${s.name}" - names are global, rename one`)
    process.exit(1)
  }
  seen.add(key)
}

// Plan both farms before touching either. A colliding personal directory must never be
// recursively deleted, and refusing it after earlier writes leaves a half-reconciled install.
const codexWanted = [
  ...wanted,
  ...[...CORE_SKILLS].map((name) => ({ name, from: join(skillsDir, name) })),
].sort((a, b) => a.name.localeCompare(b.name))
const stale: string[] = []
const operations: (() => void)[] = []
const collisions: string[] = []
const stat = (path: string) => lstatSync(path, { throwIfNoEntry: false })

for (const [dir, desired, core] of [[skillsDir, wanted, CORE_SKILLS], [codexDir, codexWanted, new Set<string>()]] as [string, Linkable[], ReadonlySet<string>][]) {
  const directory = stat(dir)
  if (directory && (!directory.isDirectory() || directory.isSymbolicLink())) {
    collisions.push(`${relative(root, dir)} must be a real directory`)
    continue
  }
  const names = new Set(desired.map((s) => s.name))
  for (const entry of directory ? readdirSync(dir) : []) {
    if (core.has(entry) || names.has(entry)) continue
    const path = join(dir, entry)
    if (!stat(path)?.isSymbolicLink()) continue
    const target = relative(root, resolve(dir, readlinkSync(path)))
    // Only retire links in the generator's namespace. Unrelated personal links survive too.
    // The core arm reads CORE_SKILLS rather than naming the recipes: a third core skill must not
    // silently keep its stale Codex link because a regex here was never updated.
    const coreTarget = /^\.claude\/skills\/([^/]+)$/.exec(target)
    const managed = /^features\/[^/]+\/skills\/[^/]+$/.test(target) || (coreTarget && CORE_SKILLS.has(coreTarget[1]))
    if (!managed) continue
    const withheld = skipped.find((s) => s.name === entry)
    stale.push(`${relative(root, path)} (${withheld ? `requires missing ${withheld.missing.join(', ')}` : 'no installed feature requires it'})`)
    operations.push(() => rmSync(path))
  }
  for (const skill of desired) {
    const path = join(dir, skill.name)
    const entry = stat(path)
    if (entry && !entry.isSymbolicLink()) {
      collisions.push(`refusing to replace personal skill at ${relative(root, path)}`)
      continue
    }
    const target = relative(dir, skill.from)
    const current = entry ? readlinkSync(path) : null
    if (current === target && existsSync(join(skill.from, 'SKILL.md'))) continue
    const reason = !entry ? 'not installed' : current !== target ? 'points elsewhere' : 'broken target'
    stale.push(`${relative(root, path)} (${reason})`)
    operations.push(() => {
      if (entry) rmSync(path)
      mkdirSync(dir, { recursive: true })
      symlinkSync(target, path)
    })
  }
}
// Core Claude recipes are committed source directories, not generated links. Check their
// presence too so a Codex link cannot make a missing core recipe appear successfully installed.
for (const name of CORE_SKILLS) {
  if (!existsSync(join(skillsDir, name, 'SKILL.md'))) collisions.push(`missing core recipe .claude/skills/${name}/SKILL.md`)
}
if (collisions.length) {
  console.error(`skills: no links changed:\n${collisions.join('\n')}`)
  process.exit(1)
}
if (!check) for (const apply of operations) apply()

if (check) {
  if (stale.length) {
    console.error(`skills:check FAILED - run \`pnpm skills\`:\n  ${stale.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`skills:check: ${wanted.length} feature skill(s) + ${codexWanted.length} Codex skill(s) installed and current`)
} else {
  const n = wanted.length
  console.log(
    stale.length
      ? `skills: ${n} feature skill(s) into .claude/skills/, ${codexWanted.length} skill(s) into .agents/skills/ (${stale.length} change(s))`
      : `skills: ${n} feature skill(s) and ${codexWanted.length} Codex skill(s) already installed and current`,
  )
}
