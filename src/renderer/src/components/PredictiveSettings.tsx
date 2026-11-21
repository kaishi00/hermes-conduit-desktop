import { useEffect, useState } from 'react'
import { language, t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  FOLLOW_UP_DELAYS,
  MINIMUM_PLUGIN,
  followUpDelay,
  followUpEnabled,
  setFollowUpDelay,
  setFollowUpEnabled,
  PAUSE_DELAYS,
  PREDICT_PATH,
  pauseDelay,
  pauseEnabled,
  setPauseDelay,
  setPauseEnabled,
  REPLY_COUNTS,
  predictModel,
  repliesEnabled,
  replyCount,
  setPredictModel,
  setRepliesEnabled,
  setReplyCount,
  type PredictModel,
  INSTRUCTIONS_MINIMUM_PLUGIN,
  setInstructions,
  storedInstructions,
  type PredictKind
} from '../state/predictive'
import { instructionsServed, predictionsServed } from '../state/usePredictions'
import { Select } from './Select'

/**
 * Your instructions for one kind of guess (hermes-conduit#2970): kept on this
 * computer, cut at the plugin's limit, sent only with that kind's questions,
 * and off, with the reason, on a plugin that would ignore them.
 */
function InstructionsBox({ kind, on, served, placeholder }: { kind: PredictKind; on: boolean; served: boolean | null; placeholder: string }) {
  const [text, setText] = useState(() => storedInstructions(kind))
  if (!on) return null
  return (
    <>
      <textarea
        className="pset-note"
        rows={2}
        value={text}
        disabled={served === false}
        placeholder={placeholder}
        aria-label={t('Your instructions')}
        onChange={e => {
          setInstructions(kind, e.target.value)
          setText(storedInstructions(kind))
        }}
      />
      <p className="meta">
        {served === false
          ? t('Instructions need a newer Conduit plugin on your Hermes host ({version} or later).', { version: INSTRUCTIONS_MINIMUM_PLUGIN })
          : t("Guides only these guesses, not your agent's usual replies. Kept on this device and sent with each of these requests to your Hermes host's model.")}
      </p>
    </>
  )
}

