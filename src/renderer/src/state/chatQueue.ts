/**
 * A chat's queue on the gateway's own listener (the Webapp, Hermes 0.23's
 * session authority), after the phone's AuthorityQueue: every send joins
 * it, a send into a running turn waits there as `queued`, and a turn a
 * gateway restart cut off comes back `unknown` and holds every later
 * message until someone discards it. Hermes lists it as the chat's
 * `pending`, in `session.resume` and in the `session.info` it pushes on
 * every change; `hermes dashboard` keeps none.
 */
import { t } from '../../../shared/i18n'
import { GatewayError } from '../gateway'
import { cleanUserText } from './text'

export type QueueStatus = 'queued' | 'started' | 'unknown' | 'terminal'

export interface QueuedPrompt {
  /** Hermes' id for the admission, which the queue verbs name. */
  admissionId: string
  /** The `submission_id` the send went with. */
  inputId: string
  text: string
  status: QueueStatus
  /** The turn it ran as: a cut-off turn's discard names it. */
  generation?: number
  sequence: number
  /** `prompt.steer_queued` (Send now) is served for it. */
  canSendNow: boolean
  /** `prompt.replace_queued` (Edit) is served for it. */
  canEdit: boolean
  /** On its way into the running turn. */
  steering: boolean
  /**
   * The gateway's queue as the plugin reads it on `hermes dashboard` (liveWork.ts), which serves
   * none of the queue's verbs: the row shows, with nothing to do on it.
   */
  readOnly?: boolean
}

const STATUSES: QueueStatus[] = ['queued', 'started', 'unknown', 'terminal']
const int = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : undefined)

/** The chat's queue from a snapshot's `pending`, oldest first; null when it has none (the dashboard's, or a `session.info` about something else). */
export function queueFrom(value: unknown): QueuedPrompt[] | null {
  if (!Array.isArray(value)) return null
  const rows: QueuedPrompt[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const admissionId = typeof row.admission_id === 'string' ? row.admission_id : ''
    const status = STATUSES.find(s => s === row.status)
    if (!admissionId || !status) continue
    const controls = Array.isArray(row.controls) ? row.controls : []
    rows.push({
      admissionId,
      inputId: typeof row.input_id === 'string' ? row.input_id : '',
      text: typeof row.text === 'string' ? row.text : '',
      status,
      generation: int(row.execution_generation),
      sequence: int(row.sequence) ?? 0,
      canSendNow: controls.includes('steer'),
      canEdit: controls.includes('replace'),
      steering: row.steering === true
    })
  }
  return rows.sort((a, b) => a.sequence - b.sequence)
}

/** Messages waiting their turn. */
export const waitingRows = (rows: QueuedPrompt[]) => rows.filter(row => row.status === 'queued' && !row.steering)
/** Turns a restart cut off. */
export const lostRows = (rows: QueuedPrompt[]) => rows.filter(row => row.status === 'unknown')

/** The words a cut-off turn's Resend sends again: the typed text, without its `@file:` lines and pictures. */
export const resendWords = (text: string) => cleanUserText(text).text.trim()

/** A refusal that says the row isn't waiting any more. */
export function refusalMeansSettled(error: unknown): boolean {
  if (!(error instanceof GatewayError)) return false
  return ['not_found', 'stale_generation', 'admission_terminal'].includes(error.reason ?? error.message)
}

/** What became of the message when Hermes refused a queue action, never a bare refusal token. */
export function queueRefusal(error: unknown): string {
  if (!(error instanceof GatewayError)) return t('Hermes couldn’t be reached. Check the queue before you try again.')
  switch (error.reason ?? error.message) {
    case 'steer_unavailable':
      return t('Hermes can’t take it into this reply yet. It stays queued.')
    case 'admission_started':
      return t('Hermes already started on it.')
    case 'session_idle':
      return t('No reply is running to send it into. It runs next.')
    case 'not_found':
    case 'stale_generation':
    case 'admission_terminal':
      return t('That message isn’t waiting any more.')
    default:
      return error.message
  }
}
