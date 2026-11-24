import { useState, type ReactNode } from 'react'
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
  onClose: () => void
  /** The side panel's tabs, atop it. */
  tabs?: ReactNode
  /** The chat the panel sits beside, so a dismissed question's kept card leaves the chat that asked and no other. */
  openChat?: OpenChat
}

function WorkCard({
  item,
  profile,
  botName,
  onChanged,
  onOpenChat
}: {
  item: WorkItem
  profile?: string
  botName: string
  onChanged: () => void
  onOpenChat: (item: WorkItem) => void
}) {
  const [expanded, setExpanded] = useState(needsYou(item))
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const now = doing(item)

  const act = async (action: WorkAction | WorkManage | 'approve' | 'deny', body: Record<string, unknown> = {}) => {
    setBusy(true)
    setProblem(null)
    try {
      await gateway.http('POST', workPath(`${WORK}/${encodeURIComponent(item.ref)}/${action}`, profile), body)
      if (action === 'send') setReply('')
      onChanged()
    } catch (e) {
      setProblem(workRefusal(e))
    } finally {
      setBusy(false)
    }
  }

  // A workstream with a chat opens it on one click (Eric 2026-11-21); the chevron opens the card in place.
  const opensChat = item.kind === 'workstream' && !!item.sessionId
  const handOver = item.manage.find(manage => manage === 'leave_alone' || manage === 'coordinate')
  const rowManage = item.manage.filter(manage => manage !== handOver)
  const tone = workTone(item)
  // The mark follows the status, as the phone's BotWorkLook.symbol: a stopped card is grey with a stop mark, not a check.
  const mark =
    tone === 'needs' ? 'bell' : tone === 'working' ? 'spinner' : tone === 'failed' ? 'close' : !item.closed && item.status === 'stopped' ? 'stop' : 'check'

  return (
    <div className={`work-card tone-${tone}`}>
      <div className="work-card-top">
        <span className={`status-mark tone-${tone}`} aria-hidden="true">
          <Icon name={mark} />
        </span>
        <button
          className="work-card-head"
          aria-expanded={opensChat ? undefined : expanded}
          title={opensChat ? t('Open {ref}’s chat', { ref: item.ref }) : undefined}
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
              <button className="link" onClick={() => void navigator.clipboard.writeText(item.branch)}>
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
      {problem ? <div className="error-text">{problem}</div> : null}
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
export function WorkPanel({ profile, botName, snapshot, error, onReload, onAnswered, onOpenChat, onClose, tabs, openChat }: Props) {
  const [allRecent, setAllRecent] = useState(false)
  const [resolved, setResolved] = useState<WorkItem[] | null>(null)
  const [resolvedError, setResolvedError] = useState<string | null>(null)

  const showResolved = async () => {
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

  const card = (item: WorkItem) => <WorkCard key={item.ref} item={item} profile={profile} botName={botName} onChanged={changed} onOpenChat={onOpenChat} />
  const lists = snapshot ? sections(snapshot.items) : null
  const recent = lists ? (allRecent ? lists.recent : lists.recent.slice(0, 3)) : []

  return (
    <aside className="ws-panel work-panel" aria-label={t('{bot}’s work', { bot: botName })}>
      {tabs}
      <div className="ws-head">
        {resolved ? (
          <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={() => setResolved(null)}>
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
      <div className="work-body">
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
    </aside>
  )
}
