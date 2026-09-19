import { performance } from 'node:perf_hooks'
import type { RunState, TaskState } from './tasks.ts'
import { cleanText, clip, elapsedText, paint, span, type Row, type Tone } from './ui.ts'

const phases = [
  ['Build', 'Workspace packages'], ['Prepare', 'Skills · CLI tests · generated types'],
  ['Check', 'Types · lint'], ['Validate', 'Core · server · schema'],
]
const tone = (task: TaskState): Tone => task.status === 'running' ? 'active' : task.status === 'passed' ? 'good' : task.status === 'failed' ? 'bad' : task.status === 'cancelled' ? 'warn' : 'muted'
const taskTime = (task: TaskState, now: number): number => task.status === 'running' ? now - task.started : task.elapsed
const spinner = (now: number): string => ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][Math.floor(now / 90) % 10]
const icon = (task: TaskState, now: number): string => ({ running: spinner(now), passed: '✓', failed: '✕', cancelled: '!', skipped: '-', pending: '○' })[task.status]

export function taskRows(state: RunState, target: string, height: number, details: boolean, interactive: boolean, now = performance.now()): Row[] {
  const completed = state.tasks.filter(t => t.status === 'passed').length
  const focus = state.tasks.find(t => t.status === 'running' || t.status === 'failed' || t.status === 'cancelled')
  const elapsed = state.finished ? state.elapsed : now - state.started
  const filled = Math.floor(completed / state.tasks.length * 24)
  const rows: Row[] = [
    [span('  silkweave', 'accent'), span(' / verify')],
    [span(`  ${target}`, 'muted')], [],
    [span('  '), span('━'.repeat(filled), 'accent'), span('━'.repeat(24 - filled), 'muted'), span(`  ${completed}/${state.tasks.length} checks · ${elapsedText(elapsed)}`, 'muted')], [],
  ]
  if (height < 20) {
    rows.push([span(`  ${focus ? focus.name : 'Finishing'}`, 'active')])
    rows.push([span(`  ${focus?.tail.at(-1) ?? 'Waiting for command output'}`, 'muted')])
  } else {
    for (const [name, summary] of phases) {
      const members = state.tasks.filter(t => t.phase === name)
      if (!members.length) continue
      const running = members.find(t => ['running', 'failed', 'cancelled'].includes(t.status))
      const done = members.every(t => t.status === 'passed')
      const skipped = members.every(t => t.status === 'skipped')
      const warning = members.some(t => t.warnings.length > 0)
      const phaseTone: Tone = running ? tone(running) : warning ? 'warn' : done ? 'good' : 'muted'
      const mark = running ? icon(running, now) : warning ? '!' : done ? '✓' : skipped ? '-' : '○'
      const label = running ? (state.cancelled ? 'stopping' : running.status) : done ? `${elapsedText(members.reduce((sum, t) => sum + t.elapsed, 0))}${warning ? ' · warning output' : ''}` : skipped ? 'not run' : 'queued'
      rows.push([span(`  ${mark} `, phaseTone), span(name.padEnd(11), phaseTone), span(label, 'muted')])
      if (running && height >= 24) {
        for (const task of members) rows.push([
          span(`    ${icon(task, now)} `, tone(task)), span(task.name, tone(task)),
          span(task.started ? `  ${elapsedText(taskTime(task, now))}` : '', 'muted'),
        ])
      } else if (height >= 24) rows.push([span(`    ${summary}`, 'muted')])
    }
    rows.push([])
    if (focus) {
      rows.push([span('  └ ', 'muted'), span(focus.tail.at(-1) ?? `Starting ${focus.name.toLowerCase()}`, 'active')])
      rows.push([span(`    ${focus.command}`, 'muted')])
      rows.push([span(state.cancelled ? '    Stopping command and descendants…' : now - focus.lastOutput > 8000 ? `    No new output for ${elapsedText(now - focus.lastOutput)}. Still running.` : '    Latest command output above.', 'muted')])
    }
  }
  if (details && focus) {
    const budget = Math.max(0, height - rows.length - 5)
    if (budget > 0) {
      rows.push([], [span('  OUTPUT DETAIL', 'muted')])
      for (const line of focus.tail.slice(-budget)) rows.push([span(`  ${line}`, 'muted')])
    }
  }
  rows.push([], [span(interactive ? `  d ${details ? 'hide' : 'show'} output   Ctrl+C cancel` : '  Full command output retained in logs.', 'muted')])
  return rows
}

