/**
 * Confirmations Hermes waits on (the phone's PresentedScreens.swift): the
 * plugin's `present/exchange` route takes this Conduit's answers and gives
 * back what still waits, per profile. Besides Hermes' own confirmations,
 * these are a room's asks (Ask me first: Share, Say instead or Don't share),
 * a linked person's Hermes' asks (Share only when there's an answer), a
 * room's ask to start work for it (Run work: Start, Change it or Don't
 * start), and a computer's ask (Control from Hermes: Allow or Don't Allow),
 * shown here only for another computer: this one asks in its own dialog.
 *
 * The desktop reports only the ask features: it draws no cards from the
 * exchange, so it never counts among the Conduits whose features decide
 * which cards Hermes draws.
 */

import { t } from '../../../shared/i18n'

export const PRESENT_CAPABILITY = 'present-v1'
export const PRESENT_PATH = '/api/plugins/conduit_push/present/exchange'
export const PRESENT_FEATURES = ['room-asks', 'link-asks', 'room-work', 'pc-asks']
/** The longest Say instead the host keeps. */
export const MAX_EDIT_TEXT = 2000
export const RESULTS_KEY = 'conduit.presentedScreens.results.v1'
const MAX_RESULTS = 40

export interface PresentedRoom {
  id: string
  name: string
  /** Run work's ask: your agent asks before it starts work for the room, or sends to it. */
  work: boolean
}

export interface PresentedLink {
  id: string
  name: string
  /** Whether there's an answer to Share. */
  share: boolean
}

export interface PresentedComputer {
  /** The computer's id: this one's own asks stay in its dialog. */
  computer: string
  name: string
  bot: string
}

export interface PresentedConfirm {
  id: string
  title: string
  /** What will happen, as Markdown. */
  preview: string
  /** The primary action's label ("Send"). */
  actionLabel: string
  /** The chat it came from, if any. */
  sessionId: string | null
  /** Unix seconds. */
  expiresAt: number | null
  room: PresentedRoom | null
  link: PresentedLink | null
  /** A computer's ask: may a chat control that computer? */
  pc: PresentedComputer | null
}

export type ConfirmOutcome = 'confirmed' | 'declined' | 'edit'

type Row = Record<string, unknown>
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null)
const trimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function parsePrompt(value: unknown): PresentedConfirm | null {
  const row = obj(value)
  const id = typeof row?.id === 'string' ? row.id : ''
  const title = trimmed(row?.title)
  if (!row || !id || !title) return null
  const label = trimmed(row.action_label)
  const room = obj(row.room)
  // Any Link the host names makes it a Link's ask, even one that can't be read.
  const link = row.link !== undefined && row.link !== null ? (obj(row.link) ?? {}) : null
  const pc = obj(row.pc)
  return {
    id,
    title: title.slice(0, 120),
    preview: (typeof row.preview === 'string' ? row.preview : '').slice(0, 4000),
    actionLabel: label ? label.slice(0, 32) : t('Confirm'),
    sessionId: typeof row.session_id === 'string' && row.session_id ? row.session_id : null,
    expiresAt: typeof row.expires_at === 'number' ? row.expires_at : null,
    room: room ? { id: trimmed(room.id), name: trimmed(room.name).slice(0, 80), work: room.work === true } : null,
    link: link ? { id: trimmed(link.id), name: trimmed(link.name).slice(0, 80), share: link.share === true } : null,
    pc: pc ? { computer: trimmed(pc.computer), name: trimmed(pc.name).slice(0, 80), bot: trimmed(pc.bot).slice(0, 80) } : null
  }
}

export const isExpired = (prompt: PresentedConfirm, now = Date.now() / 1000) => prompt.expiresAt !== null && prompt.expiresAt <= now
/** A room's or a Link's ask: answered with Share, Say instead or Don't share. */
export const isAsk = (prompt: PresentedConfirm) => !!prompt.room || !!prompt.link
/** A computer's ask: Allow or Don't Allow, nothing to edit or say instead. */
export const isComputerAsk = (prompt: PresentedConfirm) => !!prompt.pc
/** Whether it has something to confirm: a Link's question doesn't. */
export const canConfirm = (prompt: PresentedConfirm) => prompt.link?.share ?? true

