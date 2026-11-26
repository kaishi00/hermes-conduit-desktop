import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  WORK,
  actionTitle,
  answerRequest,
  canDismiss,
  goingAheadText,
  questionButtons,
  questionHeadline,
  doing,
  doneCount,
  handOverCaption,
  manageTitle,
  needsYou,
  workMenuItems,
  workTone,
  parseWork,
  sections,
  shownTitle,
  statusText,
  workPath,
  workRefusal,
  type QuestionAnswer,
  type WorkAction,
  type WorkItem,
  type WorkQuestion,
  type WorkManage,
  type WorkSnapshot
} from '../state/work'
import { Markdown } from './Markdown'
import { Icon } from './icons'
import { timeLabel } from '../state/chats'
import { askedInOf, dropExpiredAsking, type AskedIn, type OpenChat } from '../state/expiredQuestions'
import { useFittedMenu } from '../state/menuFit'
import type { WaitingRow } from '../state/needsYou'

interface Props {
  profile?: string
  botName: string
  snapshot: WorkSnapshot | null
  error: string | null
  onReload: () => void
  /** A question answered here: Needs you reads its list again, so its row goes now. */
  onAnswered?: () => void
  onOpenChat: (item: WorkItem) => void
  /** Reads a row's chat ahead as the pointer or focus reaches it, so opening it draws it at once (desktop#612). */
  onReadAhead?: (item: WorkItem) => void
  onClose: () => void
  /** The side panel's tabs, atop it. */
  tabs?: ReactNode
  /** The chat the panel sits beside, so a dismissed question's kept card leaves the chat that asked and no other. */
  openChat?: OpenChat
}

type WorkCardAction = WorkAction | WorkManage | 'approve' | 'deny'
const nativeMenuTarget = 'input, textarea, a[href]'

/** A link, a field or text selected in the card keeps the system's own menu, by mouse or keyboard. */
function keepsNativeMenu(card: Element, target: Element): boolean {
  if (target.closest(nativeMenuTarget)) return true
  const sel = window.getSelection()
  return (
    !!sel?.toString().trim() &&
    ((!!sel.anchorNode && card.contains(sel.anchorNode)) || (!!sel.focusNode && card.contains(sel.focusNode)))
  )
}

/** What a refusal on a card was about: once a refresh changes any of it, the refusal is stale. */
const workStamp = (item: WorkItem) => `${item.status}|${item.updatedAt}|${item.closed}|${item.pinned}`

