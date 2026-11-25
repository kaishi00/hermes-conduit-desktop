/**
 * A short train of thought for a finished run of steps, after the phone's
 * ChatStepSummaries: automatic when Settings > Chat > Step summaries is on,
 * or asked from a run (Explain these steps). Conduit asks Hermes a side
 * question through the plugin's `POST /side-question` (plugin 0.137.4+), which
 * answers this device only from a copy of the chat that can't call tools or
 * change it, or as a hidden /btw where the plugin has no such route. Summaries stay on this computer, by profile and the run's first
 * tool call. Signing out of a host forgets its summaries, as the phone's
 * do with their dashboard.
 */
import type { ToolItem } from './transcript'
import type { StepItem } from './runs'
import { isStep } from './runs'
import type { TranscriptItem } from './transcript'

export const SIDE_QUESTION_CAPABILITY = 'side-question'
export const SIDE_QUESTION_PATH = '/api/plugins/conduit_push/side-question'
export const SIDE_QUESTION_WAIT_S = 100

const ENABLED_KEY = 'conduit.describeStepRuns'
const SAVED_KEY = 'conduit.stepRunSummaries'
const SAVED_LIMIT = 500
export const MINIMUM_STEPS = 2
export const MAX_STEPS = 20
export const MAX_STEPS_RANGE = [5, 100] as const
const MAX_STEPS_KEY = 'conduit.stepRunSummaryMaxSteps'
const MAX_EXPLAINED_STEPS = 30
const WORDS_PER_LINE = 9
const MIN_LINES = 2
const MAX_LINES = 4
export const MAX_EXPLAIN_WORDS = 8 * WORDS_PER_LINE

/** Provider ids (`call_…`, `toolu_…`) are random and long; a numbered one (`functions.web_search:0`) or a short one repeats. */
export const isDistinct = (id: string) => id.length >= 12 && !/:\d+$/.test(id)

/** A run's key: its first tool call's id, the same live and in history; null when that id isn't one of a kind. */
export function runKey(steps: StepItem[]): string | null {
  const first = steps.flatMap(s => (s.kind === 'tool' && s.toolId.trim() ? [s.toolId.trim()] : []))[0]
  return first && isDistinct(first) ? first : null
}

/** The finished turn's last run of steps after your last message, when it folds and has a tool call to describe. */
export function lastRun(items: TranscriptItem[]): StepItem[] | null {
  let end = items.length
  while (end > 0 && !isStep(items[end - 1]!)) {
    if (items[end - 1]!.kind === 'user') return null
    end--
  }
  let start = end
  while (start > 0 && isStep(items[start - 1]!)) start--
  const run = items.slice(start, end) as StepItem[]
  const tools = run.filter((s): s is ToolItem => s.kind === 'tool')
  if (tools.some(s => s.status === 'running')) return null
  return run.length >= MINIMUM_STEPS && tools.length ? run : null
}

/** Whether a finished run gets a summary of its own: enough steps to fold and no more than the limit. */
export const isAsked = (run: StepItem[], maxSteps = MAX_STEPS) => run.length >= MINIMUM_STEPS && run.length <= maxSteps

export const clampedMaxSteps = (value: number) => Math.min(Math.max(Math.round(value), MAX_STEPS_RANGE[0]), MAX_STEPS_RANGE[1])

/** Longer runs aren't summarized on their own (Explain still asks): Settings > Chat. */
export function summaryMaxSteps(): number {
  try {
    const value = Number(localStorage.getItem(MAX_STEPS_KEY))
    return value ? clampedMaxSteps(value) : MAX_STEPS
  } catch {
    return MAX_STEPS
  }
}

export function setSummaryMaxSteps(value: number): void {
  try {
    localStorage.setItem(MAX_STEPS_KEY, String(clampedMaxSteps(value)))
  } catch {
    // The default next time.
  }
}

/** About half a line on the phone per tool call, two lines at least and four at most. */
export function words(toolCount: number): number {
  const half = Math.floor((toolCount * WORDS_PER_LINE + 1) / 2)
  return Math.min(Math.max(half, MIN_LINES * WORDS_PER_LINE), MAX_LINES * WORDS_PER_LINE)
}

