/**
 * The open chat's turn running in the gateway, as `hermes dashboard` can't
 * show it, after the phone's ChatLiveWork (Eric, 2026-11-27): an API chat's
 * turn, another app's on the Webapp, one a send of this app's was forwarded
 * behind. The dashboard hands a message sent into such a turn to the
 * gateway's queue (its receipt says `forwarded`) and keeps no queue of its
 * own, and the turn's progress, its delegate agents' included, streams only
 * to the client that started it. The plugin reads both where they are
 * (`GET /sessions/live-work`, plugin 0.202.11+): whether a turn runs there,
 * its step and its agents' own steps, and the messages queued behind it.
 */
import type { QueuedPrompt } from './chatQueue'
import { dashboardProfilePath } from './dashboardProfile'

export const LIVE_WORK_PATH = '/api/plugins/conduit_push/sessions/live-work'
/** Between two reads while a turn runs there or a message waits. */
export const LIVE_WORK_READ_MS = 5_000

export interface LiveStep {
  phase: 'thinking' | 'tool' | 'approval' | 'input'
  /** The tool's category, for a tool. */
  tool: string | null
}

export interface LiveAgent {
  /** Its own session. */
  id: string
  goal: string
  step: LiveStep
  /** When it started (Unix seconds). */
  started?: number
}

export interface LiveWork {
  /** A turn of the chat runs in the gateway. */
  running: boolean
  step: LiveStep | null
  agents: LiveAgent[]
  /** The messages waiting behind it (and a turn a restart cut off), oldest first, read-only. */
  queued: QueuedPrompt[]
}

export const noLiveWork: LiveWork = { running: false, step: null, agents: [], queued: [] }

export function liveWorkPath(sessionId: string, profile?: string | null): string {
  return dashboardProfilePath(`${LIVE_WORK_PATH}?session_id=${encodeURIComponent(sessionId)}`, profile)
}

const PHASES = ['thinking', 'tool', 'approval', 'input'] as const
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function stepOf(raw: unknown): LiveStep | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const phase = PHASES.find(p => p === row.phase)
  if (!phase) return null
  return { phase, tool: phase === 'tool' ? (typeof row.tool === 'string' && row.tool ? row.tool : 'tool') : null }
}

export function parseLiveWork(raw: unknown): LiveWork {
  if (!raw || typeof raw !== 'object') return noLiveWork
  const body = raw as Record<string, unknown>
  const agents: LiveAgent[] = []
  for (const value of Array.isArray(body.agents) ? body.agents : []) {
    const row = (value ?? {}) as Record<string, unknown>
    const step = stepOf(row)
    if (typeof row.id !== 'string' || !row.id || !step) continue
    agents.push({ id: row.id, goal: typeof row.goal === 'string' ? row.goal.trim() : '', step, started: num(row.started) })
  }
  const queued: QueuedPrompt[] = []
  for (const value of Array.isArray(body.queued) ? body.queued : []) {
    const row = (value ?? {}) as Record<string, unknown>
    const status = row.status === 'queued' || row.status === 'unknown' ? row.status : null
    if (typeof row.admission_id !== 'string' || !row.admission_id || !status) continue
    queued.push({
      admissionId: row.admission_id,
      inputId: typeof row.input_id === 'string' ? row.input_id : '',
      text: typeof row.text === 'string' ? row.text : '',
      status,
      sequence: num(row.sequence) ?? 0,
      canSendNow: false,
      canEdit: false,
      steering: false,
      readOnly: true
    })
  }
  queued.sort((a, b) => a.sequence - b.sequence)
  return { running: body.running === true, step: stepOf(body.step), agents, queued }
}

/** Something still to follow: a turn running there, or a message waiting. */
export const liveWorkActive = (work: LiveWork) => work.running || work.queued.length > 0

/** A send the dashboard forwarded to the gateway's queue: its row in the dock until the plugin's next read. */
export function forwardedRow(admissionId: string, text: string, after: QueuedPrompt[]): QueuedPrompt {
  const sequence = after.reduce((most, row) => Math.max(most, row.sequence), 0) + 1
  return { admissionId, inputId: '', text, status: 'queued', sequence, canSendNow: false, canEdit: false, steering: false, readOnly: true }
}
