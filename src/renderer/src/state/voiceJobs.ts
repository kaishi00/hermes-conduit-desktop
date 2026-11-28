/**
 * Background jobs from a live call, after the phone's VoiceBackgroundJobs:
 * the model hands longer work to Hermes in a chat of its own (start_job)
 * and keeps talking. Each job is an ordinary Hermes session
 * (`session.create` + `prompt.submit`), so it shows in the chat list and
 * opens like any chat. At most three run at once. A finished job's reply
 * comes back to the call as an update, told when the conversation is
 * quiet; a job still running when the call ends keeps running, its result
 * left in its chat.
 *
 * Desktop calls always belong to the chat on screen, where ask_thread goes:
 * start_job is for work the user wants kept apart from it.
 *
 * Jobs outlive their call, as the phone's saved ledger keeps them (M5b): a
 * job still running when the call ends, or settled with an outcome nobody
 * heard, is kept (12 at most, for a day), across a relaunch too. The next
 * call in the same chat gets them back: a settled one is told at once, and
 * a running one is read from its chat until its reply is there.
 */
import { GatewayError, gateway } from '../gateway'
import { tagVoiceSession } from './voiceList'
import { namingFiles } from './media'
import { correctTurn, type Correction } from './localLive'
import { STATUS_PATH, pluginStatus, serves } from './plugin'
import { modelWords } from './requestWords'
import { discardTurnSurface, reportTurnSurface } from './turnSurface'

const withProfile = (path: string, profile?: string) => (profile && profile !== 'default' ? `${path}?profile=${encodeURIComponent(profile)}` : path)

/** A correction may have reached Hermes unless the gateway gave a definitive answer (issue 732). */
export function correctionMayHaveGone(error: unknown): boolean {
  const text = String((error as { message?: unknown } | null)?.message ?? error).toLowerCase()
  if (text.includes('not connected to hermes') || text.includes('gateway not connected')) return false
  return !(error instanceof GatewayError && error.code !== undefined)
}

/** The plugin keeps a voice call's jobs in its bot's Work panel (notifier `work-adopt`). */
export const ADOPT_CAPABILITY = 'work-adopt'
export const ADOPT_PATH = '/api/plugins/conduit_push/workstreams/adopt'

/**
 * Keeps a job in its bot's registry once Hermes took its request, fire and
 * forget, sent once more after a failure, as the phone does: the Work panel
 * lists it as a voice call's. The plugin knows calls as "phone" or "watch".
 */
export async function adoptJob(profile: string | undefined, sessionId: string, title: string, goal: string): Promise<boolean> {
  const status = await gateway.http('GET', withProfile(STATUS_PATH, profile), undefined, 15_000).then(pluginStatus, () => null)
  if (!status || !serves(status, [ADOPT_CAPABILITY])) return false
  const body = { session_id: sessionId, title, via: 'phone', goal: goal.slice(0, 2_000) }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await gateway.http('POST', withProfile(ADOPT_PATH, profile), body, 15_000)
      return true
    } catch {
      if (attempt === 1) await new Promise(resolve => setTimeout(resolve, 3_000))
    }
  }
  return false
}

export const START_JOB = 'start_job'
export const LIST_JOBS = 'list_jobs'
export const CANCEL_JOB = 'cancel_job'
export const INTERRUPT_JOB = 'interrupt_job'
export const MAX_ACTIVE_JOBS = 3
const MAX_RESULT_CHARACTERS = 6_000
const MAX_TITLE = 60

