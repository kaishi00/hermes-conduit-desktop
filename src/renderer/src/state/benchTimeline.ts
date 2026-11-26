/**
 * The workbench's timeline (desktop issue 453; Eric, 2026-11-26, "B ·
 * Project mode"): what happened in the chat, in order, as steps on a
 * scrubber over the bench. Each step is something asked or something the
 * bot did: a command it ran, a file it wrote or read, a page it opened, or
 * another tool. Moving the scrubber to a step moves every view to it: the
 * chat to that step, the bot's command terminal to its command, Files to its
 * file. The bot's command terminal is the commands alone, read-only.
 *
 * Built from the chat's transcript, so it needs nothing from the plugin.
 * Kept free of React so it's tested on its own.
 */
import { t } from '../../../shared/i18n'
import { toolTitle } from './liveDoing'
import type { ToolItem, TranscriptItem } from './transcript'

export type StepKind = 'ask' | 'command' | 'edit' | 'read' | 'page' | 'step'

export interface TimelineStep {
  /** The transcript item's key: the chat reveals it by this. */
  key: string
  kind: StepKind
  title: string
  /** The command, the file, the address, or the words asked. */
  detail?: string
  at?: number
  running?: boolean
  /** A file the step wrote or read, as the bot named it. */
  path?: string
  /** A command's output, and how it ended, once it has. */
  output?: string
  exitCode?: number | null
}

const COMMANDS = new Set(['terminal', 'execute_code', 'process'])
const EDITS = new Set(['write_file', 'patch', 'edit_file', 'create_file', 'str_replace', 'apply_patch'])
const READS = new Set(['read_file', 'search_files', 'list_files'])
const PAGES = new Set(['browser_navigate', 'web_extract'])

/** A tool call's arguments, read from the card's details: the whole JSON when it is whole, else the named fields that are. */
export function toolFields(args: string | undefined): Record<string, unknown> {
  if (!args) return {}
  try {
    const parsed = JSON.parse(args) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Cut to a readable length: the fields before the cut still read.
  }
  const fields: Record<string, unknown> = {}
  for (const match of args.matchAll(/"([a-z_]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi)) {
    try {
      fields[match[1]!] = JSON.parse(`"${match[2]}"`) as string
    } catch {
      // A string cut in an escape: left out.
    }
  }
  return fields
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** Terminal colors and cursor moves, which a read-only log doesn't draw. */
export function plainOutput(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\r\n?/g, '\n')
}

/** A command's answer: its output and exit code when the tool answered JSON, else the text as it is. */
export function commandAnswer(result: string | undefined): { output?: string; exitCode?: number | null } {
  if (!result) return {}
  const fields = toolFields(result)
  const output = typeof fields.output === 'string' ? fields.output : typeof fields.stdout === 'string' ? fields.stdout : undefined
  const error = text(fields.error) ?? text(fields.stderr)
  const code = typeof fields.exit_code === 'number' ? fields.exit_code : typeof fields.returncode === 'number' ? fields.returncode : undefined
  if (output === undefined && error === undefined && code === undefined) return { output: plainOutput(result) }
  const shown = [output, error].filter((part): part is string => !!part && !!part.trim()).join('\n')
  return { output: shown ? plainOutput(shown) : undefined, exitCode: code ?? null }
}

function toolStep(item: ToolItem): TimelineStep | null {
  // A card the bot showed, or its plan: drawn in the chat, not a step of the work.
  if (item.board || item.name === 'todo') return null
  const name = item.name.toLowerCase()
  const fields = toolFields(item.args)
  const base = { key: item.key, at: item.at, running: item.status === 'running', title: toolTitle(item.name, item.status === 'done') }
  if (COMMANDS.has(name)) {
    const command = text(fields.command) ?? text(fields.code) ?? text(item.context)
    return { ...base, kind: 'command', detail: command, ...(item.status === 'done' ? commandAnswer(item.result) : {}) }
  }
  if (EDITS.has(name) || READS.has(name)) {
    const path = text(fields.path) ?? text(fields.file_path) ?? text(fields.filename)
    const shown = path ?? text(fields.pattern) ?? text(fields.query) ?? text(item.context)
    return { ...base, kind: EDITS.has(name) ? 'edit' : 'read', detail: shown, ...(path ? { path } : {}) }
  }
  if (PAGES.has(name)) {
    const url = text(fields.url) ?? (Array.isArray(fields.urls) ? text(fields.urls[0]) : undefined) ?? text(item.context)
    return { ...base, kind: 'page', detail: url }
  }
  return { ...base, kind: 'step', detail: text(item.context) ?? text(item.summary) }
}

/** The chat's steps, oldest first. */
export function timelineSteps(items: readonly TranscriptItem[]): TimelineStep[] {
  const steps: TimelineStep[] = []
  for (const item of items) {
    if (item.kind === 'user') {
      if (item.pending) continue
      const words = item.text.trim().split('\n')[0]?.trim()
      steps.push({ key: item.key, kind: 'ask', title: t('You asked'), detail: words || undefined, at: item.at })
    } else if (item.kind === 'tool') {
      const step = toolStep(item)
      if (step) steps.push(step)
    }
  }
  return steps
}

/** Whether two step lists draw the same: a reply's words streaming in change neither. */
export function sameSteps(a: readonly TimelineStep[], b: readonly TimelineStep[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.key !== y.key || x.running !== y.running || x.detail !== y.detail || x.output !== y.output || x.title !== y.title || x.path !== y.path) return false
  }
  return true
}

/** The command a step lands on in the bot's terminal: its own, or the last one before it. */
export function commandAt(steps: readonly TimelineStep[], key: string | null): string | null {
  if (key === null) return null
  const at = steps.findIndex(step => step.key === key)
  for (let i = at; i >= 0; i--) if (steps[i]!.kind === 'command') return steps[i]!.key
  return null
}

/** A file the bot named, as a path on the host: one it named from its folder is in the chat's folder. */
export function stepPath(path: string, root: string): string {
  if (/^([a-z]:[\\/]|[\\/]|~)/i.test(path)) return path
  const clean = path.replace(/^\.[\\/]/, '')
  return `${root.replace(/[\\/]+$/, '')}/${clean}`
}

/** When a step happened, for its label: the time today, else the day and the time. */
export function stepWhen(at: number | undefined, now = Date.now(), locale?: string): string {
  if (!at) return ''
  const when = new Date(at)
  const time = when.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  return when.toDateString() === new Date(now).toDateString() ? time : `${when.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} ${time}`
}
