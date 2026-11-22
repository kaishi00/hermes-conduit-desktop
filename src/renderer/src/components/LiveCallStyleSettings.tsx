import { useState } from 'react'
import { t } from '@shared/i18n'
import { MAX_GREETING_CHARACTERS, cleanedGreeting, liveGreeting, setLiveGreeting } from '../state/liveGreeting'
import {
  ANSWER_LENGTHS,
  MAX_EXTRA_INSTRUCTIONS_CHARACTERS,
  TONES,
  liveStyle,
  setLiveAnswerLength,
  setLiveBackchannels,
  setLiveInstructions,
  setLiveTone,
  type AnswerLength,
  type LiveTone
} from '../state/liveStyle'
import { Select } from './Select'
import { liveAsksFirst, setLiveAsksFirst } from '../state/askFirst'
import type { VoiceMode } from '../state/gptLive'
import { LivePreviewSheet } from './LivePreviewSheet'

const toneLabel = (tone: LiveTone) => (tone === 'relaxed' ? t('Relaxed') : tone === 'neutral' ? t('Neutral') : t('Professional'))
const lengthLabel = (length: AnswerLength) => (length === 'concise' ? t('Concise') : length === 'detailed' ? t('Detailed') : t('Default'))

/**
 * Settings > Voice's Live call style, after the phone's: the greeting, tone,
 * answer length, backchannels and the user's own instructions, for every live
 * mode. Kept on this computer, so it works with no iPhone. "What Conduit sends"
 * shows the next call's instructions in `mode`.
 */
export function LiveCallStyleSettings({ mode, profile }: { mode: VoiceMode; profile?: string }) {
  const [greeting, setGreeting] = useState<string | null>(liveGreeting)
  const [style, setStyle] = useState(liveStyle)
  const [instructions, setInstructions] = useState(() => style.extraInstructions ?? '')
  const [asksFirst, setAsksFirst] = useState(liveAsksFirst)
  const [previewing, setPreviewing] = useState(false)
  return (
    <>
      <span className="meta">{t('Live call style')}</span>
      <label className="toggle">
        <input
          type="checkbox"
          checked={greeting !== null}
          onChange={e => {
            const next = e.target.checked ? '' : null
            setGreeting(next)
            setLiveGreeting(next)
          }}
        />
        {t('Greet me when a call connects')}
      </label>
      {greeting !== null ? (
        <label className="local-live-field">
          <span className="meta">{t('Greeting')}</span>
          <input
            value={greeting}
            maxLength={MAX_GREETING_CHARACTERS}
            placeholder={t('A short greeting of its own')}
            onChange={e => {
              setGreeting(e.target.value)
              setLiveGreeting(e.target.value)
            }}
            // Shows what is saved and sent (one line, no double quotes).
            onBlur={e => setGreeting(cleanedGreeting(e.target.value))}
            onKeyDown={e => {
              if (e.key === 'Enter') setGreeting(cleanedGreeting(e.currentTarget.value))
            }}
          />
        </label>
      ) : null}
      <p className="meta settings-caption">
        {t(
          "The voice model greets you as soon as a call connects, so you know it's live. Leave the greeting empty for one in its own words. Applies to the next call."
        )}
      </p>
      <label className="voice-mode-pick">
        <span className="meta">{t('Tone')}</span>
        <Select
          value={style.tone ?? ''}
          onChange={picked => {
            const tone = TONES.includes(picked as LiveTone) ? (picked as LiveTone) : null
            setStyle(s => ({ ...s, tone }))
            setLiveTone(tone)
          }}
        >
          <option value="">{t('Model default')}</option>
          {TONES.map(tone => (
            <option key={tone} value={tone}>
              {toneLabel(tone)}
            </option>
          ))}
        </Select>
      </label>
      <p className="meta settings-caption">
        {t("How live calls sound. Model default keeps the voice model's tone and your Hermes server's persona. Applies to the next call.")}
      </p>
      <label className="voice-mode-pick">
        <span className="meta">{t('Answer length')}</span>
        <Select
          value={style.answerLength}
          segments
          onChange={picked => {
            const answerLength = picked as AnswerLength
            setStyle(s => ({ ...s, answerLength }))
            setLiveAnswerLength(answerLength)
          }}
        >
          {ANSWER_LENGTHS.map(length => (
            <option key={length} value={length}>
              {lengthLabel(length)}
            </option>
          ))}
        </Select>
      </label>
      <p className="meta settings-caption">
        {t(
          'How much the voice model says when you ask something. Concise gives the key point in one to three sentences, Default adds the details that make it useful, and Detailed goes in depth. Applies to the next call.'
        )}
      </p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={style.backchannels}
          onChange={e => {
            const backchannels = e.target.checked
            setStyle(s => ({ ...s, backchannels }))
            setLiveBackchannels(backchannels)
          }}
        />
        {t('Backchannels')}
      </label>
      <p className="meta settings-caption">{t('Short sounds like “mm-hmm” while you talk. Turn them off for a quieter listener. Applies to the next call.')}</p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={asksFirst}
          onChange={e => {
            setAsksFirst(e.target.checked)
            setLiveAsksFirst(e.target.checked)
          }}
        />
        {t('Ask before sending to Hermes')}
      </label>
      <p className="meta settings-caption">
        {t(
          "The voice model tells you what it will send and waits for your OK before Hermes starts on it. Say “send it to Hermes” to skip the question. Change it during a call with the call screen's button or by asking. Applies to the next call."
        )}
      </p>
      <label className="local-live-field">
        <span className="meta">{t('Your instructions')}</span>
        <textarea
          className="pset-note"
          rows={3}
          value={instructions}
          maxLength={MAX_EXTRA_INSTRUCTIONS_CHARACTERS}
          placeholder={t('Your instructions for the voice model')}
          onChange={e => {
            setInstructions(e.target.value)
            setLiveInstructions(e.target.value)
          }}
        />
      </label>
      <p className="meta settings-caption">
        {t(
          "Added to every live call after Conduit's own instructions: its personality, how it words things, or anything it should know about you. Conduit's instructions can't be shortened or replaced, because jobs, approvals and the call's tools depend on them, so where yours disagree, Conduit's come first. Applies to the next call."
        )}
      </p>
      <button className="secondary live-preview-open" onClick={() => setPreviewing(true)}>
        {t('What Conduit sends')}
      </button>
      {previewing ? <LivePreviewSheet mode={mode} profile={profile} onClose={() => setPreviewing(false)} /> : null}
    </>
  )
}