export const JOB_TOOL_SPECS = [
  {
    name: START_JOB,
    description:
      'Start a background job on the user\'s Hermes agent, in a chat of its own, for work that takes more than a moment and that the user wants kept apart from this chat: when they say "in the background", "as a background job" or "in a separate chat". Everything else that needs Hermes goes to ask_thread. Its result arrives later on this call. Do not describe job progress unless asked.',
    parameters: {
      type: 'object',
      properties: { instructions: { type: 'string', description: "The complete task for Hermes, in the user's words plus any needed context." } },
      required: ['instructions']
    }
  },
  {
    name: LIST_JOBS,
    description: "List the user's background jobs from this call and their status. Call only when the user asks about their jobs.",
    parameters: { type: 'object', properties: {} }
  },
  {
    name: CANCEL_JOB,
    description: 'Cancel a background job when the user asks. Pass job_id from list_jobs to cancel one job, or omit it to cancel every running job.',
    parameters: { type: 'object', properties: { job_id: { type: 'string', description: "The job's id from list_jobs. Omit to cancel all running jobs." } } }
  },
  {
    name: INTERRUPT_JOB,
    description:
      'Pass the user\'s words into a background job Hermes is still working on, when they correct it, change it, pause it or call it off (for example "wait, make it Alex", "hold that for a minute", "never mind"). Hermes takes them in at once, keeps its work so far and decides what they mean; the job\'s result still arrives later on this call. Pass job_id from list_jobs and the user\'s words as they said them. Not for new requests.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: "The job's id from list_jobs." },
        message: { type: 'string', description: "The user's words about the job, as they said them." },
        kind: {
          type: 'string',
          enum: ['add', 'change'],
          description: 'add when the user adds to the work without changing it; change when they correct, pause, or cancel it. Omit when uncertain.'
        }
      },
      required: ['job_id', 'message']
    }
  }
]

export const JOBS_RULE =
  '\nWhen the user asks for work in the background or in a separate chat, call start_job instead of ask_thread, acknowledge it out loud, and carry on; its result arrives later on this call. When it arrives, tell the user what the job found or did.'

/** Words that keep a request apart from the chat, as the phone's VoiceJobRouting.backgroundPhrases. */
const BACKGROUND_PHRASES = [
  'in the background',
  'as a background job',
  'in a background job',
  'start a background job',
  'in a separate chat',
  'in a new chat',
  '在后台',
  '后台运行',
  '后台任务'
]
export const asksForBackground = (text: string) => {
  const folded = text.toLowerCase().replace(/\s+/g, ' ')
  return BACKGROUND_PHRASES.some(phrase => folded.includes(phrase))
}

/** GPT-Live delegates; its words decide where the work goes. */
export const DELEGATED_JOBS_RULE =
  'Each delegation goes to the chat this call is attached to, unless the user asks for the work in the background or in a separate chat: then say "in the background" or "in a separate chat" in the delegation, and Conduit runs it as a background job in a chat of its own. Its result arrives later on that delegation.'

/** GPT-Live's follow-ups to a running job: "Job 2: make it Alex", or "Add to job 2: …". */
export const DELEGATED_JOB_FOLLOW_UPS =
  'When the user corrects, changes, pauses or calls off a background job that is still running ("wait, make it Alex", "hold that", "never mind"), delegate their words right away, starting with "Job" and its number, like "Job 2: make it Alex": Conduit puts them into that job at once, Hermes decides what they mean, and the job\'s result still arrives on its earlier delegation. When the user only adds to the running job without changing it, start the delegation "Add to job 2:" with its number instead.'

/** The job id and words of "Job 2: …" or "Add to job 2: …" at the start of a delegation; null when it isn't one. */
export function jobFollowUpMarker(request: string): { jobId: string; words: string } | null {
  const m = /^\s*(?:add\s+to\s+)?job\s*#?\s*(\d{1,2})\s*:([\s\S]*)$/i.exec(request)
  return m ? { jobId: `job-${Number(m[1])}`, words: m[2]!.trim() } : null
}

/** Said on a delegation that started a job. */
export const JOB_STARTED =
  "[Started as a background job in a chat of its own: tell the user in a few words that it's running. Its result follows on this delegation; don't guess it.]"

export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface VoiceJob {
  id: string
  title: string
  status: JobStatus
  /** The job's live session, for its events. */
  sid?: string
  /** Its stored session, which the host's turn-end hooks name. */
  stored?: string
  /** When its request went out (ms). */
  sentAt?: number
  reply?: string
  error?: string
  /** Its outcome was handed to a live call. */
  told?: boolean
  /** Brought back from the saved ledger: an earlier call started it. */
  restored?: boolean
}

// MARK: Saved ledger

export const LEDGER_KEY = 'conduit.voiceJobs.v1'
export const MAX_SAVED_JOBS = 12
export const SAVED_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const RESTORED_POLL_MS = 15_000

/** A job kept past its call, for the next call in its chat. */
export interface SavedJob {
  profile: string
  chat: string
  title: string
  stored: string
  sid?: string
  sentAt: number
  status: JobStatus
  reply?: string
  error?: string
}

export interface LedgerStore {
  read(): SavedJob[]
  write(jobs: SavedJob[]): void
}