function WorkCard({
  item,
  movingFocus,
  botName,
  busy,
  problem,
  onAct,
  onCopyBranch,
  onOpenChat,
  onReadAhead,
  onOpenMenu
}: {
  item: WorkItem
  movingFocus: RefObject<string | null>
  botName: string
  busy: boolean
  problem: string | null
  onAct: (ref: string, action: WorkCardAction, body?: Record<string, unknown>) => Promise<boolean>
  onCopyBranch: (item: WorkItem) => Promise<void>
  onOpenChat: (item: WorkItem) => void
  onReadAhead?: (item: WorkItem) => void
  onOpenMenu: (item: WorkItem, x: number, y: number, opener: HTMLElement | null) => void
}) {
  const [expanded, setExpanded] = useState(needsYou(item))
  const [reply, setReply] = useState('')
  const cardRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const card = cardRef.current
    return () => {
      if (card?.contains(document.activeElement)) movingFocus.current = item.ref
    }
  }, [item.ref, movingFocus])
  const now = doing(item)

  const act = async (action: WorkCardAction, body: Record<string, unknown> = {}) => {
    const ok = await onAct(item.ref, action, body)
    if (ok && action === 'send') setReply('')
  }

  // A workstream with a chat opens it on one click (Eric 2026-11-21); the chevron opens the card in place.
  const opensChat = item.kind === 'workstream' && !!item.sessionId
  const hasMenu = workMenuItems(item, botName).length > 0
  const handOver = item.manage.find(manage => manage === 'leave_alone' || manage === 'coordinate')
  const rowManage = item.manage.filter(manage => manage !== handOver)
  const tone = workTone(item)
  // The mark follows the status, as the phone's BotWorkLook.symbol: a stopped card is grey with a stop mark, not a check.
  const mark =
    tone === 'needs' ? 'bell' : tone === 'working' ? 'spinner' : tone === 'failed' ? 'close' : !item.closed && item.status === 'stopped' ? 'stop' : 'check'

  return (
    <div
      ref={cardRef}
      className={`work-card tone-${tone}`}
      onContextMenu={e => {
        if (!hasMenu) return
        const target = e.target as Element
        if (keepsNativeMenu(e.currentTarget, target)) return
        e.preventDefault()
        e.stopPropagation()
        const opener = target.closest('button') ?? e.currentTarget.querySelector('button')
        const box = (opener ?? e.currentTarget).getBoundingClientRect()
        // A keyboard-made contextmenu event comes at (0, 0): place it under the card's button instead.
        const fromPointer = e.clientX !== 0 || e.clientY !== 0
        const x = fromPointer ? e.clientX : Math.round(box.left + 12)
        const y = fromPointer ? e.clientY : Math.round(box.bottom)
        onOpenMenu(item, x, y, opener)
      }}
      onKeyDown={e => {
        if (!hasMenu) return
        if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
        const target = e.target as Element
        if (keepsNativeMenu(e.currentTarget, target)) return
        e.preventDefault()
        e.stopPropagation()
        const opener = target.closest('button') ?? e.currentTarget.querySelector('button')
        const box = (opener ?? e.currentTarget).getBoundingClientRect()
        onOpenMenu(item, Math.round(box.left + 12), Math.round(box.bottom), opener)
      }}
    >
      <div className="work-card-top">
        <span className={`status-mark tone-${tone}`} aria-hidden="true">
          <Icon name={mark} />
        </span>
        <button
          className="work-card-head"
          data-work-ref={item.ref}
          aria-expanded={opensChat ? undefined : expanded}
          title={opensChat ? t('Open {ref}’s chat', { ref: item.ref }) : undefined}
          onPointerEnter={opensChat ? () => onReadAhead?.(item) : undefined}
          onFocus={opensChat ? () => onReadAhead?.(item) : undefined}
          onClick={() => (opensChat ? onOpenChat(item) : setExpanded(!expanded))}
        >
          <span className="work-card-line">
            <span className="work-ref">{item.ref}</span>
            {now ? <span className="meta">{now}</span> : null}
            {item.pinned ? (
              <span className="meta" aria-label={t('Pinned')}>
                <Icon name="pin" />
              </span>
            ) : null}
            <span className={`status-chip tone-${tone}`} title={statusText(item)}>
              <span className="status-chip-text">{statusText(item)}</span>
            </span>
          </span>
          <span className="work-card-title">{shownTitle(item)}</span>
        </button>
        {opensChat ? (
          <button
            className="work-card-more"
            aria-expanded={expanded}
            aria-label={`${item.ref}: ${t('Details')}`}
            aria-controls={expanded ? `work-details-${item.ref}` : undefined}
            title={t('Details')}
            onClick={() => setExpanded(!expanded)}
          >
            <Icon name="chevronDown" style={expanded ? { transform: 'rotate(180deg)' } : undefined} />
          </button>
        ) : null}
      </div>
      {item.model ? <div className="meta work-model">{t('Runs on {model}', { model: item.model })}</div> : null}
      {item.checklist.length ? (
        <div className="work-progress" aria-label={t('{done} of {all}', { done: String(doneCount(item)), all: String(item.checklist.length) })}>
          <span className="usage-meter">
            <span style={{ width: `${(doneCount(item) / item.checklist.length) * 100}%` }} />
          </span>
          <span className="meta">{t('{done} of {all}', { done: String(doneCount(item)), all: String(item.checklist.length) })}</span>
        </div>
      ) : null}
      {item.approval ? (
        <div className="work-approval">
          {item.approval.description ? <div>{item.approval.description}</div> : null}
          {item.approval.command ? <code>{item.approval.command}</code> : null}
          {!item.approval.approvable ? <div className="meta">{t('This card can’t show all of it. Approve it in its chat, or deny it here.')}</div> : null}
          <div className="pset-actions">
            {item.approval.approvable ? (
              <button className="primary" disabled={busy} onClick={() => void act('approve', { request_id: item.approval!.requestId })}>
                {t('Approve')}
              </button>
            ) : null}
            <button className="secondary" disabled={busy} onClick={() => void act('deny', { request_id: item.approval!.requestId })}>
              {t('Deny')}
            </button>
          </div>
        </div>
      ) : null}
      {expanded ? (
        <div id={`work-details-${item.ref}`} className="work-details">
          {item.checklist.length ? (
            <ul className="work-checklist">
              {item.checklist.map((step, index) => (
                <li key={index} className={`step-${step.state}`}>
                  {step.text}
                </li>
              ))}
            </ul>
          ) : null}
          {item.result ? (
            <div className="work-result">
              <Markdown text={item.result} />
            </div>
          ) : null}
          {item.error ? <div className="meta">{item.error}</div> : null}
          {item.branch ? (
            <div className="meta work-branch">
              {t('Branch {name}', { name: item.branch })}{' '}
              <button className="link" onClick={() => void onCopyBranch(item)}>
                {t('Copy Branch')}
              </button>
            </div>
          ) : null}
          {item.actions.includes('send') ? (
            <form
              className="work-reply"
              onSubmit={e => {
                e.preventDefault()
                if (reply.trim()) void act('send', { text: reply.trim() })
              }}
            >
              <input
                value={reply}
                onChange={e => setReply(e.target.value)}
                placeholder={t('Reply to {ref}…', { ref: item.ref })}
                aria-label={t('Reply to {ref}…', { ref: item.ref })}
                disabled={busy}
              />
              <button type="submit" className="round send" aria-label={t('Send to {ref}', { ref: item.ref })} disabled={busy || !reply.trim()}>
                <Icon name="send" />
              </button>
            </form>
          ) : null}
          <div className="work-buttons">
            {item.sessionId && item.kind === 'workstream' ? (
              <button className="secondary" aria-label={t('Open {ref}’s chat', { ref: item.ref })} onClick={() => onOpenChat(item)}>
                <Icon name="chats" />
                {t('Open chat')}
              </button>
            ) : null}
            {item.actions
              .filter(action => action !== 'send')
              .map(action => (
                <button key={action} className="secondary" disabled={busy} onClick={() => void act(action)}>
                  {actionTitle(action)}
                </button>
              ))}
            {rowManage.length ? (
              <span className="work-manage">
                {rowManage.map(manage => (
                  <button key={manage} className="ghost" disabled={busy} onClick={() => void act(manage)}>
                    {manageTitle(manage, botName)}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
          {handOver ? (
            // Its own row, saying who is kept out and what that means (Eric 2026-11-21: "Leave Alone" was vague).
            <div className="work-hand-over">
              <button className="secondary" disabled={busy} onClick={() => void act(handOver)}>
                {manageTitle(handOver, botName)}
              </button>
              <span className="meta">{handOverCaption(handOver, botName)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {problem ? <div className="error-text" role="alert">{problem}</div> : null}
    </div>
  )
}

/**
 * A question the bot asked and waits on past its turn, after the phone's
 * BotWorkQuestionCard: Approve and Decline, or one button per choice with the
 * recommended one filled; a kept clarify question with no choices is answered
 * in its chat in words. The answer wakes the chat that asked.
 */
export function QuestionCard({
  question,
  profile,
  onChanged,
  inChat = false,
  askedIn
}: {
  question: WorkQuestion
  profile?: string
  onChanged: () => void
  /** Drawn over the chat that asked, whose composer answers one with no buttons. */
  inChat?: boolean
  /** The chat that asked, where the caller knows it: a dismissal takes the kept card out of that chat only. */
  askedIn?: AskedIn
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const going = goingAheadText(question)
  // No button to answer with (words only, or an action this app doesn't know): it's answered in its chat.
  const buttons = questionButtons(question)

  const answer = async (given: QuestionAnswer) => {
    const { action, body } = answerRequest(given)
    setBusy(true)
    setProblem(null)
    try {
      await gateway.http('POST', workPath(`${WORK}/${encodeURIComponent(question.id)}/${action}`, profile), body)
      if (given.kind === 'dismiss') dropExpiredAsking(question.text, askedIn)
      onChanged()
    } catch (e) {
      setProblem(workRefusal(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="work-card tone-needs work-question">
      <div className="work-question-top">
        <span className="work-question-head">{questionHeadline(question)}</span>
        {question.at ? <span className="meta row-time">{timeLabel(question.at)}</span> : null}
      </div>
      {question.title ? <div className="meta work-question-title">{question.title}</div> : null}
      {question.text ? (
        <div className="work-question-text">
          <Markdown text={question.text} />
        </div>
      ) : null}
      {going ? <div className="meta work-question-state">{going}</div> : null}
      {buttons.length === 0 ? (
        <div className="meta">{inChat ? t('Answer it below, in your own words.') : t('Answer it in its chat, in your own words.')}</div>
      ) : (
        <div className="pset-actions work-question-answers">
          {buttons.map((button, index) => (
            <button
              key={index}
              className={button.recommended || button.answer.kind === 'approve' ? 'primary' : 'secondary'}
              title={button.recommended ? t('Recommended') : undefined}
              disabled={busy}
              onClick={() => void answer(button.answer)}
            >
              {button.label}
            </button>
          ))}
        </div>
      )}
      {canDismiss(question) ? (
        <button
          className="link work-question-dismiss"
          title={t('Takes it off your list without answering')}
          disabled={busy}
          onClick={() => void answer({ kind: 'dismiss' })}
        >
          {t('Dismiss question')}
        </button>
      ) : null}
      {problem ? <div className="error-text">{problem}</div> : null}
    </div>
  )
}

/**
 * The question the chat on screen's bot asked that waits past its turn, over
 * its transcript, after the phone's ChatAskedQuestionBar: the oldest first,
 * the next once it's answered.
 */
export function AskedQuestionBar({
  rows,
  onChanged,
  liveId
}: {
  rows: readonly WaitingRow[]
  onChanged: () => void
  /** The live session of the chat on screen, which asked these. */
  liveId?: string | null
}) {
  const first = rows[0]
  if (!first?.question) return null
  return (
    <div className="asked-question-bar">
      <QuestionCard
        key={first.id}
        question={first.question}
        profile={first.profile}
        onChanged={onChanged}
        inChat
        askedIn={liveId ? { live: liveId } : undefined}
      />
      {rows.length > 1 ? <div className="meta asked-question-more">{t('{count} more waiting', { count: rows.length - 1 })}</div> : null}
    </div>
  )
}

/**
 * The Work panel beside a Bot Chat, after the phone's: count chips, then
 * Pinned, Active (what needs you first) and Recent folded to three, and the
 * Resolved list. Each card shows where its workstream is, and takes the
 * user's own actions, which skip the Bot Chat's model.
 */
export function WorkPanel({ profile, botName, snapshot, error, onReload, onAnswered, onOpenChat, onReadAhead, onClose, tabs, openChat }: Props) {
  const [allRecent, setAllRecent] = useState(false)
  const [resolved, setResolved] = useState<WorkItem[] | null>(null)
  const [resolvedError, setResolvedError] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const movingFocus = useRef<string | null>(null)
  // Pinning moves the focused card between sections, replacing its DOM button.
  useLayoutEffect(() => {
    const ref = movingFocus.current
    movingFocus.current = null
    if (ref && document.activeElement === document.body) {
      Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('.work-card-head') ?? [])
        .find(button => button.dataset.workRef === ref)?.focus({ preventScroll: true })
    }
  })
  const [busyByRef, setBusyByRef] = useState<Record<string, boolean>>({})
  // A refusal is kept with what its card looked like, and drops once a refresh changes the card.
  const [problemByRef, setProblemByRef] = useState<Record<string, { text: string; stamp: string | null }>>({})
  const busyRefs = useRef(new Set<string>())
  const [menu, setMenu] = useState<{ ref: string; x: number; y: number } | null>(null)
  const menuFit = useFittedMenu<HTMLDivElement>(menu)
  const openerRef = useRef<HTMLElement | null>(null)
  const restoreFocusRef = useRef(false)
  const focusedMenuRef = useRef<{ ref: string; x: number; y: number } | null>(null)

  const showResolved = async () => {
    setMenu(null)
    setResolvedError(null)
    try {
      const answer = (await gateway.http('GET', workPath(`${WORK}?resolved=1`, profile))) as { work?: unknown }
      setResolved(parseWork(answer).items)
    } catch (e) {
      setResolvedError(workRefusal(e))
    }
  }

  const changed = () => {
    onReload()
    if (resolved) void showResolved()
  }

  const clearProblem = (ref: string) => {
    setProblemByRef(current => {
      if (!(ref in current)) return current
      const next = { ...current }
      delete next[ref]
      return next
    })
  }

  // stamp null: a clipboard failure, which no refresh makes stale; it stays until the next try.
  const refuse = (ref: string, error: unknown, stamp: string | null) => {
    setProblemByRef(current => ({ ...current, [ref]: { text: workRefusal(error), stamp } }))
  }

  const problemOf = (item: WorkItem): string | null => {
    const problem = problemByRef[item.ref]
    return problem && (problem.stamp === null || problem.stamp === workStamp(item)) ? problem.text : null
  }

  // A card that leaves both lists takes its refusal with it.
  useEffect(() => {
    const refs = new Set([...(snapshot?.items ?? []), ...(resolved ?? [])].map(item => item.ref))
    setProblemByRef(current => {
      const gone = Object.keys(current).filter(ref => !refs.has(ref))
      if (!gone.length) return current
      const next = { ...current }
      for (const ref of gone) delete next[ref]
      return next
    })
  }, [snapshot, resolved])

  const copyBranch = async (item: WorkItem) => {
    clearProblem(item.ref)
    try {
      await navigator.clipboard.writeText(item.branch)
    } catch (e) {
      refuse(item.ref, e, null)
    }
  }

  const act = async (ref: string, action: WorkCardAction, body: Record<string, unknown> = {}): Promise<boolean> => {
    if (busyRefs.current.has(ref)) return false
    busyRefs.current.add(ref)
    setBusyByRef(current => ({ ...current, [ref]: true }))
    clearProblem(ref)
    // What the card looked like when it was asked: a refusal is about that state.
    const asked = [...(resolved ?? []), ...(snapshot?.items ?? [])].find(row => row.ref === ref)
    const stamp = asked ? workStamp(asked) : ''
    try {
      await gateway.http('POST', workPath(`${WORK}/${encodeURIComponent(ref)}/${action}`, profile), body)
      changed()
      return true
    } catch (e) {
      refuse(ref, e, stamp)
      return false
    } finally {
      busyRefs.current.delete(ref)
      setBusyByRef(current => {
        if (!(ref in current)) return current
        const next = { ...current }
        delete next[ref]
        return next
      })
    }
  }

  const lists = snapshot ? sections(snapshot.items) : null
  const recent = lists ? (allRecent ? lists.recent : lists.recent.slice(0, 3)) : []
  const visibleItems = resolved ?? (menu && lists ? [...lists.pinned, ...lists.active, ...recent] : [])
  const menuItem = menu ? (visibleItems.find(item => item.ref === menu.ref) ?? null) : null
  const menuEntries = menuItem ? workMenuItems(menuItem, botName) : []

  const closeMenu = (restoreFocus = false) => {
    restoreFocusRef.current = restoreFocus
    setMenu(null)
  }

  useEffect(() => {
    if (menu && menuEntries.length === 0) setMenu(null)
  }, [menu, menuEntries.length])

  useEffect(() => {
    if (!menu) {
      focusedMenuRef.current = null
      if (restoreFocusRef.current) {
        restoreFocusRef.current = false
        if (openerRef.current?.isConnected) openerRef.current.focus()
      }
      return
    }
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu(true)
      }
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const menuReady = !!menu && menuEntries.length > 0 && menuFit.style?.visibility !== 'hidden'
  useEffect(() => {
    if (!menuReady || !menu || focusedMenuRef.current === menu) return
    focusedMenuRef.current = menu
    menuFit.ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [menuReady, menu, menuFit.ref])

  const openMenu = (item: WorkItem, x: number, y: number, opener: HTMLElement | null) => {
    openerRef.current = opener
    restoreFocusRef.current = false
    setMenu({ ref: item.ref, x, y })
  }

  const card = (item: WorkItem) => (
    <WorkCard
      key={item.ref}
      item={item}
      movingFocus={movingFocus}
      botName={botName}
      busy={!!busyByRef[item.ref]}
      problem={problemOf(item)}
      onAct={act}
      onCopyBranch={copyBranch}
      onOpenChat={onOpenChat}
      onReadAhead={onReadAhead}
      onOpenMenu={openMenu}
    />
  )

  return (
    <aside ref={panelRef} className="ws-panel work-panel" aria-label={t('{bot}’s work', { bot: botName })}>
      {tabs}
      <div className="ws-head">
        {resolved ? (
          <button
            className="staged-remove"
            aria-label={t('Back')}
            title={t('Back')}
            onClick={() => {
              setMenu(null)
              setResolved(null)
            }}
          >
            <Icon name="back" />
          </button>
        ) : null}
        <span className="ws-title">{resolved ? t('Resolved') : t('{bot}’s work', { bot: botName })}</span>
        <span className="spacer" />
        <button className="staged-remove" aria-label={t('Refresh')} title={t('Refresh')} onClick={changed}>
          ↻
        </button>
        <button className="staged-remove" aria-label={t('Close')} title={t('Close')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="work-body" onScroll={() => (menu ? setMenu(null) : undefined)}>
        {resolved ? (
          <>
            {resolvedError ? <p className="error-text">{resolvedError}</p> : null}
            {resolved.length ? resolved.map(card) : <p className="meta">{t('Nothing resolved yet.')}</p>}
          </>
        ) : !snapshot ? (
          error ? (
            <div className="work-empty">
              <p className="meta">{t("Couldn't reach this bot's work. Try again in a moment.")}</p>
              <button className="secondary" onClick={onReload}>
                {t('Try Again')}
              </button>
            </div>
          ) : (
            <p className="meta">{t('Loading…')}</p>
          )
        ) : (
          <>
            <div className="work-chips">
              <span className="work-chip tone-needs">
                {t('Needs you')} <strong>{snapshot.needsYou}</strong>
              </span>
              <span className="work-chip tone-working">
                {t('Working')} <strong>{snapshot.working}</strong>
              </span>
              <span className="work-chip tone-ready">
                {t('Ready')} <strong>{snapshot.ready}</strong>
              </span>
            </div>
            {!snapshot.items.length && !snapshot.questions.length ? (
              <p className="meta">
                {snapshot.policy === 'off'
                  ? t('{bot} does everything in its Bot Chat itself. Work that’s already running carries on.', { bot: botName })
                  : t('No work yet')}
              </p>
            ) : null}
            {snapshot.questions.length ? (
              // What the bot asked and waits on comes first: it holds the work up until the user answers.
              <section>
                <h3>{t('Asked you')}</h3>
                {snapshot.questions.map(question => (
                  <QuestionCard
                    key={question.id}
                    question={question}
                    profile={profile}
                    askedIn={askedInOf(question.chat, openChat)}
                    onChanged={() => {
                      changed()
                      onAnswered?.()
                    }}
                  />
                ))}
              </section>
            ) : null}
            {lists!.pinned.length ? (
              <section>
                <h3>{t('Pinned')}</h3>
                {lists!.pinned.map(card)}
              </section>
            ) : null}
            {lists!.active.length ? (
              <section>
                <h3>{t('Active')}</h3>
                {lists!.active.map(card)}
              </section>
            ) : null}
            {lists!.recent.length ? (
              <section>
                <h3>{t('Recent')}</h3>
                {recent.map(card)}
                {lists!.recent.length > 3 ? (
                  <button className="link" onClick={() => setAllRecent(!allRecent)}>
                    {allRecent ? t('Show less') : t('Show all {count}', { count: String(lists!.recent.length) })}
                  </button>
                ) : null}
              </section>
            ) : null}
            {snapshot.resolvedCount > 0 ? (
              <button className="pset-link" onClick={() => void showResolved()}>
                <span>{t('Resolved')}</span>
                <span className="meta">{snapshot.resolvedCount}</span>
                <Icon name="chevron" />
              </button>
            ) : null}
          </>
        )}
      </div>
      {menu && menuItem && menuEntries.length ? (
        <div
          ref={menuFit.ref}
          className="host-menu row-menu"
          role="menu"
          aria-label={menuItem.ref}
          style={menuFit.style}
          onMouseDown={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
          onBlur={e => {
            if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setMenu(null)
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              closeMenu(true)
              return
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
            e.preventDefault()
            e.stopPropagation()
            const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
            if (!items.length) return
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            // With nothing in the menu focused yet, Down starts at the first entry and Up at the last.
            const step = e.key === 'ArrowDown' ? 1 : -1
            const next =
              e.key === 'Home' ? 0 : e.key === 'End' || (index < 0 && step < 0) ? items.length - 1 : index + step
            items[(next + items.length) % items.length]?.focus()
          }}
        >
          {menuEntries.map(entry => {
            const key = entry.kind === 'manage' || entry.kind === 'action' ? `${entry.kind}:${entry.action}` : entry.kind
            const disabled = (entry.kind === 'manage' || entry.kind === 'action') && !!busyByRef[menuItem.ref]
            const hint =
              entry.kind === 'manage' && (entry.action === 'leave_alone' || entry.action === 'coordinate')
                ? handOverCaption(entry.action, botName)
                : undefined
            return (
              <button
                key={key}
                role="menuitem"
                title={hint}
                disabled={disabled}
                onClick={() => {
                  closeMenu(entry.kind !== 'open')
                  if (entry.kind === 'manage' || entry.kind === 'action') {
                    void act(menuItem.ref, entry.action)
                  } else if (entry.kind === 'open') {
                    onOpenChat(menuItem)
                  } else {
                    void copyBranch(menuItem)
                  }
                }}
              >
                {entry.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </aside>
  )
}