/** An explanation runs half again as long, four lines at least and eight at most. */
export const explainWords = (toolCount: number) => Math.min(Math.max(Math.floor((words(toolCount) * 3) / 2), 4 * WORDS_PER_LINE), MAX_EXPLAIN_WORDS)

const QUESTION_HEAD = 'Look back at the tool calls you made just before your last reply'
const QUESTION_SCOPE = "Only the calls since the user's last message: earlier turns are context, not part of this story."
const EXPLAIN_HEAD = 'Look back at these tool calls you made earlier in this chat'
const EXPLAIN_SCOPE = 'Tell only this run, nothing that came before or after.'

function body(language: string, count: number): string {
  return (
    `In ${language}, tell the user, looking back, the train of thought that led you through them: ` +
    'what you set out to find, why each step came next, and how what you learned changed your course. ' +
    'Tell it as one coherent story of intentions, not a report of outcomes: your reply already gives the results, ' +
    'so mention a result only where it changed what you did next. ' +
    'Name the real things you were after (the question, file, page or command), never the tool names: ' +
    'not "I ran the terminal and used search", but "I first wanted to know whether the sandbox was fresh, so…". ' +
    `One natural, flowing paragraph of at most ${count} words, first person, past tense: ` +
    'no list, headings or preamble, and nothing about how many calls there were. ' +
    "It labels those steps, folded, in the user's chat app. " +
    'Reply with the paragraph only.'
  )
}

/**
 * Whether a /btw asked exactly this, or a run's explanation, in whichever
 * language and word count it names, or the one-sentence question an earlier
 * Conduit asked: its answer (this computer's, late, or the phone's) is never
 * shown as a note.
 */
export function isQuestion(text: string | null | undefined): boolean {
  if (!text) return false
  // From the end: an explanation's listed calls come first and may say anything.
  const tell = text.lastIndexOf(', tell the user, looking back')
  if (tell >= 0) {
    const lead = text.lastIndexOf('In ', tell)
    const count = text.slice(tell).match(/at most (\d+) words/)
    if (lead < 0 || !count) return false
    const told = body(text.slice(lead + 3, tell), Number(count[1]))
    if (text.startsWith(QUESTION_HEAD)) return text === `${QUESTION_HEAD}. ${QUESTION_SCOPE} ${told}`
    if (text.startsWith(`${EXPLAIN_HEAD}:\n`)) return text.endsWith(`\n${EXPLAIN_SCOPE} ${told}`)
    return false
  }
  // The question until 2.2.1.
  const old = text.match(/^Describe in one short sentence[\s\S]*?Write it in ([\s\S]*?), in the past tense/)
  return (
    !!old &&
    text ===
      'Describe in one short sentence (at most 15 words) what you did in the tool calls just before your last reply. ' +
        "It labels those steps, folded, in the user's chat app. " +
        `Write it in ${old[1]}, in the past tense, like "Searched three sites and compared their prices". ` +
        'Reply with the sentence only.'
  )
}

/** How long a question waits for its answer before its run can be asked again. */
export const ANSWER_WAIT_MS = 120_000

/** The phone's own question for the last run, word for word, so its answer is never shown as a note there. */
export const question = (language: string, count: number) => `${QUESTION_HEAD}. ${QUESTION_SCOPE} ${body(language, count)}`