const isSaved = (v: unknown): v is SavedJob => {
  const e = (v ?? {}) as Record<string, unknown>
  return (
    typeof e.profile === 'string' &&
    typeof e.chat === 'string' &&
    !!e.chat &&
    typeof e.title === 'string' &&
    typeof e.stored === 'string' &&
    !!e.stored &&
    typeof e.sentAt === 'number' &&
    ['running', 'done', 'failed', 'cancelled'].includes(e.status as string)
  )
}

export const localLedger: LedgerStore = {
  read() {
    try {
      const raw = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? '[]') as unknown
      return Array.isArray(raw) ? raw.filter(isSaved) : []
    } catch {
      return []
    }
  },
  write(jobs) {
    try {
      localStorage.setItem(LEDGER_KEY, JSON.stringify(jobs))
    } catch {
      // Kept for this call only.
    }
  }
}

/** What a call's jobs leave in the ledger: the running ones, and the settled ones nobody heard (a cancel was the user's own). */
export function keptJobs(jobs: VoiceJob[], profile: string | undefined, chat: string): SavedJob[] {
  return jobs.flatMap((job): SavedJob[] =>
    job.stored && job.sentAt && (job.status === 'running' || ((job.status === 'done' || job.status === 'failed') && !job.told))
      ? [
          {
            profile: profile ?? '',
            chat,
            title: job.title,
            stored: job.stored,
            sid: job.sid,
            sentAt: job.sentAt,
            status: job.status,
            reply: job.reply,
            error: job.error
          }
        ]
      : []
  )
}

/**
 * The ledger with one call's jobs written in: its entries for these jobs
 * (by stored session) replaced or dropped, a day's worth at most, running
 * ones first, then the newest settled ones.
 */
export function mergeLedger(ledger: SavedJob[], mine: SavedJob[], dropped: string[], now: number): SavedJob[] {
  const gone = new Set([...dropped, ...mine.map(job => job.stored)])
  const all = [...ledger.filter(job => !gone.has(job.stored)), ...mine].filter(job => now - job.sentAt <= SAVED_JOB_MAX_AGE_MS)
  const running = all.filter(job => job.status === 'running')
  const settled = all.filter(job => job.status !== 'running').slice(-Math.max(0, MAX_SAVED_JOBS - running.length))
  const kept = new Set([...running, ...settled])
  return all.filter(job => kept.has(job))
}

/** The saved jobs a call in this chat gets back. */
export const restoredFor = (ledger: SavedJob[], profile: string | undefined, chat: string, now: number) =>
  ledger.filter(job => job.profile === (profile ?? '') && job.chat === chat && now - job.sentAt <= SAVED_JOB_MAX_AGE_MS)

/**
 * A restored running job's reply, read from a page of its chat's messages:
 * the newest row, when it's an assistant reply with text and no tool calls
 * written after the request went out. Null while the turn is still going.
 */
export function replyAfter(page: unknown, sentAt: number): string | null {
  const messages = (page as { messages?: unknown } | null)?.messages
  const rows = (Array.isArray(messages) ? messages : []) as Record<string, unknown>[]
  const stamped = rows.filter(row => typeof row.timestamp === 'number').sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
  const last = stamped.at(-1)
  if (!last || last.role !== 'assistant' || (last.timestamp as number) * 1000 < sentAt - 5_000) return null
  if (Array.isArray(last.tool_calls) && last.tool_calls.length) return null
  const text =
    typeof last.text === 'string'
      ? last.text
      : typeof last.content === 'string'
        ? last.content
        : Array.isArray(last.content)
          ? (last.content as { text?: unknown }[]).map(part => (typeof part?.text === 'string' ? part.text : '')).join('')
          : ''
  return text.trim() || null
}

/** A job's title: its task's first words, one line. */
export function jobTitle(instructions: string): string {
  const line = instructions.split(/\s+/).filter(Boolean).join(' ')
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line
}

/** A finished job's reply for the model, as the phone's completionPrompt. */
export function completionPrompt(title: string, result: string): string {
  const named = namingFiles(result)
  const clipped = named.length > MAX_RESULT_CHARACTERS ? `${named.slice(0, MAX_RESULT_CHARACTERS)}\n[…]` : named
  return `[Background job "${title}" finished. Its final message is below. Tell the user what it found or did, in the language we have been speaking: the substance, with the details that matter, not just a headline. Skip what doesn't work by ear, like code, long tables or links; those stay in the job's chat.]\n\n${clipped}`
}

