/**
 * A bot's workstreams, after the phone's Work panel: its Bot Chat hands work
 * that needs tools to workstreams, hidden sessions of its own on the bot's
 * profile, followed by ref (W1, W2). The plugin's /workstreams routes list
 * them and take the user's own actions, which skip the Bot Chat's model.
 */
import { t } from '../../../shared/i18n'
import { dashboardProfilePath } from './dashboardProfile'

export const WORK = '/api/plugins/conduit_push/workstreams'

/** The route for a bot: a secondary bot is named with ?conduit_profile=, since its work is driven in the dashboard's own process. */
export const workPath = (path: string, profile?: string): string => dashboardProfilePath(path, profile)

export type WorkKind = 'workstream' | 'ask_out' | 'ask_in'
export type StepState = 'done' | 'doing' | 'todo'
export type WorkAction = 'send' | 'stop' | 'continue' | 'check'
export type WorkManage = 'pin' | 'unpin' | 'resolve' | 'reopen' | 'leave_alone' | 'coordinate'

export interface WorkStep {
  text: string
  state: StepState
}

export interface WorkApproval {
  requestId: string
  command: string
  description: string
  /** The card shows all of the command, so Approve approves what it showed. */
  approvable: boolean
}

export interface WorkItem {
  ref: string
  kind: WorkKind
  status: string
  title: string
  goal: string
  sessionId: string
  closed: boolean
  resolvedBy: string
  pinned: boolean
  leftAlone: boolean
  result: string
  error: string
  checklist: WorkStep[]
  step: string
  agents: number
  branch: string
  /** The model the bot named for this workstream at its start, as the user's words asked (app issue 2788),
   *  with its reasoning ("claude-opus-5-5 · xhigh"); "" when it runs on the Workstream Model. */
  model: string
  bot: string
  screenAsk: string
  approval: WorkApproval | null
  actions: WorkAction[]
  manage: WorkManage[]
  updatedAt: number
}

export interface WorkSnapshot {
  /** "off" when the bot's workstreams are off. */
  policy: string
  items: WorkItem[]
  working: number
  needsYou: number
  ready: number
  resolvedCount: number
  /** Every workstream's chat, listed or not, kept out of the chat lists. */
  sessionIds: string[]
  /** What the bot asked the user and waits on past its turn (work_propose, and clarify questions kept after
   *  they ran out): its Bot Chat's, and its other chats'. */
  questions: WorkQuestion[]
}

/** An open question the bot asked, as the plugin's question_card draws it (notifier 0.189.0). */
export interface WorkQuestion {
  /** Its id (P7): the answer goes to /workstreams/<id>/approve, decline or answer. */
  id: string
  refs: string[]
  /** The titles of the workstreams it's about, joined. */
  title: string
  text: string
  at: number
  /** Approve and Decline, or one button per choice; none when it's answered in its chat in words. */
  actions: ('approve' | 'decline' | 'answer' | 'dismiss')[]
  choices: string[]
  recommended: string
  /** Auto coordination: the bot goes ahead on its recommendation unless the user picks another. */
  goingAhead: boolean
  /** The chat that asked; "" is the Bot Chat. */
  chat: string
}

/** How the user answers a question: the route's action and its body. */
/** Dismiss takes a question off the list with no answer (plugin 0.195.0+, hermes-conduit issue 3105). */
export type QuestionAnswer = { kind: 'approve' } | { kind: 'decline' } | { kind: 'dismiss' } | { kind: 'choice'; choice: string }

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === 'object') : [])
const KINDS: WorkKind[] = ['workstream', 'ask_out', 'ask_in']
const ACTIONS: WorkAction[] = ['send', 'stop', 'continue', 'check']
const MANAGE: WorkManage[] = ['pin', 'unpin', 'resolve', 'reopen', 'leave_alone', 'coordinate']

function modelLabel(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const picked = value as Row
  const model = str(picked.model).trim()
  const effort = str(picked.reasoning_effort).trim()
  return model ? (effort ? `${model} · ${effort}` : model) : ''
}

