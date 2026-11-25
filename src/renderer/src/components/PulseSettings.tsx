import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBackScroll } from '../state/keptScroll'
import { locale, t } from '@shared/i18n'
import { gateway } from '../gateway'
import { PULSE } from '../state/pulse'
import {
  FOLLOWUP_BUDGETS,
  MAX_REPORT_TIMES,
  MEMORY_BUDGETS,
  NUDGES,
  budgets,
  checkTitle,
  dayIn,
  kindTitle,
  nextTime,
  nudgeDetail,
  nudgeTitle,
  parseMemory,
  parseSettings,
  sortedKinds,
  weekdays,
  type MemoryItem,
  type PulseSettings as State
} from '../state/pulseSettings'
import { Icon } from './icons'
import { useMouseBack } from '../state/mouseBack'
import { Select } from './Select'

const NOTE_LIMIT = 1500

/**
 * Pulse's settings, after the phone's Settings > Pulse: on or off, when it
 * speaks up, quiet times, the note to Pulse, what it reads, and behind the
 * scenes. Each change saves at once, as the phone's does; the note saves on
 * Save.
 */
export function PulseSettings({
  onBack,
  onChanged,
  bots
}: {
  onBack: () => void
  onChanged: () => void
  /** The host's bots, to name the profile Pulse runs in as the rest of the app does. */
  bots?: readonly { name: string; title: string }[] | null
}) {
  useMouseBack(onBack)
  // Opens on Pulse's state as it last answered on this dashboard (Screens that open on their last answer).
  const [state, setState] = useState<State | null>(() => {
    const kept = keptAnswer(PULSE)
    return kept ? parseSettings(kept) : null
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const [showMemory, setShowMemory] = useState(false)
  // Back from What Pulse remembers lands where Pulse settings was.
  useBackScroll(showMemory ? 'memory' : 'settings')
  const [showBehind, setShowBehind] = useState(false)
  const language = locale()

  const load = useCallback(async () => {
    try {
      const keep = answerKeeper(PULSE)
      const raw = await gateway.http('GET', PULSE)
      setState(parseSettings(raw))
      keep(raw)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const change = useCallback(
    async (body: Record<string, unknown>) => {
      setSaving(true)
      setError(null)
      try {
        const keep = answerKeeper(PULSE)
        const raw = await gateway.http('PUT', PULSE, body)
        setState(parseSettings(raw))
        keep(raw)
        onChanged()
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setSaving(false)
      }
    },
    [onChanged]
  )

  if (showMemory) return <PulseMemory onBack={() => setShowMemory(false)} onChanged={() => void load()} />

  const head = (
    <div className="pulse-head">
      <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
        <Icon name="back" />
      </button>
      <h1>{t('Pulse settings')}</h1>
    </div>
  )

  if (!state) {
    return (
      <div className="pset">
        {head}
        {error ? (
          <section className="pset-section">
            <p>{t("Couldn't read Pulse's settings.")}</p>
            <p className="error-text">{error}</p>
            <button className="secondary" onClick={() => void load()}>
              {t('Try again')}
            </button>
          </section>
        ) : (
          <p className="meta">{t('Loading Pulse…')}</p>
        )}
      </div>
    )
  }

  const note = noteDraft ?? state.note
  const noteTrimmed = note.trim()
  const noteTooLong = [...noteTrimmed].length > NOTE_LIMIT
  const noteChanged = noteDraft !== null && noteTrimmed !== state.note
  const zone = state.timeZone
  const today = dayIn(zone, Date.now())
  const computerZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const remembered = Object.values(state.memoryCounts).reduce((a, b) => a + b, 0)

  return (
    <div className="pset">
      {head}
      {error ? <p className="error-text">{error}</p> : null}

      <section className="pset-section">
        <h2>{t('Pulse')}</h2>
        <p className="meta">
          {t("Pulse reads your chats, keeps track of what you and Hermes said you'd do, and brings things up as cards on the Pulse screen.")}
        </p>
        <label className="toggle">
          <input type="checkbox" checked={state.enabled} disabled={saving} onChange={e => void change({ enabled: e.target.checked })} />
          {t('Pulse')}
        </label>
        {state.enabled ? (
          state.running ? (
            <p className="meta">{t('Pulse is running on the dashboard.')}</p>
          ) : (
            <p className="pset-warn">{state.hostProblem || t("The dashboard isn't running Pulse. Restart it after updating the plugin.")}</p>
          )
        ) : null}
        {state.staleBuild ? <p className="pset-warn">{t('The dashboard is running an older copy of Pulse. Restart it to use the update.')}</p> : null}
        {state.homeProblem ? <p className="pset-warn">{state.homeProblem}</p> : null}
      </section>

      {state.enabled ? (
        <>
          <section className="pset-section">
            <h2>{t('When Pulse speaks up')}</h2>
            <div className="pset-row">
              <span>{t('How often')}</span>
              <div className="segmented" role="radiogroup" aria-label={t('How often')}>
                {NUDGES.map(level => (
                  <button
                    key={level}
                    role="radio"
                    aria-checked={state.nudge === level}
                    className={state.nudge === level ? 'on' : undefined}
                    disabled={saving}
                    onClick={() => state.nudge !== level && void change({ nudge: level })}
                  >
                    {nudgeTitle(level)}
                  </button>
                ))}
              </div>
            </div>
            <p className="meta">{nudgeDetail(state.nudge)}</p>
            <label className="toggle">
              <input type="checkbox" checked={state.dailyReport} disabled={saving} onChange={e => void change({ daily_report: e.target.checked })} />
              {t('Look through your chats')}
            </label>
            {state.dailyReport ? <ReportTimes times={state.reportTimes} saving={saving} onSave={times => change({ report_times: times })} /> : null}
            <div className="pset-row">
              <span>{t('Morning brief')}</span>
              <input
                type="time"
                className="pset-time"
                value={state.briefTime}
                disabled={saving}
                onChange={e => e.target.value && e.target.value !== state.briefTime && void change({ brief_time: e.target.value })}
              />
            </div>
            <p className="meta">
              {t(
                "Each look that finds something sends one notification. The morning brief comes every day at its time with what's still open, today's calendar and reminders, and anything you've asked to hear less often."
              )}
            </p>
            {state.privatePushes !== null ? (
              <label className="toggle">
                <input type="checkbox" checked={state.privatePushes} disabled={saving} onChange={e => void change({ private_pushes: e.target.checked })} />
                {t('Hide private reminders on the Lock Screen')}
              </label>
            ) : null}
          </section>

          <section className="pset-section">
            <h2>{t('Quiet times')}</h2>
            <strong className="pset-label">{t('Quiet days')}</strong>
            <div className="pset-days">
              {weekdays(language).map(({ day, short, name }) => {
                const on = state.quietDays.includes(day)
                return (
                  <button
                    key={day}
                    className={on ? 'on' : undefined}
                    aria-pressed={on}
                    aria-label={name}
                    title={name}
                    disabled={saving}
                    onClick={() =>
                      void change({
                        quiet_days: on ? state.quietDays.filter(d => d !== day) : [...state.quietDays, day].sort()
                      })
                    }
                  >
                    {short}
                  </button>
                )
              })}
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={state.quietUntil !== null}
                disabled={saving}
                onChange={e =>
                  void change({
                    quiet_until: e.target.checked ? dayIn(zone, Date.now() + 7 * 86_400_000) : null
                  })
                }
              />
              {t('Vacation')}
            </label>
            {state.quietUntil !== null ? (
              <div className="pset-row">
                <span>{t('Back on')}</span>
                <input
                  type="date"
                  className="pset-time"
                  min={dayIn(zone, Date.now() + 86_400_000)}
                  value={dayIn(zone, state.quietUntil * 1000)}
                  disabled={saving}
                  onChange={e => e.target.value && e.target.value > today && void change({ quiet_until: e.target.value })}
                />
              </div>
            ) : null}
            <p className="meta">
              {t(
                'On quiet days and on vacation, Pulse sends nothing on its own: no report and no morning brief, and follow-ups wait for the first brief after. It keeps remembering, and Do it still checks.'
              )}
            </p>
            <label className="toggle">
              <input
                type="checkbox"
                checked={state.night !== null}
                disabled={saving}
                onChange={e =>
                  void change({
                    night: e.target.checked ? ['22:00', '07:00'] : []
                  })
                }
              />
              {t('Night')}
            </label>
            {state.night ? (
              <>
                <div className="pset-row">
                  <span>{t('Night starts')}</span>
                  <input
                    type="time"
                    className="pset-time"
                    value={state.night[0]}
                    disabled={saving}
                    onChange={e => e.target.value && e.target.value !== state.night![1] && void change({ night: [e.target.value, state.night![1]] })}
                  />
                </div>
                <div className="pset-row">
                  <span>{t('Night ends')}</span>
                  <input
                    type="time"
                    className="pset-time"
                    value={state.night[1]}
                    disabled={saving}
                    onChange={e => e.target.value && e.target.value !== state.night![0] && void change({ night: [state.night![0], e.target.value] })}
                  />
                </div>
                <p className="meta">{t("At night, Pulse's notifications wait for the morning brief unless they can't.")}</p>
              </>
            ) : null}
          </section>

          <section className="pset-section">
            <h2>{t('What you want from Pulse')}</h2>
            <textarea
              className="pset-note"
              rows={4}
              value={note}
              placeholder={t('What to always bring up, what to leave out')}
              aria-label={t('Note to Pulse')}
              disabled={saving}
              onChange={e => setNoteDraft(e.target.value)}
            />
            {noteTooLong ? (
              <p className="error-text">
                {t('At most {count} characters.', {
                  count: NOTE_LIMIT.toLocaleString(language)
                })}
              </p>
            ) : null}
            {noteChanged ? (
              <div className="pset-actions">
                <button className="secondary" onClick={() => setNoteDraft(null)}>
                  {t('Cancel')}
                </button>
                <button
                  className="primary"
                  disabled={saving || noteTooLong}
                  onClick={() =>
                    void change({ note: noteTrimmed }).then(ok => {
                      if (ok) setNoteDraft(null)
                    })
                  }
                >
                  {t('Save')}
                </button>
              </div>
            ) : null}
            <p className="meta">
              {t(
                "Pulse reads it before every report, morning brief and reminder. Where it says what to bring up or leave out, it comes before Pulse's own rules."
              )}
            </p>
          </section>

          <section className="pset-section">
            <h2>{t('What Pulse reads')}</h2>
            <div className="pset-row">
              <span>{t('Profiles')}</span>
              <Select segments
                value={state.reportProfiles}
                disabled={saving}
                onChange={picked => void change({ report_profiles: picked })}
              >
                <option value="all">{t('Every profile')}</option>
                {/* Named: it is the profile Pulse runs in, whichever one the app is on (hermes-conduit issue 3241). */}
                <option value="this">{t('Only {name}', { name: bots?.find(b => b.name === state.profile)?.title ?? state.profile })}</option>
              </Select>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={state.memory} disabled={saving} onChange={e => void change({ memory: e.target.checked })} />
              {t('Memory')}
            </label>
            <button className="pset-link" onClick={() => setShowMemory(true)}>
              <span>{t('What Pulse remembers')}</span>
              {state.memory ? <span className="meta">{remembered.toLocaleString(language)}</span> : null}
              <Icon name="chevron" />
            </button>
            <p className="meta">{t('Pulse keeps short notes on promises, plans and dates, so it can bring them up later. You can remove any of them.')}</p>
            {state.lookFirst !== null ? (
              <>
                <label className="toggle">
                  <input type="checkbox" checked={state.lookFirst} disabled={saving} onChange={e => void change({ look_first: e.target.checked })} />
                  {t('Look things up first')}
                </label>
                <p className="meta">
                  {t(
                    'Before Pulse writes to you, it can check your calendar, reminders, contacts and alarms, look up places in Maps, and search the web when it follows up on a promise. It never changes anything on your phone.'
                  )}
                </p>
              </>
            ) : null}
          </section>

          <section className="pset-section">
            <h2>{t('Behind the scenes')}</h2>
            <button className="pset-link" aria-expanded={showBehind} onClick={() => setShowBehind(!showBehind)}>
              <span className="meta">{t('Budgets, memory, next look, time zone, a look through your chats now and recent checks.')}</span>
              <Icon name={showBehind ? 'chevronDown' : 'chevron'} />
            </button>
            {showBehind ? (
              <>
                <div className="pset-row">
                  <span>{t('Time zone')}</span>
                  <span className="meta">{zone}</span>
                </div>
                {computerZone && computerZone !== zone ? (
                  <button className="secondary" disabled={saving} onClick={() => void change({ time_zone: computerZone })}>
                    {t("Use this computer's time zone ({zone})", {
                      zone: computerZone
                    })}
                  </button>
                ) : null}
                {state.dailyReport && state.nextReportAt ? (
                  <div className="pset-row">
                    <span>{t('Next look')}</span>
                    <span className="meta">{new Date(state.nextReportAt * 1000).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </div>
                ) : null}
                <button
                  className="secondary"
                  disabled={saving}
                  onClick={() =>
                    void gateway
                      .http('POST', `${PULSE}/report`, {})
                      .then(() => setNotice(t('Pulse will report shortly. Anything it notices shows up as cards.')))
                      .catch(e => setError(e instanceof Error ? e.message : String(e)))
                  }
                >
                  {t('Look through my chats now')}
                </button>
                {notice ? <p className="meta">{notice}</p> : null}
                {state.memory ? (
                  <>
                    {sortedKinds(Object.keys(state.memoryCounts)).map(kind => (
                      <div key={kind} className="pset-row">
                        <span>{kindTitle(kind)}</span>
                        <span className="meta">{state.memoryCounts[kind]}</span>
                      </div>
                    ))}
                    <div className="pset-row">
                      <span>{t('Tokens today')}</span>
                      <span className="meta">
                        {t('{used} of {cap}', {
                          used: state.tokensToday.toLocaleString(language),
                          cap: state.dailyTokens.toLocaleString(language)
                        })}
                      </span>
                    </div>
                    <div className="pset-row">
                      <span>{t('Memory tokens a day')}</span>
                      <Select
                        className="language-select"
                        value={state.dailyTokens}
                        disabled={saving}
                        onChange={picked =>
                          void change({
                            memory_daily_tokens: Number(picked)
                          })
                        }
                      >
                        {budgets(MEMORY_BUDGETS, state.dailyTokens).map(value => (
                          <option key={value} value={value}>
                            {value.toLocaleString(language)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </>
                ) : null}
                {state.followups || state.followupTokensToday > 0 ? (
                  <>
                    <div className="pset-row">
                      <span>{t('Follow-up tokens a day')}</span>
                      <Select
                        className="language-select"
                        value={state.followupDailyTokensSet ? state.followupDailyTokens : 0}
                        disabled={saving}
                        onChange={picked =>
                          void change({
                            followup_daily_tokens: Number(picked) || null
                          })
                        }
                      >
                        <option value={0}>
                          {state.followupDailyTokensSet
                            ? t('With nudging')
                            : t('With nudging ({count})', {
                                count: state.followupDailyTokens.toLocaleString(language)
                              })}
                        </option>
                        {budgets(FOLLOWUP_BUDGETS, state.followupDailyTokensSet ? state.followupDailyTokens : 0).map(value => (
                          <option key={value} value={value}>
                            {value.toLocaleString(language)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="pset-row">
                      <span>{t('Follow-up tokens today')}</span>
                      <span className="meta">
                        {t('{used} of {cap}', {
                          used: state.followupTokensToday.toLocaleString(language),
                          cap: state.followupDailyTokens.toLocaleString(language)
                        })}
                      </span>
                    </div>
                  </>
                ) : null}
                {state.recent.length ? (
                  <>
                    <strong className="pset-label">{t("Pulse's latest checks and reports")}</strong>
                    <ul className="pset-recent">
                      {state.recent.slice(0, 5).map((row, index) => (
                        <li key={index}>
                          <div className="pset-row">
                            <span>
                              {checkTitle(row.kind)} · {row.state}
                            </span>
                            <span className="meta">
                              {row.at ? new Date(row.at * 1000).toLocaleString(language, { dateStyle: 'short', timeStyle: 'short' }) : ''}
                            </span>
                          </div>
                          {row.detail ? <div className="meta">{row.detail}</div> : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  )
}

/** The times Pulse looks through the chats: edited here, saved as a whole list. */
function ReportTimes({ times, saving, onSave }: { times: string[]; saving: boolean; onSave: (times: string[]) => Promise<boolean> }) {
  const [draft, setDraft] = useState<string[] | null>(null)
  const shown = draft ?? times
  const pending = useRef<string[] | null>(null)
  const edit = (next: string[]) => {
    setDraft(next)
    pending.current = next
    void onSave(next).then(ok => {
      // A later edit's answer is the one that clears it.
      if (pending.current === next) {
        if (ok) setDraft(null)
        pending.current = null
      }
    })
  }
  return (
    <div className="pset-times">
      <strong className="pset-label">{t('Looks through your chats at')}</strong>
      {shown.map((time, index) => (
        <div key={index} className="pset-row">
          <input
            type="time"
            className="pset-time"
            aria-label={t('Report time')}
            value={time}
            disabled={saving}
            onChange={e => {
              if (!e.target.value || e.target.value === time) return
              const next = [...shown]
              next[index] = e.target.value
              edit(next)
            }}
          />
          <button
            className="staged-remove"
            aria-label={t('Remove {name}', { name: time })}
            title={t('Remove {name}', { name: time })}
            disabled={saving || shown.length <= 1}
            onClick={() => edit(shown.filter((_, i) => i !== index))}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
      <button className="link-button" disabled={saving || shown.length >= MAX_REPORT_TIMES} onClick={() => edit([...shown, nextTime(shown)])}>
        {t('Add a time')}
      </button>
    </div>
  )
}

/** What Pulse remembers: the open items by kind, each one to forget. */
function PulseMemory({ onBack, onChanged }: { onBack: () => void; onChanged: () => void }) {
  useMouseBack(onBack)
  const [items, setItems] = useState<MemoryItem[] | null>(() => {
    const kept = keptAnswer(`${PULSE}/memory`)
    return kept ? parseMemory(kept) : null
  })
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const keep = answerKeeper(`${PULSE}/memory`)
      const raw = await gateway.http('GET', `${PULSE}/memory`)
      setItems(parseMemory(raw))
      keep(raw)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const forget = async (item: MemoryItem) => {
    setItems(current => current?.filter(other => other.id !== item.id) ?? null)
    try {
      await gateway.http('POST', `${PULSE}/memory/forget`, { id: item.id })
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      void load()
    }
  }

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{t('What Pulse remembers')}</h1>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {items === null ? (
        error ? null : (
          <p className="meta">{t('Loading…')}</p>
        )
      ) : items.length === 0 ? (
        <p className="meta">{t("Pulse doesn't remember anything yet.")}</p>
      ) : (
        sortedKinds(items.map(item => item.kind)).map(kind => (
          <section key={kind} className="pset-section">
            <h2>{kindTitle(kind)}</h2>
            <ul className="pset-memory">
              {items
                .filter(item => item.kind === kind)
                .map(item => (
                  <li key={item.id}>
                    <div>
                      <div>{item.text}</div>
                      {item.due ? <div className="meta">{item.due}</div> : null}
                      {item.evidence ? <div className="meta pset-evidence">“{item.evidence}”</div> : null}
                    </div>
                    <button className="link danger" onClick={() => void forget(item)}>
                      {t('Forget')}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