export const failurePrompt = (title: string, error: string) => `[Background job "${title}" failed: ${error.slice(0, 300)}. Tell the user in a sentence.]`

export function statusSummary(jobs: VoiceJob[]): string {
  if (!jobs.length) return 'No background jobs are running.'
  return jobs
    .map(job =>
      job.status === 'running'
        ? `${job.title} is still running.`
        : job.status === 'done'
          ? `${job.title} has finished.`
          : job.status === 'failed'
            ? `${job.title} failed.`
            : `${job.title} was cancelled.`
    )
    .join(' ')
}

export function listResult(jobs: VoiceJob[]): Record<string, string> {
  const result: Record<string, string> = { summary: statusSummary(jobs) }
  jobs.forEach((job, i) => (result[`job_${i + 1}`] = `id=${job.id}; title=${job.title}; status=${job.status}`))
  return result
}

type Rpc = (method: string, params: Record<string, unknown>) => Promise<unknown>
type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * One call's jobs. `onChange` redraws the call screen; `onOutcome` hands a
 * settled job's notice to the call, which tells it at the next quiet moment.
 */
/**
 * A job's request as Hermes reads it, the phone's VoiceBackgroundJobSupervisor.jobPrompt
 * word for word: the plugin knows a voice job's chat by it, and archives the chat once
 * Hermes has answered (Voice in the chats list).
 */
export const jobPrompt = (instructions: string) =>
  `[Background job started from a Conduit voice conversation. Nobody is watching this chat live, so work on it on your own. When you are done, end your final message with a plain-language summary that can be read aloud: what you found or did, with the key details.]\n\n${instructions}`

export class VoiceJobs {
  jobs: VoiceJob[] = []
  private count = 0
  private text = new Map<string, string>()
  private unsubscribe: (() => void) | null = null
  private chat: string | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private ledger: LedgerStore = localLedger
  private http: (method: string, path: string) => Promise<unknown> = (method, path) => gateway.http(method as 'GET', path, undefined, 15_000)

  constructor(
    private profile: string | undefined,
    private onChange: (jobs: VoiceJob[]) => void,
    private onOutcome: (notice: string, job: VoiceJob) => void,
    private rpc: Rpc = (method, params) => gateway.rpc(method, params),
    listen: (handler: (event: { type: string; session_id?: string; payload?: unknown }) => void) => () => void = handler => window.conduit.onEvent(handler),
    private correct: (sessionId: string, text: string, profile?: string) => Promise<Correction> = correctTurn,
    private adopt: (profile: string | undefined, sessionId: string, title: string, goal: string) => Promise<boolean> = adoptJob,
    private tag: typeof tagVoiceSession = tagVoiceSession,
    private surface: { report: typeof reportTurnSurface; discard: typeof discardTurnSurface } = { report: reportTurnSurface, discard: discardTurnSurface }
  ) {
    this.unsubscribe = listen(event => this.event(event))
  }

