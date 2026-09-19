import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

/**
 * Fine-grained shiki for read-only code blocks in chat messages: the core plus exactly the grammars
 * a small engineering team pastes, each behind its own dynamic import. The full bundle carries every
 * language shiki supports and would dominate the app's download for a feature used a few times a day.
 *
 * Why shiki here when the repo already has prismjs: prism is wired to `react-simple-code-editor` for
 * the task-metadata JSON EDITOR (one language, one surface). Chat is read-only, multi-language, and
 * `globals.css` already carries the `.cp-shiki` dual-theme rules that consume the CSS-variable output
 * `defaultColor: false` emits below - so the theming contract for this exact renderer predates it.
 *
 * The JavaScript regex engine, not oniguruma, so there is no WASM fetch to get wrong behind the proxy.
 */
const grammars = {
  bash: () => import('@shikijs/langs/bash'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  docker: () => import('@shikijs/langs/docker'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsx: () => import('@shikijs/langs/jsx'),
  markdown: () => import('@shikijs/langs/markdown'),
  python: () => import('@shikijs/langs/python'),
  rust: () => import('@shikijs/langs/rust'),
  sql: () => import('@shikijs/langs/sql'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  yaml: () => import('@shikijs/langs/yaml'),
} as const

type Grammar = keyof typeof grammars

/** Fence tags people actually type, mapped onto the grammars above. */
const aliases: Record<string, Grammar> = {
  bash: 'bash',
  c: 'java',
  css: 'css',
  diff: 'diff',
  docker: 'docker',
  dockerfile: 'docker',
  go: 'go',
  html: 'html',
  java: 'java',
  javascript: 'javascript',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  markdown: 'markdown',
  md: 'markdown',
  patch: 'diff',
  py: 'python',
  python: 'python',
  rs: 'rust',
  rust: 'rust',
  sh: 'bash',
  shell: 'bash',
  sql: 'sql',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  typescript: 'typescript',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

let highlighterPromise: Promise<HighlighterCore> | null = null

function getHighlighter(): Promise<HighlighterCore> {
  // Memoized on the module, not per component: every code block in the room shares one registry,
  // and re-entrant calls during load await the same promise.
  highlighterPromise ??= createHighlighterCore({
    themes: [import('@shikijs/themes/vitesse-light'), import('@shikijs/themes/vitesse-dark')],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  })
  return highlighterPromise
}

export interface HighlightResult {
  /** shiki output. Its tokenizer escapes the source, so this is safe to inject as HTML. */
  html: string
  /** The grammar actually used, or null when the fence had no tag we recognise. */
  language: Grammar | null
}

export async function highlight(code: string, fence: string | null): Promise<HighlightResult> {
  const highlighter = await getHighlighter()
  const language = fence ? (aliases[fence.toLowerCase()] ?? null) : null

  if (language && !highlighter.getLoadedLanguages().includes(language)) {
    await highlighter.loadLanguage(await grammars[language]())
  }

  const html = highlighter.codeToHtml(code, {
    lang: language ?? 'text',
    themes: { light: 'vitesse-light', dark: 'vitesse-dark' },
    // Emit both themes as CSS variables and pick in CSS (the `.cp-shiki` rules in globals.css), so
    // flipping `data-theme` reskins every already-rendered block without re-tokenizing.
    defaultColor: false,
  })

  return { html, language }
}