/** Settings > Chat > Predictive, after the phone's: suggested replies, kept on this computer and off by default. */
export function PredictiveSettings() {
  const [on, setOn] = useState(repliesEnabled)
  const [count, setCount] = useState(replyCount)
  const [model, setModel] = useState(predictModel)
  const [pause, setPause] = useState(pauseEnabled)
  const [delay, setDelay] = useState(pauseDelay)
  const [followUp, setFollowUp] = useState(followUpEnabled)
  const [wait, setWait] = useState(followUpDelay)
  const [served, setServed] = useState<boolean | null>(null)
  const [instructionsOn, setInstructionsOn] = useState<boolean | null>(null)
  const [host, setHost] = useState<{ fast: string | null; today: number } | null>(null)

  useEffect(() => {
    let live = true
    void instructionsServed().then(ok => {
      if (live) setInstructionsOn(ok)
    })
    void predictionsServed().then(ok => {
      if (!live) return
      setServed(ok)
      if (!ok) return
      gateway
        .http('GET', PREDICT_PATH)
        .then(raw => {
          const r = (raw ?? {}) as { fast_model?: unknown; today?: unknown }
          if (live)
            setHost({
              fast: typeof r.fast_model === 'string' && r.fast_model.trim() ? r.fast_model.trim() : null,
              today: typeof r.today === 'number' ? r.today : 0
            })
        })
        .catch(() => undefined)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <section className="pset-section">
      <h2>{t('Predictive')}</h2>
      <p className="meta">{t('After a reply, the messages you’ll most likely send next, best first. Click one to send it; right-click to edit it first.')}</p>
      <p className="meta">
        {t(
          "Each guess is a short extra request to your agent's model, on a copy of the chat that can't use tools. Nothing is saved to the chat, and only this device sees the guesses."
        )}
      </p>
      {served === false ? <p className="meta">{t('Needs Conduit plugin {version} or later.', { version: MINIMUM_PLUGIN })}</p> : null}
      <div className="pset-row">
        <span>{t('Suggest replies')}</span>
        <label className="switch-inline">
          <input
            type="checkbox"
            checked={on}
            disabled={served === false}
            aria-label={t('Suggest replies')}
            onChange={e => {
              setOn(e.target.checked)
              setRepliesEnabled(e.target.checked)
            }}
          />
        </label>
      </div>
      <div className="pset-row">
        <span>{t('How many')}</span>
        <Select
          className="language-select"
          value={count}
          disabled={!on}
          aria-label={t('How many')}
          onChange={picked => {
            const n = Number(picked)
            setCount(n)
            setReplyCount(n)
          }}
        >
          {REPLY_COUNTS.map(n => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </div>
      <InstructionsBox
        kind="replies"
        on={on}
        served={instructionsOn}
        placeholder={t('Like: favor concrete next steps and questions about tradeoffs; skip plain thanks.')}
      />
      <p className="meta">
        {t(
          "When you stop typing for a moment, words to finish your message and whole messages you might mean. Your unsent draft goes to your agent's model to make them."
        )}
      </p>
      <div className="pset-row">
        <span>{t('Suggest while I pause')}</span>
        <label className="switch-inline">
          <input
            type="checkbox"
            checked={pause}
            disabled={served === false}
            aria-label={t('Suggest while I pause')}
            onChange={e => {
              setPause(e.target.checked)
              setPauseEnabled(e.target.checked)
            }}
          />
        </label>
      </div>
      <div className="pset-row">
        <span>{t('Pause before asking')}</span>
        <Select
          className="language-select"
          value={delay}
          disabled={!pause}
          aria-label={t('Pause before asking')}
          onChange={picked => {
            const n = Number(picked)
            setDelay(n)
            setPauseDelay(n)
          }}
        >
          {PAUSE_DELAYS.map(n => (
            <option key={n} value={n}>
              {t('{number} s', { number: n.toLocaleString(language()) })}
            </option>
          ))}
        </Select>
      </div>
      <InstructionsBox
        kind="draft"
        on={pause}
        served={instructionsOn}
        placeholder={t("Like: keep my meaning and tone; never add promises I didn't make.")}
      />
      <p className="meta">
        {t(
          'While a chat is on screen and you aren\'t writing, Hermes is asked now and then whether it has something useful to add. At most one follow-up per message you send, marked "Hermes followed up".'
        )}
      </p>
      <div className="pset-row">
        <span>{t('Let Hermes follow up')}</span>
        <label className="switch-inline">
          <input
            type="checkbox"
            checked={followUp}
            disabled={served === false}
            aria-label={t('Let Hermes follow up')}
            onChange={e => {
              setFollowUp(e.target.checked)
              setFollowUpEnabled(e.target.checked)
            }}
          />
        </label>
      </div>
      <div className="pset-row">
        <span>{t('Start asking after')}</span>
        <Select
          className="language-select"
          value={wait}
          disabled={!followUp}
          aria-label={t('Start asking after')}
          onChange={picked => {
            const n = Number(picked)
            setWait(n)
            setFollowUpDelay(n)
          }}
        >
          {FOLLOW_UP_DELAYS.map(n => (
            <option key={n} value={n}>
              {n < 60 ? t('{number} s', { number: String(n) }) : t('{minutes} min', { minutes: String(n / 60) })}
            </option>
          ))}
        </Select>
      </div>
      <InstructionsBox kind="turn" on={followUp} served={instructionsOn} placeholder={t('Like: only for a finished result or something blocking me.')} />
      <div className="pset-row">
        <span>{t('Predictions use')}</span>
        <Select segments
          value={model}
          disabled={!on && !pause && !followUp}
          aria-label={t('Predictions use')}
          onChange={picked => {
            const m = picked as PredictModel
            setModel(m)
            setPredictModel(m)
          }}
        >
          <option value="fast">{t('Fast model')}</option>
          <option value="chat">{t('Same as chat')}</option>
        </Select>
      </div>
      {host && model === 'fast' ? (
        <p className="meta">
          {host.fast ? t('Fast model on your host: {model}.', { model: host.fast }) : t("Your host has no fast model set, so the chat's own model answers.")}
        </p>
      ) : null}
      {host ? (
        <div className="pset-row">
          <span>{t('Predictions today')}</span>
          <span className="meta">{host.today}</span>
        </div>
      ) : null}
    </section>
  )
}