export function parseItem(row: Row): WorkItem | null {
  const ref = str(row.ref).trim()
  if (!ref) return null
  const approval = row.approval && typeof row.approval === 'object' ? (row.approval as Row) : null
  return {
    ref,
    kind: KINDS.includes(row.kind as WorkKind) ? (row.kind as WorkKind) : 'workstream',
    status: str(row.status),
    title: str(row.title).trim(),
    goal: str(row.goal).trim(),
    sessionId: str(row.session_id),
    closed: row.closed === true,
    resolvedBy: str(row.resolved_by),
    pinned: row.pinned === true,
    leftAlone: row.left_alone === true,
    result: str(row.result),
    error: str(row.error),
    checklist: rows(row.checklist)
      .map(step => ({ text: str(step.text).trim(), state: (['done', 'doing'].includes(str(step.state)) ? str(step.state) : 'todo') as StepState }))
      .filter(step => step.text),
    step: str(row.step),
    agents: Math.max(0, Math.round(num(row.agents))),
    branch: str(row.branch),
    model: modelLabel(row.model),
    bot: str(row.bot),
    screenAsk: str(row.screen_ask),
    approval:
      approval && str(approval.request_id)
        ? {
            requestId: str(approval.request_id),
            command: str(approval.command),
            description: str(approval.description),
            approvable: approval.approvable === true
          }
        : null,
    actions: (Array.isArray(row.actions) ? row.actions : []).filter((a): a is WorkAction => ACTIONS.includes(a as WorkAction)),
    manage: (Array.isArray(row.manage) ? row.manage : []).filter((m): m is WorkManage => MANAGE.includes(m as WorkManage)),
    updatedAt: num(row.updated_at) * 1000
  }
}

const QUESTION_ACTIONS = ['approve', 'decline', 'answer', 'dismiss'] as const
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [])

/** A question card's row, or null when it isn't an open question. */
export function parseQuestion(row: Row): WorkQuestion | null {
  const id = str(row.id).trim()
  if (!id || row.kind !== 'proposal' || str(row.status) !== 'open') return null
  return {
    id,
    refs: strings(row.refs),
    title: str(row.title).trim(),
    text: str(row.text).trim(),
    // Seconds, as the plugin sends; milliseconds kept as they are.
    at: num(row.at) > 0 && num(row.at) < 1e11 ? num(row.at) * 1000 : num(row.at),
    actions: (Array.isArray(row.actions) ? row.actions : []).filter((a): a is WorkQuestion['actions'][number] =>
      (QUESTION_ACTIONS as readonly unknown[]).includes(a)
    ),
    choices: strings(row.choices),
    recommended: str(row.recommended),
    goingAhead: row.going_ahead === true,
    chat: str(row.chat)
  }
}

/** The open questions in a /workstreams read's coordination list (or a /waiting read's questions). */
export function parseQuestions(list: unknown): WorkQuestion[] {
  const seen = new Set<string>()
  const out: WorkQuestion[] = []
  for (const row of rows(list)) {
    const question = parseQuestion(row)
    if (question && !seen.has(question.id)) {
      seen.add(question.id)
      out.push(question)
    }
  }
  return out
}

/** Answered in its chat in words: a kept clarify question with no choices offers its card no buttons. */
export const answersInWords = (question: WorkQuestion) =>
  question.actions.includes('answer') && question.choices.length === 0

/** The buttons a question's card offers: one per choice, or Approve and Decline. */
export function questionButtons(question: WorkQuestion): { answer: QuestionAnswer; label: string; recommended: boolean }[] {
  if (question.actions.includes('answer'))
    return question.choices.map(choice => ({ answer: { kind: 'choice', choice }, label: choice, recommended: choice === question.recommended }))
  if (question.actions.includes('approve') && question.actions.includes('decline'))
    return [
      { answer: { kind: 'approve' }, label: t('Approve'), recommended: false },
      { answer: { kind: 'decline' }, label: t('Decline'), recommended: false }
    ]
  return []
}

/** Whether an open question offers Dismiss: the plugin lists it among the question's actions (0.195.0+). */
export function canDismiss(question: WorkQuestion): boolean {
  return question.actions.includes('dismiss')
}

/** The route's action and body for an answer. */
export function answerRequest(answer: QuestionAnswer): { action: string; body: Record<string, unknown> } {
  return answer.kind === 'choice' ? { action: 'answer', body: { choice: answer.choice } } : { action: answer.kind, body: {} }
}

/** The card's headline: what it's about, as the phone's. */
export function questionHeadline(question: WorkQuestion): string {
  return question.refs.length ? t('Asked you about {refs}', { refs: question.refs.join(', ') }) : t('Asked you')
}

