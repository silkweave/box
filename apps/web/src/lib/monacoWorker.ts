import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

type MonacoWorkerEnvironment = {
  getWorker?: (workerId: string, label: string) => Worker | Promise<Worker>
}

const browser = globalThis as typeof globalThis & { MonacoEnvironment?: MonacoWorkerEnvironment }

/**
 * Monaco is loaded lazily by WorkerDeck's file editor. Configure its worker factory from the
 * Builder route before that dynamic import runs, so Vite emits a base-aware local worker instead
 * of Monaco guessing a worker URL. Each built-in language service gets its own matching worker.
 */
export function configureBuilderMonacoWorker(): void {
  if (browser.MonacoEnvironment?.getWorker) return
  browser.MonacoEnvironment = {
    ...browser.MonacoEnvironment,
    getWorker: (_workerId, label) => {
      if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker()
      if (label === 'json') return new JsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
      return new EditorWorker()
    },
  }
}