/** Permanent scrollback receipt, including useful diagnostics even outside a TTY. */
export function taskReceipt(state: RunState, { depth = 1, columns = 100 } = {}): string {
  const completed = state.tasks.filter(t => t.status === 'passed').length
  const failed = state.tasks.find(t => t.status === 'failed')
  const cancelled = state.tasks.find(t => t.status === 'cancelled')
  const warnings = state.tasks.filter(t => t.warnings.length)
  const outcome = state.cancelled ? 'Cancelled' : failed ? `Failed at ${failed.name}` : warnings.length ? 'Verified with warning output' : 'All checks passed'
  const outcomeTone: Tone = state.cancelled ? 'warn' : failed ? 'bad' : warnings.length ? 'warn' : 'good'
  const mark = state.cancelled ? '!' : failed ? '✕' : '✓'
  const rows: Row[] = [
    [], [span('  silkweave', 'accent'), span(' / verify', 'muted')], [],
    [span(`  ${mark} ${outcome}`, outcomeTone)],
    [span(`    ${completed}/${state.tasks.length} checks · ${elapsedText(state.elapsed)}`, 'muted')], [],
  ]
  for (const [name] of phases) {
    const members = state.tasks.filter(t => t.phase === name)
    if (!members.length) continue
    const passed = members.filter(t => t.status === 'passed').length
    const hasFailure = members.some(t => t.status === 'failed')
    const hasWarning = members.some(t => t.warnings.length)
    const wasCancelled = members.some(t => t.status === 'cancelled')
    const done = passed === members.length
    const phaseTone: Tone = hasFailure ? 'bad' : hasWarning || wasCancelled ? 'warn' : done ? 'good' : 'muted'
    const phaseMark = hasFailure ? '✕' : wasCancelled ? '!' : done ? '✓' : '-'
    const status = done ? `${passed}/${members.length} passed` : hasFailure ? 'failed' : wasCancelled ? 'cancelled' : 'not run'
    rows.push([
      span(`  ${phaseMark} `, phaseTone), span(name.padEnd(11), phaseTone),
      span(status.padEnd(12), 'muted'),
      span(elapsedText(members.reduce((sum, t) => sum + t.elapsed, 0)).padStart(8), 'muted'),
      ...(hasWarning ? [span('  !', 'warn')] : []),
    ])
  }
  const stopped = failed ?? cancelled
  if (stopped) {
    rows.push([], [span(`  $ ${stopped.command}`, 'accent')], [span(`  ${stopped.signal ? `Signal: ${stopped.signal}` : `Exit: ${stopped.exitCode ?? 'could not start'}`}`, 'muted')])
    const diagnostics = [...new Set([...stopped.diagnostics, ...stopped.tail.slice(-8)])]
    for (const line of diagnostics) rows.push([span(`  ${line}`, 'text')])
    rows.push([span(`  Inspect: ${stopped.command}`, 'accent')], [span('  Then rerun: pnpm verify', 'muted')])
  }
  if (state.cancelled || failed) {
    const skipped = state.tasks.filter(t => t.status === 'skipped')
    if (skipped.length) rows.push([span(`  Not run: ${skipped.map(t => t.name).join(', ')}`, 'muted')])
  }
  for (const task of warnings) {
    rows.push([], [span(`  ! Warning output in ${task.name}`, 'warn')])
    for (const line of task.warnings.slice(0, 2)) {
      // Drop transport prefixes, keeping the actual warning and controller/source context.
      const excerpt = cleanText(line)
        .replace(/^@[^\s]+:[^\s:]+:\s*/, '')
        .replace(/^\[Nest\]\s+\d+\s+-\s+.*?\bWARN\s+(?:\[[^\]]+\]\s*)?/, '')
      rows.push([span(`    ${clip(excerpt, Math.max(12, Math.min(104, columns - 5)))}`, 'muted')])
    }
  }
  // Keep the path intact for copying, even in narrow terminals. Logs contain full warnings.
  rows.push([], [span('Logs: ', 'accent'), span(state.logDirectory, 'muted')], [])
  return rows.map(row => row.map(part => paint(cleanText(part.text), part.tone ?? 'text', depth, 0)).join('')).join('\n')
}
