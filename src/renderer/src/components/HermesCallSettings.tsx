import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { CALLS_CAPABILITY, CALLS_PATH } from '../state/callbacks'
import { STATUS_PATH, pluginStatus, serves } from '../state/plugin'
import { cleanRules, gapChoices, gapText, parseCallsStatus, testCallPrompt, watchPrompt, withProfile, type Bounds, type CallSettings, type CallsStatus } from '../state/callSettings'
import { Select } from './Select'
import { APP_STORE_URL } from '../state/otherApp'

/**
 * Settings > Voice > Calls from Hermes, after the phone's: this profile's call
 * settings, kept on the Hermes host. Hermes calls the user's iPhone; the
 * phone's own settings (ringing, ringtones, a Focus contact, places) stay there.
 */
export function HermesCallSettings({ profile, onNewChat }: { profile?: string; onNewChat?: (draft: string) => void }) {
  const [status, setStatus] = useState<CallsStatus | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'unsupported'>('loading')
  const [draft, setDraft] = useState<CallSettings | null>(null)
  const [rules, setRules] = useState('')
  const saving = useRef<{ timer: number | null; chain: Promise<void> }>({ timer: null, chain: Promise.resolve() })

  useEffect(() => {
    let live = true
    setState('loading')
    setStatus(null)
    setDraft(null)
    void (async () => {
      const plugin = await gateway.http('GET', withProfile(STATUS_PATH, profile), undefined, 12_000).then(pluginStatus, () => null)
      if (!live) return
      if (!plugin || !serves(plugin, [CALLS_CAPABILITY])) return setState('unsupported')
      const read = await gateway.http('GET', withProfile(CALLS_PATH, profile), undefined, 12_000).then(parseCallsStatus, () => null)
      if (!live) return
      if (!read) return setState('failed')
      setStatus(read)
      setDraft(read.settings)
      setRules(read.settings.rules ?? '')
      setState('ready')
    })()
    return () => {
      live = false
      if (saving.current.timer) window.clearTimeout(saving.current.timer)
    }
  }, [profile])

  // Saved once the user stops changing things, one save at a time; one the host didn't take puts back what it holds.
  const change = (edit: Partial<CallSettings>) => {
    if (!draft) return
    const next = { ...draft, ...edit }
    setDraft(next)
    if (saving.current.timer) window.clearTimeout(saving.current.timer)
    saving.current.timer = window.setTimeout(() => {
      saving.current.timer = null
      saving.current.chain = saving.current.chain.then(async () => {
        try {
          const saved = (await gateway.http('PUT', withProfile(CALLS_PATH, profile), { settings: next }, 12_000)) as { ok?: boolean; settings?: CallSettings }
          if (saved?.ok && saved.settings) setStatus(current => (current ? { ...current, settings: { ...current.settings, ...saved.settings } } : current))
        } catch {
          setStatus(current => {
            if (current) {
              setDraft(current.settings)
              setRules(current.settings.rules ?? '')
            }
            return current
          })
        }
      })
    }, 500)
  }

  const commitRules = () => {
    if (!draft || draft.rules === undefined) return
    const cleaned = cleanRules(rules)
    if (cleaned !== draft.rules) change({ rules: cleaned })
  }

  const toggle = (label: string, checked: boolean, onChange: (on: boolean) => void, disabled = false) => (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )

  const count = (label: string, value: number, b: Bounds, onChange: (n: number) => void) => (
    <label className="voice-mode-pick">
      <span className="meta">{label}</span>
      <input
        className="pset-number"
        type="number"
        min={b.min}
        max={b.max}
        value={value}
        aria-label={label}
        onChange={e => {
          const n = Math.round(Number(e.target.value))
          if (Number.isFinite(n)) onChange(Math.min(b.max, Math.max(b.min, n)))
        }}
      />
    </label>
  )

  return (
    <div className="voice-mode-settings call-settings">
      {state === 'loading' ? <p className="meta settings-caption">{t('Loading call settings…')}</p> : null}
      {state === 'failed' ? <p className="meta settings-caption">{t("Couldn't read Hermes' call settings.")}</p> : null}
      {state === 'unsupported' ? (
        <p className="meta settings-caption">{t('The Conduit plugin on your Hermes host needs an update for calls from Hermes.')}</p>
      ) : null}
      {status && draft ? (
        <>
          {toggle(t('Hermes can call me'), draft.enabled, on => change({ enabled: on }), !status.canRing)}
          <p className="meta settings-caption">
            {t(
              "When a job you asked about is done, Hermes calls you so you can talk it through. Conduit rings on this computer while it's open, and your iPhone rings too if you use Conduit there."
            )}
          </p>
          {!status.canRing ? (
            <p className="meta settings-caption">
              {t('Turn on notifications for this profile in Conduit on your iPhone first, in Settings under Notifications: Hermes calls you through them.')}{' '}
              <a className="link" href={APP_STORE_URL} target="_blank" rel="noreferrer">
                {t('Get Conduit on iPhone')}
              </a>
            </p>
          ) : null}
          {draft.enabled ? (
            <>
              {toggle(t('Call when I ask'), draft.when_asked, on => change({ when_asked: on }))}
              <p className="meta settings-caption">
                {t(
                  "Say “call me when it's done” during a live call, or ask Hermes in a chat to call you. Hermes calls about that job once the call has ended; if it finishes while you're still talking, you hear about it in the call instead."
                )}
              </p>
              {/* The call tool came with plugin 0.14, as did "decides". */}
              {onNewChat && status.canRing && draft.when_asked && draft.decides !== undefined ? (
                <>
                  <div>
                    <button className="secondary" onClick={() => onNewChat(testCallPrompt())}>
                      {t('Try a test call')}
                    </button>
                  </div>
                  <p className="meta settings-caption">
                    {t('Opens a new chat with “{prompt}” ready to send. Send it, and Conduit rings when Hermes replies.', { prompt: testCallPrompt() })}
                  </p>
                </>
              ) : null}
              {draft.decides !== undefined ? (
                <>
                  {toggle(t('Hermes decides when to call'), draft.decides, on => change({ decides: on }))}
                  <p className="meta settings-caption">
                    {t("Hermes may also call on its own when news can't wait, within your limits. It never calls for routine updates.")}
                  </p>
                </>
              ) : null}
              {draft.decides && draft.rules !== undefined ? (
                <div className="pset-rules">
                  <label className="pset-rules-label" htmlFor="hermes-call-rules">
                    {t("What's worth a call")}
                  </label>
                  <textarea
                    id="hermes-call-rules"
                    rows={3}
                    value={rules}
                    maxLength={status.rulesMax}
                    placeholder={t('For example: only if production is down or a deploy fails. Never before 9 am.')}
                    onChange={e => setRules(e.target.value)}
                    onBlur={commitRules}
                  />
                  <p className="meta">
                    {t("Hermes reads this before each call it decides to make, and calls only if the news fits. Calls you ask for don't depend on it.")}
                  </p>
                  {/* A check's calls are ones the user asked for. */}
                  {onNewChat && status.canRing && draft.when_asked && cleanRules(rules) ? (
                    <>
                      <div>
                        <button className="secondary" onClick={() => onNewChat(watchPrompt(rules))}>
                          {t('Have Hermes watch for this')}
                        </button>
                      </div>
                      <p className="meta settings-caption">
                        {t(
                          "Hermes doesn't check for what your note describes on its own. This opens a new chat asking it to set up scheduled checks that call you when it happens. After you change the note, tap it again to bring the checks up to date."
                        )}
                      </p>
                    </>
                  ) : null}
                </div>
              ) : null}
              {draft.alerts !== undefined ? (
                <>
                  {toggle(t('Call about approvals and questions'), draft.alerts, on => change({ alerts: on }))}
                  <p className="meta settings-caption">
                    {draft.alerts && draft.quiet_at_screen
                      ? t('Hermes calls when it has waited for your OK or an answer, or when a request fails. In a live call you can answer out loud.')
                      : t(
                          'Hermes calls when it has waited a minute for your OK or an answer, or when a request fails. In a live call you can answer out loud.'
                        )}
                  </p>
                </>
              ) : null}
              {draft.alerts && draft.quiet_at_screen !== undefined ? (
                <>
                  {toggle(t("Wait while I'm at a screen"), draft.quiet_at_screen, on => change({ quiet_at_screen: on }))}
                  <p className="meta settings-caption">
                    {t(
                      "When this is on, Hermes waits longer before calling, up to 10 minutes, while you're talking to it in Hermes Desktop, the dashboard or a terminal, or have the chat open in Conduit, and a failed request there only sends a notification."
                    )}
                  </p>
                </>
              ) : null}
              <label className="voice-mode-pick">
                <span className="meta">{t('Time between calls')}</span>
                <Select
                  className="language-select"
                  value={draft.min_gap_s}
                  aria-label={t('Time between calls')}
                  onChange={picked => change({ min_gap_s: Number(picked) })}
                >
                  {gapChoices(status.bounds.min_gap_s, draft.min_gap_s).map(n => (
                    <option key={n} value={n}>
                      {gapText(n)}
                    </option>
                  ))}
                </Select>
              </label>
              {count(t('Calls per hour'), draft.per_hour, status.bounds.per_hour, n => change({ per_hour: n }))}
              {count(t('Calls per day'), draft.per_day, status.bounds.per_day, n => change({ per_day: n }))}
              <p className="meta settings-caption">
                {t(
                  "Past a limit, a finished job sends its usual notification instead of calling. These settings are this profile's, kept on your Hermes host."
                )}
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