/** Who asks: a room's agent, a linked person's Hermes, or Hermes. */
export function askerLine(prompt: PresentedConfirm): string {
  if (prompt.pc) return t('Control from Hermes')
  if (prompt.room?.name) return t('Asked in {name}', { name: prompt.room.name })
  if (prompt.link) return prompt.link.name ? t("{name}'s Hermes asks", { name: prompt.link.name }) : t("A linked person's Hermes asks")
  return t('Hermes asks')
}

export function declineLabel(prompt: PresentedConfirm): string {
  if (!canConfirm(prompt)) return t("Don't answer")
  if (prompt.pc) return t('Don’t Allow')
  // A send to running work isn't a start.
  if (prompt.room?.work) return prompt.actionLabel === 'Send' ? t('Not now') : t("Don't start")
  return isAsk(prompt) ? t("Don't share") : t('Not now')
}

export const insteadLabel = (prompt: PresentedConfirm) => (prompt.room?.work ? t('Change it') : t('Say instead'))
export const insteadPlaceholder = (prompt: PresentedConfirm) => (prompt.room?.work ? t('What it should do instead') : t('What to say instead'))

export interface ConfirmResult {
  id: string
  outcome: ConfirmOutcome
  via: 'tap'
  edit_text?: string
}

/** Answers waiting to reach the host, by scope (host and profile), kept across launches. */
export interface ResultsStore {
  read: (scope: string) => ConfirmResult[]
  write: (scope: string, list: ConfirmResult[]) => void
}

export function localResults(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): ResultsStore {
  const all = (): Record<string, ConfirmResult[]> => {
    try {
      return (JSON.parse(storage.getItem(RESULTS_KEY) ?? '{}') as Record<string, ConfirmResult[]>) ?? {}
    } catch {
      return {}
    }
  }
  return {
    read: scope => (Array.isArray(all()[scope]) ? all()[scope]! : []),
    write: (scope, list) => {
      try {
        const next = all()
        if (list.length) next[scope] = list
        else delete next[scope]
        storage.setItem(RESULTS_KEY, JSON.stringify(next))
      } catch {
        // Kept for this run only.
      }
    }
  }
}

/** Records an answer for the next exchange; the first answer wins. Null when it isn't one to send. */
export function answerResult(prompt: PresentedConfirm, outcome: ConfirmOutcome, editText?: string): ConfirmResult | null {
  // Nothing to confirm (a Link's question): never sent as a Share.
  if (outcome === 'confirmed' && !canConfirm(prompt)) return null
  const result: ConfirmResult = { id: prompt.id, outcome, via: 'tap' }
  const text = editText?.trim()
  if (outcome === 'edit' && text) result.edit_text = text.slice(0, MAX_EDIT_TEXT)
  return result
}

export const withResult = (list: readonly ConfirmResult[], result: ConfirmResult) => [...list.filter(r => r.id !== result.id), result].slice(-MAX_RESULTS)

/**
 * One exchange for `profile`: sends the answers kept for `scope` and gives
 * what still waits, less what was answered here. The answers it sent are
 * dropped from the store.
 */
export async function exchange(
  post: (path: string, body: Row) => Promise<unknown>,
  store: ResultsStore,
  scope: string,
  profile: string,
  device: { installationId: string; name: string; version: string }
): Promise<PresentedConfirm[]> {
  const answers = store.read(scope)
  const path = profile && profile !== 'default' ? `${PRESENT_PATH}?profile=${encodeURIComponent(profile)}` : PRESENT_PATH
  const response = obj(
    await post(path, { installation_id: device.installationId, device: device.name, app_version: device.version, results: answers, features: PRESENT_FEATURES })
  )
  if (!response || !Array.isArray(response.prompts)) throw new Error('not ok')
  const sent = new Set(answers.map(a => a.id))
  const left = store.read(scope).filter(r => !sent.has(r.id))
  store.write(scope, left)
  // Answered here, still listed there until the answer lands: not again.
  const answered = new Set([...sent, ...left.map(r => r.id)])
  return response.prompts.map(parsePrompt).filter((p): p is PresentedConfirm => !!p && !answered.has(p.id) && !isExpired(p))
}