  /** The call ended: running jobs go on in their chats, kept in the ledger for the next call there; nothing more is told here. */
  dispose() {
    this.save()
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.poll) clearInterval(this.poll)
    this.poll = null
  }

  /**
   * The chat this call is kept with: its jobs are saved under it, and the
   * jobs an earlier call there left come back. A settled one is told at
   * once; a running one is read from its chat until its reply is there.
   */
  keepWith(chat: string | null | undefined, ledger: LedgerStore = localLedger, http?: (method: string, path: string) => Promise<unknown>, now = Date.now()) {
    if (!chat || this.chat) return
    this.chat = chat
    this.ledger = ledger
    if (http) this.http = http
    const known = new Set(this.jobs.map(job => job.stored))
    const back = restoredFor(ledger.read(), this.profile, chat, now).filter(job => !known.has(job.stored))
    if (!back.length) return
    const restored = back.map(
      (saved): VoiceJob => ({
        id: `job-${++this.count}`,
        title: saved.title,
        status: saved.status,
        sid: saved.sid,
        stored: saved.stored,
        sentAt: saved.sentAt,
        reply: saved.reply,
        error: saved.error,
        restored: true
      })
    )
    this.jobs = [...this.jobs, ...restored]
    this.onChange(this.jobs)
    for (const job of restored) if (job.status !== 'running') this.tell(job)
    if (restored.some(job => job.status === 'running')) {
      void this.readRestored()
      this.poll = setInterval(() => void this.readRestored(), RESTORED_POLL_MS)
    }
  }

  /** Restored running jobs, settled from their chats once their replies are there. */
  private async readRestored() {
    for (const job of this.jobs.filter(j => j.restored && j.status === 'running' && j.stored)) {
      const profile = this.profile && this.profile !== 'default' ? `&profile=${encodeURIComponent(this.profile)}` : ''
      let reply: string | null
      try {
        reply = replyAfter(
          await this.http('GET', `/api/sessions/${encodeURIComponent(job.stored!)}/messages?order=latest&limit=20&inline_images=false${profile}`),
          job.sentAt ?? 0
        )
      } catch {
        continue
      }
      const now = this.jobs.find(j => j.id === job.id)
      if (!reply || now?.status !== 'running' || !this.unsubscribe) continue
      this.update(job.id, { status: 'done', reply })
      this.tell({ ...now, status: 'done', reply })
    }
    if (this.poll && !this.jobs.some(j => j.restored && j.status === 'running')) {
      clearInterval(this.poll)
      this.poll = null
    }
  }

  /** Hands a settled job's notice to the call, once. */
  private tell(job: VoiceJob) {
    if (job.told) return
    this.update(job.id, { told: true })
    if (job.status === 'failed') this.onOutcome(failurePrompt(job.title, job.error ?? 'the turn failed'), job)
    else if (job.status === 'done')
      this.onOutcome(
        job.reply
          ? completionPrompt(job.title, job.reply)
          : `[Background job "${job.title}" finished without a written reply. Tell the user in one short sentence that it's done and its chat shows what happened.]`,
        job
      )
  }

  /** Writes this call's jobs into the ledger, under its chat. */
  private save() {
    if (!this.chat) return
    const told = this.jobs.filter(job => job.stored && !keptJobs([job], this.profile, this.chat!).length).map(job => job.stored!)
    this.ledger.write(mergeLedger(this.ledger.read(), keptJobs(this.jobs, this.profile, this.chat), told, Date.now()))
  }

  private update(id: string, change: Partial<VoiceJob>) {
    this.jobs = this.jobs.map(job => (job.id === id ? { ...job, ...change } : job))
    this.onChange(this.jobs)
    this.save()
  }

  async start(instructions: string): Promise<Record<string, string>> {
    const task = instructions.trim()
    if (!task) return { status: 'error', error: 'instructions is required' }
    if (this.jobs.filter(j => j.status === 'running').length >= MAX_ACTIVE_JOBS)
      return { status: 'error', error: `${MAX_ACTIVE_JOBS} background jobs are already running. Tell the user to wait for one to finish, or cancel one.` }
    const id = `job-${++this.count}`
    // Named by the model's request: the user's words sent with it aren't its title.
    const job: VoiceJob = { id, title: jobTitle(modelWords(task)), status: 'running' }
    let deliveryUnknown = false
    this.jobs = [...this.jobs, job]
    this.onChange(this.jobs)
    try {
      const params: Row = { cols: 96, source: 'desktop', title: job.title }
      if (this.profile) params.profile = this.profile
      const made = (await this.rpc('session.create', params)) as Row
      const sid = str(made?.session_id)
      if (!sid) throw new Error('Hermes made no session for the job.')
      this.update(id, { sid, stored: str(made.stored_session_id) ?? sid, sentAt: Date.now() })
      const text = jobPrompt(task)
      const submit: Row = { session_id: sid, text }
      if (this.profile) submit.profile = this.profile
      // Its turn says it was spoken on this computer (the phone's TurnSurface), dropped if Hermes refuses it.
      await this.surface.report(sid, text, 'spoken', false)
      try {
        await this.rpc('prompt.submit', submit)
      } catch (e) {
        this.surface.discard(sid, text, e)
        // No answer back (a timeout, a dropped connection): Hermes may have it.
        if (!(e instanceof GatewayError && e.code !== undefined)) deliveryUnknown = true
        throw e
      }
      // Filed under Voice Jobs, beneath the call's chat; the plugin archives it once Hermes answers.
      void this.tag(this.profile, str(made.stored_session_id) ?? sid, 'job', this.chat).catch(() => undefined)
      // Hermes took the request: its bot's Work panel keeps it as a call's.
      void this.adopt(this.profile, str(made.stored_session_id) ?? sid, job.title, task).catch(() => false)
    } catch (e) {
      this.update(id, { status: 'failed', error: message(e) })
      const failed: Record<string, string> = { status: 'error', error: `The job couldn't start: ${message(e)}. Tell the user in a few words.` }
      if (deliveryUnknown) failed.delivery = 'unknown'
      return failed
    }
    return {
      status: 'started',
      job_id: id,
      message: "The job is running in a chat of its own. Acknowledge it in a few words; its result arrives later on this call, so don't guess it."
    }
  }

  list(): Record<string, string> {
    return listResult(this.jobs)
  }

  async cancel(jobId?: string): Promise<Record<string, string>> {
    const targets = this.jobs.filter(j => j.status === 'running' && (!jobId || j.id === jobId.trim()))
    if (!targets.length) return { message: jobId ? 'Unknown job_id. Call list_jobs for the jobs’ ids.' : 'There are no background jobs to cancel.' }
    for (const job of targets) {
      this.update(job.id, { status: 'cancelled' })
      if (job.sid) await this.rpc('session.interrupt', { session_id: job.sid, ...(this.profile ? { profile: this.profile } : {}) }).catch(() => undefined)
    }
    return { message: targets.length === 1 ? `Cancelled ${targets[0]!.title}.` : `Cancelled ${targets.length} background jobs.` }
  }

  /** The user's words put into a running job: redirected now, or taken after the step Hermes is finishing. */
  async followUp(jobId: string, words: string): Promise<Record<string, string>> {
    const text = words.trim()
    const job = this.jobs.find(j => j.id === jobId.trim())
    if (!job) return { status: 'error', error: 'Unknown job_id. Call list_jobs for the jobs\u2019 ids. For work in the attached chat, use ask_thread.' }
    if (!text) return { status: 'error', error: 'message is required' }
    const quoted = `"${job.title}"`
    if (job.status !== 'running' || !job.sid)
      return { status: 'not_sent', message: `${quoted} had already finished, so Hermes didn't get this. Tell the user, and ask what they want instead.` }
    let outcome: Correction
    try {
      outcome = await this.correct(job.sid, `(voice) ${text}`, this.profile)
    } catch (e) {
      if (correctionMayHaveGone(e)) {
        return { status: 'unknown', message: `The redirect to ${quoted} may have reached Hermes; don't send it again unless the user asks.` }
      }
      return { status: 'not_sent', error: message(e) }
    }
    if (outcome === 'redirected')
      return {
        status: 'sent',
        message: `Hermes took the user's words into ${quoted} at once and changes course now. Tell the user in a few words; the result still comes back later on this call, so don't guess it.`
      }
    if (outcome === 'queued')
      return {
        status: 'sent',
        message: `Hermes takes the user's words into ${quoted} right after the step it is finishing. Tell the user in a few words; the result still comes back later on this call, so don't guess it.`
      }
    return { status: 'not_sent', message: `${quoted} had already finished, so Hermes didn't get this. Tell the user, and ask what they want instead.` }
  }

  private event(event: { type: string; session_id?: string; payload?: unknown }) {
    const job = this.jobs.find(j => j.sid && j.sid === event.session_id)
    if (!job || job.status !== 'running') return
    const payload = (event.payload ?? {}) as Row
    if (event.type === 'message.delta') {
      this.text.set(job.id, (this.text.get(job.id) ?? '') + (str(payload.text) ?? ''))
      return
    }
    // An error notice may come before the turn ends: kept, and said if the turn then fails.
    if (event.type === 'error') {
      this.update(job.id, { error: str(payload.message) ?? str(payload.error) })
      return
    }
    if (event.type !== 'message.complete') return
    const status = str(payload.status)
    if (status === 'interrupted') return this.update(job.id, { status: 'cancelled' })
    if (status === 'error') {
      const error = str(payload.error) ?? str(payload.failure_reason) ?? job.error ?? 'the turn failed'
      this.update(job.id, { status: 'failed', error })
      this.tell({ ...job, status: 'failed', error })
      return
    }
    const reply = (str(payload.text) ?? str(payload.rendered) ?? this.text.get(job.id) ?? '').trim()
    this.update(job.id, { status: 'done', reply })
    this.tell({ ...job, status: 'done', reply })
  }
}
