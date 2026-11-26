import { t } from '../../../shared/i18n'
import type { TranscriptItem } from './transcript'

/** "terminal" → "Ran a command", the way the phone names its tool steps. */
export function toolTitle(name: string, done: boolean): string {
  const known: Record<string, [string, string]> = {
    terminal: [t('Running a command'), t('Ran a command')],
    execute_code: [t('Running code'), t('Ran code')],
    read_file: [t('Reading a file'), t('Read a file')],
    write_file: [t('Writing a file'), t('Wrote a file')],
    patch: [t('Editing a file'), t('Edited a file')],
    search_files: [t('Searching files'), t('Searched files')],
    web_search: [t('Searching the web'), t('Searched the web')],
    web_extract: [t('Reading a page'), t('Read a page')],
    browser_navigate: [t('Opening a page'), t('Opened a page')],
    memory: [t('Updating memory'), t('Updated memory')],
    todo: [t('Updating the plan'), t('Updated the plan')],
    delegate_task: [t('Handing off a task'), t('Handed off a task')]
  }
  const pair = known[name]
  if (pair) return done ? pair[1] : pair[0]
  const words = name.replace(/[_.-]+/g, ' ').trim()
  return done ? words.charAt(0).toUpperCase() + words.slice(1) : `${words.charAt(0).toUpperCase()}${words.slice(1)}…`
}

/**
 * What a reply that's answering now is doing, for its bot's line in the Bots list (Eric, 2026-11-26):
 * the step it's running ("Running a command"), or Thinking… while it reasons; null otherwise, so the
 * line says Working rather than the chat's last message.
 */
export function liveDoing(items: readonly TranscriptItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.kind === 'user') return null
    if (item.kind === 'tool' && item.status === 'running' && !item.board) return toolTitle(item.name, false)
    if (item.kind === 'thinking' && item.streaming) return t('Thinking…')
    if (item.kind === 'assistant' && item.streaming) return null
  }
  return null
}

/** A background chat's step, as the plugin notes it (GET /live-steps: a phase, and a tool's category). */
export function stepTitle(step: { phase: string; tool?: string | null }): string | null {
  if (step.phase === 'thinking') return t('Thinking…')
  if (step.phase === 'approval') return t('Needs approval')
  if (step.phase === 'input') return t('Waiting for your answer')
  if (step.phase !== 'tool') return null
  const byCategory: Record<string, string> = {
    terminal: t('Running a command'),
    code: t('Running code'),
    files: t('Working with files'),
    web: t('Searching the web'),
    agents: t('Handing off a task'),
    memory: t('Updating memory'),
    images: t('Working with images'),
    planning: t('Updating the plan'),
    messages: t('Sending a message'),
    browser: t('Using the browser')
  }
  return byCategory[step.tool ?? ''] ?? t('Using a tool')
}