/** Under an open question that the bot goes ahead on: what it does unless the user answers. */
export function goingAheadText(question: WorkQuestion): string | null {
  if (!question.goingAhead) return null
  return question.recommended
    ? t('Going ahead with “{choice}” unless you pick another', { choice: question.recommended })
    : t('Going ahead unless you say no')
}

export function parseWork(raw: unknown): WorkSnapshot {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  const counts = (o.counts && typeof o.counts === 'object' ? o.counts : {}) as Row
  const seen = new Set<string>()
  const items: WorkItem[] = []
  for (const row of rows(o.work)) {
    const item = parseItem(row)
    if (item && !seen.has(item.ref)) {
      seen.add(item.ref)
      items.push(item)
    }
  }
  return {
    policy: str(o.policy),
    items,
    working: num(counts.working),
    needsYou: num(counts.needs_you),
    ready: num(counts.ready),
    resolvedCount: num(o.resolved_count),
    sessionIds: (Array.isArray(o.workstream_sessions) ? o.workstream_sessions : []).filter((id): id is string => typeof id === 'string' && !!id),
    questions: parseQuestions(o.coordination && typeof o.coordination === 'object' ? (o.coordination as Row).items : undefined)
  }
}

export const isWorking = (item: WorkItem) => item.status === 'starting' || item.status === 'running'

/** Still the bot's or the user's to finish; a screen ask keeps a done row here until it's answered. */
export const isActive = (item: WorkItem) =>
  !item.closed && (['starting', 'running', 'needs_you', 'waiting', 'ready', 'interrupted'].includes(item.status) || !!item.screenAsk)

/** Waiting on the user: an approval or a question in its chat, or a restart that left it for them. */
export const needsYou = (item: WorkItem) =>
  item.kind === 'workstream' && !item.closed && (item.status === 'needs_you' || item.status === 'interrupted' || !!item.screenAsk)

/** A card's status color (Eric, 2026-11-20): needs you orange, working blue, ready green, failed red, the rest grey. */
export type WorkTone = 'needs' | 'working' | 'ready' | 'failed' | 'done'
export function workTone(item: WorkItem): WorkTone {
  if (needsYou(item)) return 'needs'
  if (item.closed) return 'done'
  // As the phone's BotWorkLook.tint: a status that needs you is orange on an ask's row too.
  if (item.status === 'needs_you' || item.status === 'interrupted') return 'needs'
  if (item.status === 'running' || item.status === 'starting' || item.status === 'waiting') return 'working'
  if (item.status === 'ready') return 'ready'
  if (item.status === 'failed') return 'failed'
  return 'done'
}

export const doneCount = (item: WorkItem) => item.checklist.filter(step => step.state === 'done').length

export function shownTitle(item: WorkItem): string {
  return item.title || item.goal || item.ref
}

/** What it's doing now: waiting for agents it started, else its checklist's step in progress, else the tool step it's on. */
export function doing(item: WorkItem): string | null {
  if (!isWorking(item) && item.status !== 'needs_you') return null
  if (isWorking(item) && item.agents > 0) return t('Waiting for {count} background agents', { count: item.agents })
  return item.checklist.find(step => step.state === 'doing')?.text ?? (item.step || null)
}

/** What a bot is doing now, for its row in the Bots list: its newest running workstream's step (Eric, 2026-11-26). */
export function botDoing(snapshot: Pick<WorkSnapshot, 'items'>): string | null {
  const running = snapshot.items.filter(isWorking).sort((a, b) => b.updatedAt - a.updatedAt)
  for (const item of running) {
    const now = doing(item)
    if (now) return now
  }
  return null
}

export function statusWord(status: string): string {
  switch (status) {
    case 'starting':
      return t('Starting')
    case 'running':
      return t('Working')
    case 'needs_you':
      return t('Needs you')
    case 'ready':
      return t('Ready')
    case 'done':
      return t('Done')
    case 'failed':
      return t('Failed')
    case 'stopped':
      return t('Stopped')
    case 'interrupted':
      return t('Interrupted')
    case 'waiting':
      return t('Waiting')
    default:
      return status
  }
}