function trimmed(text: string | undefined, limit: number): string | null {
  if (!text) return null
  const flat = text
    .slice(0, limit * 4)
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
  if (!flat) return null
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

/** The calls as the question lists them, trimmed: enough to point at the run and recall it. */
export function explainSteps(steps: ToolItem[]): string {
  const lines = steps.slice(0, MAX_EXPLAINED_STEPS).map((step, index) => {
    let line = `${index + 1}. ${step.name}`
    const input = trimmed(step.args, 300)
    if (input) line += ` ${input}`
    const output = trimmed(step.result, 400)
    if (output) line += `\n   → ${output}`
    return line
  })
  if (steps.length > MAX_EXPLAINED_STEPS) lines.push(`…and ${steps.length - MAX_EXPLAINED_STEPS} more calls in the same run.`)
  return lines.join('\n')
}

/** Asked from a run, for any finished run: it carries each call, since Hermes may no longer hold an older one. */
export const explainQuestion = (language: string, count: number, steps: ToolItem[]) =>
  `${EXPLAIN_HEAD}:\n${explainSteps(steps)}\n${EXPLAIN_SCOPE} ${body(language, count)}`

/** The answer as one paragraph, without quotes, bold or bullets; null for an error, nothing, or far past its budget. */
export function cleaned(text: string): string | null {
  const whole = text.trim()
  if (whole.toLowerCase().startsWith('error:')) return null
  const parts = whole
    .split(/\r?\n/)
    .map(raw =>
      raw
        .trim()
        .replace(/^([-•*·–—]|\d+[.)])\s+/, '')
        .replaceAll('**', '')
        .trim()
    )
    .filter(Boolean)
  const paragraph = parts.join(' ').replace(/^["'“”‘’«»*\s]+|["'“”‘’«»*\s]+$/g, '')
  return paragraph && paragraph.length <= MAX_EXPLAIN_WORDS * 16 ? paragraph : null
}

/** The app's language, named in English for the question. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code.split('-')[0]!) ?? 'English'
  } catch {
    return 'English'
  }
}

/** The route's answer; null when it has none (the run keeps its count). */
export function sideQuestionAnswer(response: unknown): string | null {
  const r = response as { ok?: unknown; text?: unknown } | null
  return r?.ok === true && typeof r.text === 'string' && r.text.trim() ? r.text : null
}

export function summariesEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'true'
  } catch {
    return false
  }
}

export function setSummariesEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, 'true')
    else localStorage.removeItem(ENABLED_KEY)
  } catch {
    // Off next time.
  }
}

type Entry = [scope: string, toolId: string, summary: string]

// The parsed store, kept while the stored text is the same: each run row asks
// for its summary on every transcript render, streaming frames included
// (desktop#541). A write here or in another window changes the text.
let parsed: { raw: string | null; list: readonly Entry[]; index: Map<string, string> } | null = null

function read(): { list: readonly Entry[]; index: Map<string, string> } {
  let raw: string | null
  try {
    raw = localStorage.getItem(SAVED_KEY)
  } catch {
    raw = null
  }
  if (parsed && parsed.raw === raw) return parsed
  let list: Entry[] = []
  try {
    const found = JSON.parse(raw ?? '[]') as unknown
    if (Array.isArray(found)) list = found.filter((e): e is Entry => Array.isArray(e) && e.length === 3 && e.every(v => typeof v === 'string'))
  } catch {
    list = []
  }
  const index = new Map<string, string>()
  for (const [scope, toolId, summary] of list) if (!index.has(`${scope}\n${toolId}`)) index.set(`${scope}\n${toolId}`, summary)
  parsed = { raw, list, index }
  return parsed
}

function entries(): Entry[] {
  return [...read().list]
}

export function savedSummary(scope: string, toolId: string): string | null {
  return read().index.get(`${scope}\n${toolId}`) ?? null
}

/** A summary's scope: the host and the profile, so a host's go when it's signed out. */
export const summaryScope = (host: string, profile: string | undefined) => `${host}\t${profile || 'default'}`

/** Forgets the summaries of every host not in `hosts` (signed out or removed), and those kept before they were by host. */
export function forgetSummaries(hosts: string[]): void {
  const all = entries()
  const kept = all.filter(e => {
    const tab = e[0].indexOf('\t')
    return tab > 0 && hosts.includes(e[0].slice(0, tab))
  })
  if (kept.length === all.length) return
  try {
    if (kept.length) localStorage.setItem(SAVED_KEY, JSON.stringify(kept))
    else localStorage.removeItem(SAVED_KEY)
  } catch {
    // Tried again on the next change of hosts.
  }
}

/** Adds one, oldest first in storage so the limit drops the oldest. */
export function saveSummary(scope: string, toolId: string, summary: string): void {
  const kept = entries().filter(e => !(e[0] === scope && e[1] === toolId))
  kept.push([scope, toolId, summary])
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(kept.slice(-SAVED_LIMIT)))
  } catch {
    // Shown until the window closes.
  }
}
