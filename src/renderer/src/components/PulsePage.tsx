import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollPane, useBackScroll } from '../state/keptScroll'
import { locale, t } from '@shared/i18n'
import {
  DOWN_REASONS,
  RESTS,
  actionMessage,
  backReason,
  backText,
  canAct,
  canBeDone,
  canPutAwayForGood,
  clearedTitle,
  hasChat,
  heading,
  isCleared,
  isHeld,
  isRatable,
  isResting,
  layout,
  lookedText,
  reasonTitle,
  refusalText,
  restTitle,
  stamp,
  tint,
  wasUpdated,
  proposalCanUndo,
  proposalInFlight,
  proposalStateText,
  type PulseCard
} from '../state/pulse'
import { askAction, drawsBody, extraActions, lookStyle, type LookAction } from '../state/pulseLook'
import { PulseBriefParts, PulseDateColumn, PulseLookBody } from './PulseLook'
import type { PulseState } from '../state/usePulse'
import { Icon } from './icons'
import type { PulseChip } from '../state/keptHosts'
import { HostBadgeMark } from './CombinedDashboards'
import { Markdown } from './Markdown'
import { PulseLearnedView, PulseLeftOutView } from './PulseLearned'
import { PulseSettings } from './PulseSettings'
import { ask } from '../state/dialogs'
import { useFittedMenu } from '../state/menuFit'

interface Props {
  pulse: PulseState
  /** Opens a card's chat; with `draft`, left in its composer. A card from no chat gets a new chat in Pulse's profile. */
  onOpenChat: (target: { id: string | null; profile: string; title?: string }, draft?: string) => void
  /** Opens Tasks > Board, for a card from a Kanban task's worker; none for another dashboard's feed, whose board isn't drawn here. */
  onOpenBoard?: () => void
  /** Combined dashboards: a chip per host, the one shown picked; another shows that host's feed in place (a docked frame on its kept connection). */
  chips?: PulseChip[]
  onPickHost?: (url: string) => void
  /** The host's bots, for Pulse's settings to name its profile. */
  bots?: readonly { name: string; title: string }[] | null
}

type Menu = { kind: 'down' | 'later'; card: PulseCard; x: number; y: number }

/**
 * The Pulse screen, after the phone's: what's new since the last look, the
 * earlier cards, and Done and cleared, each card with its Why?, Do it, Done,
 * Not now and thumbs. Opening it marks every card seen.
 */