export function statusText(item: WorkItem): string {
  if (item.closed && ['needs_you', 'interrupted', 'starting', 'running', 'waiting'].includes(item.status)) return t('Resolved')
  if (item.kind === 'workstream' && !item.closed && item.screenAsk) return t('Needs you')
  const other = item.bot || t('Another bot')
  if (item.kind === 'ask_out') {
    if (item.status === 'waiting') return t('Waiting on {bot}', { bot: other })
    if (item.status === 'done') return t('{bot} answered', { bot: other })
    return statusWord(item.status)
  }
  if (item.kind === 'ask_in') return item.status === 'done' ? t('Answered') : t('{bot} asks', { bot: other })
  return statusWord(item.status)
}

/** The panel's lists: Pinned, Active (what needs you first), Recent. */
export function sections(items: WorkItem[]): { pinned: WorkItem[]; active: WorkItem[]; recent: WorkItem[] } {
  const pinned = items.filter(item => item.pinned)
  const shown = items.filter(item => isActive(item) && !item.pinned)
  return {
    pinned,
    active: [...shown.filter(needsYou), ...shown.filter(item => !needsYou(item))],
    recent: items.filter(item => !isActive(item) && !item.pinned)
  }
}

export function actionTitle(action: WorkAction): string {
  switch (action) {
    case 'check':
      return t('Check first')
    case 'continue':
      return t('Continue')
    case 'stop':
      return t('Stop')
    default:
      return t('Send')
  }
}

/** What Keep {bot} out of this means, under its button (the phone's handOverCaption). */
export function handOverCaption(manage: 'leave_alone' | 'coordinate', botName: string): string {
  return manage === 'leave_alone' ? t('{bot} won’t message or stop it. You still can.', { bot: botName }) : t('{bot} can message or stop it again.', { bot: botName })
}

export function manageTitle(manage: WorkManage, botName: string): string {
  switch (manage) {
    case 'pin':
      return t('Pin')
    case 'unpin':
      return t('Unpin')
    case 'resolve':
      return t('Resolve')
    case 'leave_alone':
      return t('Keep {bot} out of this', { bot: botName })
    case 'coordinate':
      return t('Let {bot} coordinate this', { bot: botName })
    default:
      return t('Reopen')
  }
}

export type WorkMenuItem =
  | { kind: 'manage'; action: WorkManage; label: string }
  | { kind: 'action'; action: Exclude<WorkAction, 'send'>; label: string }
  | { kind: 'open'; label: string }
  | { kind: 'copy-branch'; branch: string; label: string }

/** The right-click menu for a Work panel card, after the phone's card contextMenu plus its run actions. */
export function workMenuItems(item: WorkItem, botName: string): WorkMenuItem[] {
  const out: WorkMenuItem[] = item.manage.map(action => ({
    kind: 'manage',
    action,
    label: manageTitle(action, botName)
  }))
  for (const action of item.actions) {
    if (action !== 'send') out.push({ kind: 'action', action, label: actionTitle(action) })
  }
  if (item.kind === 'workstream' && item.sessionId) {
    out.push({ kind: 'open', label: t('Open {ref}’s chat', { ref: item.ref }) })
  }
  if (item.branch) {
    out.push({ kind: 'copy-branch', branch: item.branch, label: t('Copy Branch') })
  }
  return out
}

/** A refused action's words: the plugin's note, else its code. */
export function workRefusal(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** At most this many finished workstreams under the open bot, newest first; its Work column has the rest. */
const RECENT_SHOWN = 5

/** The open bot's workstreams for the sidebar: pinned and active first (what needs you on top), then a few recent ones. */
export function sideWorkstreams(snapshot: WorkSnapshot | null | undefined): WorkItem[] {
  const items = (snapshot?.items ?? []).filter(item => item.kind === 'workstream' && !!item.sessionId)
  const { pinned, active, recent } = sections(items)
  return [...pinned, ...active, ...recent.slice(0, RECENT_SHOWN)]
}

/** Whether a read says what the state already does. */
export function sameWork(
  current: { sessions: ReadonlySet<string>; byBot: ReadonlyMap<string, { working: number; needsYou: number; doing?: string | null }> },
  sessions: ReadonlySet<string>,
  byBot: ReadonlyMap<string, { working: number; needsYou: number; doing?: string | null }>
): boolean {
  if (current.sessions.size !== sessions.size || current.byBot.size !== byBot.size) return false
  for (const id of sessions) if (!current.sessions.has(id)) return false
  for (const [bot, work] of byBot) {
    const was = current.byBot.get(bot)
    if (!was || was.working !== work.working || was.needsYou !== work.needsYou || (was.doing ?? null) !== (work.doing ?? null)) return false
  }
  return true
}