export function PulsePage({ pulse, onOpenChat, onOpenBoard, chips = [], onPickHost, bots }: Props) {
  const { feed, error, availability } = pulse
  const language = locale()
  // The cards unseen when the screen opened stay New until it's left.
  const [fresh, setFresh] = useState<Set<number> | null>(null)
  const [why, setWhy] = useState<Set<number>>(new Set())
  const [showCleared, setShowCleared] = useState(false)
  const [busy, setBusy] = useState<Set<number>>(new Set())
  const [note, setNote] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const menuFit = useFittedMenu(menu)
  const seenSent = useRef(false)
  const [view, setView] = useState<'feed' | 'settings' | 'learned' | 'leftOut'>('feed')
  // Back from Pulse's pages lands where the briefs were.
  const pane = useRef<HTMLElement>(null)
  useBackScroll(view, pane)

  useEffect(() => {
    if (!feed || fresh) return
    setFresh(new Set(feed.cards.filter(card => !card.seenAt && !isCleared(card)).map(card => card.id)))
    if (!seenSent.current && feed.unseen > 0) {
      seenSent.current = true
      void pulse.markSeen().catch(() => undefined)
    }
  }, [feed, fresh, pulse])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const sections = useMemo(() => (feed ? layout(feed.cards, fresh ?? new Set()) : null), [feed, fresh])
  // Done and cleared draws its cards as cleared, an older morning brief a newer one replaced among them.
  const clearedIds = useMemo(() => new Set(sections?.cleared.map(card => card.id)), [sections])

  /** Runs a tap on a card; a refusal says why. */
  const act = async (card: PulseCard, action: () => Promise<unknown>) => {
    setBusy(current => new Set(current).add(card.id))
    setNote(null)
    try {
      await action()
    } catch (e) {
      setNote(refusalText(e))
    } finally {
      setBusy(current => {
        const next = new Set(current)
        next.delete(card.id)
        return next
      })
    }
  }

  const doIt = (card: PulseCard, ask?: LookAction) => {
    const profile = card.profile || feed?.profile || 'default'
    // A pick's Ask leaves its own words in the composer (0.150.0).
    const words = ask?.value ?? actionMessage(card)
    if (hasChat(card)) onOpenChat({ id: card.chatId, profile, title: card.chatTitle || undefined }, words)
    else onOpenChat({ id: null, profile: feed?.profile ?? profile }, words)
    void pulse.acted(card.id).catch(() => undefined)
  }

  const cardView = (card: PulseCard) => {
    // An older morning brief a newer one replaced: under Done and cleared, though not done or swiped away.
    const replaced = !isCleared(card) && clearedIds.has(card.id)
    const cleared = isCleared(card) || replaced
    const isBusy = busy.has(card.id)
    const reason = backReason(card, Date.now(), language) ?? card.why
    const looked = lookedText(card, language)
    const explains = !!(reason || looked)
    const look = card.kind === 'proposal' ? null : card.look
    const style = look ? lookStyle(look.body) : null
    const place = look && drawsBody(look) ? style!.place : 'none'
    const shape = look ? <PulseLookBody body={look.body} framed /> : null
    const brief = look?.body.shape === 'brief' && (look.body.summary || look.body.today.length || look.body.open.length || look.body.held) ? look.body : null
    const ask = !cleared ? askAction(look) : undefined
    // Apple's Maps, Calendar and Reminders links open only on a Mac.
    const extras = extraActions(look).filter(
      a => a.does !== 'open' || window.conduit.platform === 'darwin' || !/^(maps:|calshow:|x-apple-reminderkit:)/i.test(a.value)
    )
    const article = (
      <article
        key={card.id}
        className={`pulse-card${cleared ? ' cleared' : ''}${look ? ' framed' : ''}${look?.body.shape === 'status' ? ' washed' : ''}`}
        style={style ? ({ '--look': style.tint } as React.CSSProperties) : undefined}
      >
        {place === 'band' ? <div className="look-band">{shape}</div> : null}
        <div className="pulse-topic">
          <span className="pulse-dot" style={{ background: tint(card) }} />
          <span className="pulse-heading" style={{ color: tint(card) }}>
            {heading(card)}
          </span>
          {wasUpdated(card) ? (
            <span className="meta">· {t('Updated {time}', { time: stamp(card.updatedAt!, Date.now(), language) })}</span>
          ) : card.createdAt ? (
            <span className="meta">· {stamp(card.createdAt, Date.now(), language)}</span>
          ) : null}
          {isHeld(card) ? <span className="meta">{t('For the morning brief')}</span> : null}
          <span className="spacer" />
          {explains ? (
            <button
              className="link-button"
              aria-expanded={why.has(card.id)}
              onClick={() =>
                setWhy(current => {
                  const next = new Set(current)
                  if (next.has(card.id)) next.delete(card.id)
                  else next.add(card.id)
                  return next
                })
              }
            >
              {t('Why?')}
            </button>
          ) : null}
        </div>
        {place === 'lead' ? shape : null}
        {brief ? (
          <PulseBriefParts summary={brief.summary} today={brief.today} open={brief.open} held={brief.held} />
        ) : (
          <div className={`pulse-news${card.doneAt ? ' done' : ''}${look?.line ? ' headline' : ''}${place === 'lead' ? ' quiet' : ''}`}>
            {card.kind === 'proposal' ? (
              // What Add puts on the phone, in the plugin's words from the change itself.
              <p>{card.proposal?.line || card.title}</p>
            ) : card.kind === 'followup' ? (
              <p>{look?.line || card.news || card.title}</p>
            ) : (
              <Markdown text={look?.line || card.news || card.title} />
            )}
          </div>
        )}
        {look?.detail ? <div className="pulse-detail">{card.kind === 'followup' ? <p>{look.detail}</p> : <Markdown text={look.detail} />}</div> : null}
        {place === 'under' || place === 'side' ? shape : null}
        {card.quote && !cleared && look?.body.shape !== 'promise' ? <p className="pulse-quote">“{card.quote}”</p> : null}
        {hasChat(card) ? (
          <button
            className="pulse-source"
            onClick={() =>
              onOpenChat({
                id: card.chatId,
                profile: card.profile || 'default',
                title: card.chatTitle || undefined
              })
            }
          >
            <Icon name="chats" />
            <span>{card.chatTitle || t('Open the chat')}</span>
          </button>
        ) : card.kanbanTask !== undefined && onOpenBoard ? (
          <button className="pulse-source" onClick={onOpenBoard}>
            <Icon name="tasks" />
            <span>{card.kanbanTask ? t('Kanban task {task}', { task: card.kanbanTask }) : t('Tasks')}</span>
          </button>
        ) : null}
        {why.has(card.id) ? (
          <div className="pulse-why">
            {reason ? <p>{reason}</p> : null}
            {looked ? <p>{looked}</p> : null}
          </div>
        ) : null}
        {card.kind === 'proposal' ? (
          proposalRow(card)
        ) : cleared ? (
          <div className="pulse-actions">
            <span className={`pulse-cleared${isResting(card) ? '' : ' done'}`}>
              <Icon name={isResting(card) ? 'clock' : 'check'} />
              {replaced ? t('Replaced by a newer brief') : clearedTitle(card, Date.now(), language)}
            </span>
            <span className="spacer" />
            {isResting(card) ? (
              <button className="secondary" disabled={isBusy} onClick={() => void act(card, () => pulse.dismiss(card.id, false))}>
                {t('Put back')}
              </button>
            ) : card.doneAt && canBeDone(card) ? (
              <button className="secondary" disabled={isBusy} onClick={() => void act(card, () => pulse.done(card.id, false))}>
                {t('Undo Done')}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="pulse-actions">
            {ask ? (
              <button className="primary" disabled={isBusy} onClick={() => doIt(card, ask)}>
                {ask.label}
              </button>
            ) : canAct(card) ? (
              <button className="primary" disabled={isBusy} onClick={() => doIt(card)}>
                {t('Do it')}
              </button>
            ) : null}
            {canBeDone(card) ? (
              <button className="secondary" disabled={isBusy} onClick={() => void act(card, () => pulse.done(card.id, true))}>
                {t('Done')}
              </button>
            ) : null}
            {extras.map(extra => (
              <button key={extra.does} className="secondary" onClick={() => runExtra(extra)}>
                {extra.label}
              </button>
            ))}
            <button className="secondary" disabled={isBusy} onClick={e => setMenu({ kind: 'later', card, x: e.clientX, y: e.clientY })}>
              {t('Not now')}
            </button>
            <span className="spacer" />
            {isRatable(card) ? (
              <>
                <button
                  className={`thumb${card.rating === 'up' ? ' on' : ''}`}
                  aria-label={t('Useful')}
                  title={t('Useful')}
                  aria-pressed={card.rating === 'up'}
                  disabled={isBusy}
                  onClick={() => void act(card, () => pulse.rate(card.id, 'up'))}
                >
                  👍
                </button>
                <button
                  className={`thumb${card.rating === 'down' ? ' on' : ''}`}
                  aria-label={t('Not useful')}
                  title={t('Not useful')}
                  aria-pressed={card.rating === 'down'}
                  disabled={isBusy}
                  onClick={e => setMenu({ kind: 'down', card, x: e.clientX, y: e.clientY })}
                >
                  👎
                </button>
              </>
            ) : null}
          </div>
        )}
        {card.rating === 'down' && card.reason && !cleared ? <span className="meta pulse-reason">{reasonTitle(card.reason)}</span> : null}
      </article>
    )
    if (place !== 'side' || look?.body.shape !== 'date') return article
    // A date stands as its day down the card's edge.
    return (
      <div key={card.id} className={`pulse-card-row${cleared ? ' cleared' : ''}`} style={{ '--look': style!.tint } as React.CSSProperties}>
        <PulseDateColumn day={look.body.day} />
        {article}
      </div>
    )
  }

  // A suggestion's Add and Not now while it waits, then where it stands, with Undo once added.
  const proposalRow = (card: PulseCard) => {
    const proposal = card.proposal
    if (!proposal) return null
    const isBusy = busy.has(card.id)
    if (proposal.state === 'waiting')
      return (
        <div className="pulse-actions">
          <button className="primary" disabled={isBusy} onClick={() => void act(card, () => pulse.proposal(proposal.id, 'add'))}>
            {t('Add')}
          </button>
          <button
            className="secondary"
            disabled={isBusy}
            title={t("Pulse won't add it")}
            onClick={() => void act(card, () => pulse.proposal(proposal.id, 'dismiss'))}
          >
            {t('Not now')}
          </button>
        </div>
      )
    const undo = async () => {
      const question = proposal.kind === 'add_event' ? t('Remove it from your calendar?') : t('Remove it from your reminders?')
      if (await ask(`${question}\n\n${proposal.line || card.title}`)) void act(card, () => pulse.proposal(proposal.id, 'undo'))
    }
    return (
      <div className="pulse-proposal-state">
        <div className="pulse-actions">
          <span className={`pulse-cleared${proposalCanUndo(proposal) ? ' done' : ''}`}>
            {proposalInFlight(proposal) ? <span className="running" /> : <Icon name={proposalCanUndo(proposal) ? 'check' : 'clock'} />}
            {proposalStateText(proposal)}
          </span>
          <span className="spacer" />
          {proposalCanUndo(proposal) ? (
            <button className="link-button" disabled={isBusy} onClick={undo}>
              {t('Undo')}
            </button>
          ) : null}
        </div>
        {proposal.note && (proposal.state === 'failed' || proposal.state === 'changed') ? <p className="meta">{proposal.note}</p> : null}
      </div>
    )
  }

  // A pick's own buttons: a link opens, a message to send someone is copied for you to paste.
  const runExtra = (extra: LookAction) => {
    if (extra.does === 'open') window.open(extra.value, '_blank', 'noopener')
    else {
      void navigator.clipboard.writeText(extra.value).then(() => setNote(t('Copied')))
    }
  }

  let body: React.ReactNode
  if (availability === 'missing') {
    body = (
      <div className="needs-empty">
        <Icon name="pulse" />
        <p>{t('Update the Conduit plugin on this host to use Pulse.')}</p>
      </div>
    )
  } else if (availability === 'off' && !feed?.cards.length) {
    body = (
      <div className="needs-empty">
        <Icon name="pulse" />
        <strong>{t('Pulse is off')}</strong>
        <button className="secondary" onClick={() => setView('settings')}>
          {t('Turn on Pulse')}
        </button>
      </div>
    )
  } else if (!feed) {
    body = error ? (
      <div className="needs-empty">
        <strong>{t("Couldn't read Pulse")}</strong>
        <p>{error}</p>
        <button className="secondary" onClick={() => void pulse.reload()}>
          {t('Try again')}
        </button>
      </div>
    ) : (
      <p className="meta">{t('Loading…')}</p>
    )
  } else if (!feed.cards.length) {
    body = (
      <div className="needs-empty">
        <Icon name="pulse" />
        <strong>{t('Nothing yet')}</strong>
        <p>{t('Your reports, your morning brief and the news on what Hermes promised to check land here.')}</p>
      </div>
    )
  } else if (sections) {
    const newCount = sections.fresh.length
    body = (
      <>
        <p className="needs-sub">
          {newCount ? t('{count} new since you last looked', { count: newCount }) : !sections.earlier.length ? t("You're all caught up") : null}
        </p>
        {sections.fresh.length ? (
          <>
            <h2 className="pulse-section">{t('New')}</h2>
            {sections.fresh.map(cardView)}
          </>
        ) : null}
        {sections.earlier.length ? (
          <>
            {sections.fresh.length ? <h2 className="pulse-section">{t('Earlier')}</h2> : null}
            {sections.earlier.map(cardView)}
          </>
        ) : null}
        {sections.cleared.length ? (
          <>
            <button className="pulse-cleared-toggle" aria-expanded={showCleared} onClick={() => setShowCleared(open => !open)}>
              {t('Done and cleared')} · {sections.cleared.length}
            </button>
            {showCleared ? sections.cleared.map(cardView) : null}
          </>
        ) : null}
      </>
    )
  }

  return (
    <ScrollPane.Provider value={pane}>
      <main className="needs pulse-page" ref={pane}>
        {view !== 'feed' ? (
          <div className="needs-inner">
            {view === 'settings' ? (
              <PulseSettings onBack={() => setView('feed')} onChanged={() => void pulse.reload()} bots={bots} />
            ) : view === 'learned' ? (
              <PulseLearnedView onBack={() => setView('feed')} onChanged={() => void pulse.reload()} />
            ) : (
              <PulseLeftOutView onBack={() => setView('feed')} onBroughtUp={() => void pulse.reload()} />
            )}
          </div>
        ) : (
          <div className="needs-inner">
            <PulseHostChips chips={chips} onPick={onPickHost} />
            <div className="pulse-head">
              <h1>{t('Pulse')}</h1>
              <span className="spacer" />
              {availability === 'on' ? (
                <>
                  <button className="link-button pulse-head-link" onClick={() => setView('leftOut')}>
                    {t('What Pulse left out')}
                  </button>
                  <button className="link-button pulse-head-link" onClick={() => setView('learned')}>
                    {t('What Pulse learned')}
                  </button>
                </>
              ) : null}
              {availability === 'on' && feed && !feed.quietNow ? (
                <button className="secondary" onClick={() => void pulse.quiet(true).catch(e => setNote(refusalText(e)))}>
                  {t('Quiet for today')}
                </button>
              ) : null}
              {availability !== 'missing' ? (
                <button
                  className="staged-remove pulse-settings-button"
                  aria-label={t('Pulse settings')}
                  title={t('Pulse settings')}
                  onClick={() => setView('settings')}
                >
                  <Icon name="settings" />
                </button>
              ) : null}
            </div>
            {feed?.quietNow ? (
              <div className="pulse-quiet">
                <div>
                  <strong>{t('Pulse is quiet')}</strong>
                  {feed.quietEndsAt ? <span className="meta">{backText(feed.quietEndsAt, Date.now(), language)}</span> : null}
                </div>
                {feed.quietNow === 'until' ? (
                  <button className="secondary" onClick={() => void pulse.quiet(false).catch(e => setNote(refusalText(e)))}>
                    {t('End quiet time')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {note ? (
              <div className="model-note" role="status">
                {note}
                <button className="staged-remove" aria-label={t('Close')} onClick={() => setNote(null)}>
                  <Icon name="close" />
                </button>
              </div>
            ) : null}
            {body}
          </div>
        )}
        {menu ? (
          <div
            ref={menuFit.ref}
            className="host-menu row-menu"
            role="menu"
            style={menuFit.style}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="menu-title">{menu.kind === 'down' ? t('What was wrong with it?') : t('Not now, until when?')}</div>
            {menu.kind === 'down' ? (
              <>
                {DOWN_REASONS.map(reason => (
                  <button
                    key={reason}
                    role="menuitem"
                    onClick={() => {
                      const card = menu.card
                      setMenu(null)
                      void act(card, () => pulse.rate(card.id, 'down', reason))
                    }}
                  >
                    {reasonTitle(reason)}
                  </button>
                ))}
                <button
                  role="menuitem"
                  onClick={() => {
                    const card = menu.card
                    setMenu(null)
                    void act(card, () => pulse.rate(card.id, 'down'))
                  }}
                >
                  {t('Just thumbs down')}
                </button>
              </>
            ) : (
              <>
                {RESTS.map(rest => (
                  <button
                    key={rest}
                    role="menuitem"
                    onClick={() => {
                      const card = menu.card
                      setMenu(null)
                      void act(card, () => pulse.dismiss(card.id, true, rest))
                    }}
                  >
                    {restTitle(rest)}
                  </button>
                ))}
                {canPutAwayForGood(menu.card) ? (
                  <button
                    role="menuitem"
                    onClick={() => {
                      const card = menu.card
                      setMenu(null)
                      void act(card, () => pulse.dismiss(card.id, true))
                    }}
                  >
                    {t("Don't bring it back")}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </main>
    </ScrollPane.Provider>
  )
}

/** Pulse's chip per combined host, the one shown picked; on the feed's page, and over another host's docked feed. */
export function PulseHostChips({ chips, onPick }: { chips: readonly PulseChip[]; onPick?: (url: string) => void }) {
  if (!chips.length) return null
  return (
    <div className="pulse-hosts" role="tablist" aria-label={t('Combine Dashboards')}>
      {chips.map(chip => (
        <button
          key={chip.url}
          role="tab"
          aria-selected={chip.current}
          className={chip.current ? 'on' : undefined}
          onClick={() => !chip.current && onPick?.(chip.url)}
        >
          <HostBadgeMark badge={chip.badge} />
          {chip.badge.name}
          {chip.count ? <span className="pulse-host-count">{chip.count > 99 ? '99+' : chip.count}</span> : null}
        </button>
      ))}
    </div>
  )
}
