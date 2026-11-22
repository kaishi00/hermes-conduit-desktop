import { useEffect, useState } from 'react'
import { useKeptStatus } from '../state/useKeptStatus'
import { locale, t } from '@shared/i18n'
import {
  API_VOICES,
  LIMIT_CHOICES,
  PLAN_VOICES,
  STATUS_PATH,
  apiLimitMinutes,
  gptLiveVoice,
  limitTitle,
  setApiLimitMinutes,
  setGptLiveVoice,
  voiceName,
  availability,
  gptLiveBilling,
  setGptLiveBilling,
  setSendsMemory,
  setSendsPersona,
  setVoiceMode,
  VOICE_MODE_EVENT,
  sendsMemory,
  sendsPersona,
  voiceMode,
  withProfile,
  type Availability,
  type Billing,
  type VoiceMode
} from '../state/gptLive'
import {
  STATUS_PATH as GROK_STATUS_PATH,
  availability as grokAvailability,
  grokSendsMemory,
  grokSendsPersona,
  setGrokSendsMemory,
  setGrokSendsPersona,
  packGrokLine,
  unpackGrokLine,
  via,
  type Availability as GrokAvailability
} from '../state/grokLive'
import { savesCalls, setSavesCalls } from '../state/voiceSave'
import { isLive } from '../state/consent'
import { ProviderConsentRow } from './ProviderConsent'
import { LocalLiveSettings } from './LocalLiveSettings'
import {
  DEFAULT_VOICE as QWEN_DEFAULT_VOICE,
  STATUS_PATH as QWEN_STATUS_PATH,
  availability as qwenAvailability,
  qwenSendsMemory,
  qwenSendsPersona,
  qwenVoice,
  setQwenSendsMemory,
  setQwenSendsPersona,
  setQwenVoice,
  validVoice,
  type Availability as QwenAvailability
} from '../state/qwenLive'
import {
  searchMode,
  setSearchMode,
  type SearchMode,
  STATUS_PATH as GEMINI_STATUS_PATH,
  VOICES as GEMINI_VOICES,
  availability as geminiAvailability,
  geminiSendsMemory,
  geminiSendsPersona,
  geminiVoice,
  setGeminiSendsMemory,
  setGeminiSendsPersona,
  setGeminiVoice,
  type Availability as GeminiAvailability
} from '../state/geminiLive'
import { ask } from '../state/dialogs'
import { Select } from './Select'
import { LiveCallStyleSettings } from './LiveCallStyleSettings'

/** Settings > Voice's mode, after the phone's Voice mode: Classic, or GPT-Live with how it's paid for. */
export function VoiceModeSettings({ profile }: { profile?: string }) {
  const [mode, setMode] = useState<VoiceMode>(voiceMode)
  const [geminiSearch, setGeminiSearch] = useState<SearchMode>(() => searchMode('gemini'))
  const [qwenSearch, setQwenSearch] = useState<SearchMode>(() => searchMode('qwen'))
  const [billing, setBilling] = useState<Billing>(gptLiveBilling)
  const status = useKeptStatus<Availability>(mode === 'gpt', withProfile(STATUS_PATH, profile), body => availability(body, billing), { timeout: 12_000, variant: billing })
  const [voice, setVoice] = useState(() => gptLiveVoice(gptLiveBilling()))
  const [limit, setLimit] = useState(apiLimitMinutes)
  const [memory, setMemory] = useState(sendsMemory)
  const [persona, setPersona] = useState(sendsPersona)
  const [saveCalls, setSaveCalls] = useState(savesCalls)
  const [geminiMemory, setGeminiMemory] = useState(geminiSendsMemory)
  const [geminiPersona, setGeminiPersona] = useState(geminiSendsPersona)
  const [geminiPick, setGeminiPick] = useState(geminiVoice)
  const geminiStatus = useKeptStatus<GeminiAvailability>(mode === 'gemini', withProfile(GEMINI_STATUS_PATH, profile), geminiAvailability, { timeout: 12_000 })

  const [qwenMemory, setQwenMemory] = useState(qwenSendsMemory)
  const [qwenPersona, setQwenPersona] = useState(qwenSendsPersona)
  const [qwenPick, setQwenPick] = useState(qwenVoice)
  const qwenStatus = useKeptStatus<QwenAvailability>(mode === 'qwen', withProfile(QWEN_STATUS_PATH, profile), qwenAvailability, { timeout: 12_000 })

  const [grokMemory, setGrokMemory] = useState(grokSendsMemory)
  const [grokPersona, setGrokPersona] = useState(grokSendsPersona)
  const grokStatus = useKeptStatus<GrokAvailability>(mode === 'grok', withProfile(GROK_STATUS_PATH, profile), grokAvailability, {
    timeout: 30_000,
    pack: packGrokLine,
    unpack: unpackGrokLine
  })



  useEffect(() => {
    const changed = () => setMode(voiceMode())
    window.addEventListener(VOICE_MODE_EVENT, changed)
    return () => window.removeEventListener(VOICE_MODE_EVENT, changed)
  }, [])
  const choose = (next: VoiceMode) => {
    setMode(next)
    setVoiceMode(next)
  }
  const pay = async (next: Billing) => {
    // As on the phone: the API key is billed per minute, so it's asked first.
    if (
      next === 'api' &&
      !(await ask(
        `${t('Bill GPT-Live to the API key?')}\n\n${t("GPT-Live calls will use your Hermes server's OpenAI API key, which OpenAI bills per minute of call time, separately from any ChatGPT plan. Your Hermes server has to allow it too (voice.gpt_live.conduit_api_billing in the profile's config).")}`
      ))
    )
      return
    setBilling(next)
    setVoice(gptLiveVoice(next))
    setGptLiveBilling(next)
  }

  return (
    <div className="voice-mode-settings">
      <span className="meta">{t('Voice mode')}</span>
      <div className="segmented" role="group" aria-label={t('Voice mode')}>
        <button aria-pressed={mode === 'classic'} onClick={() => choose('classic')}>
          {t('Classic')}
        </button>
        <button aria-pressed={mode === 'gemini'} onClick={() => choose('gemini')}>
          {t('Gemini Live')}
        </button>
        <button aria-pressed={mode === 'qwen'} onClick={() => choose('qwen')}>
          {t('Qwen Live')}
        </button>
        <button aria-pressed={mode === 'gpt'} onClick={() => choose('gpt')}>
          {t('GPT-Live')}
        </button>
        <button aria-pressed={mode === 'grok'} onClick={() => choose('grok')}>
          {t('Grok Live')}
        </button>
        <button aria-pressed={mode === 'local'} onClick={() => choose('local')}>
          {t('Local Live')}
        </button>
      </div>
      {mode === 'gemini' ? (
        <>
          <p
            className={`meta settings-caption${geminiStatus && geminiStatus !== 'checking' && (geminiStatus === 'missing' || !geminiStatus.ok) ? ' voice-call-problem' : ''}`}
          >
            {geminiStatus === 'checking'
              ? t('Checking…')
              : geminiStatus === 'missing'
                ? t('Install or update the Hermes notifier plugin on your Hermes server.')
                : geminiStatus?.ok
                  ? t('Available ({model})', { model: geminiStatus.model.replace(/^models\//, '') })
                  : geminiStatus
                    ? geminiStatus.reason === 'no_api_key'
                      ? t('Add a Gemini API key on your Hermes server.')
                      : geminiStatus.reason
                        ? t('Gemini Live is not available on this Hermes server: {reason}', { reason: geminiStatus.reason })
                        : t('Gemini Live is not available on this Hermes server.')
                    : null}
          </p>
          <label className="voice-mode-pick">
            <span className="meta">{t('Voice')}</span>
            <Select
              value={geminiPick}
              onChange={picked => {
                setGeminiPick(picked)
                setGeminiVoice(picked)
              }}
            >
              <option value="">{t('Gemini default')}</option>
              {GEMINI_VOICES.map(([name, style]) => (
                <option key={name} value={name}>
                  {`${name} · ${style()}`}
                </option>
              ))}
              {geminiPick && !GEMINI_VOICES.some(([name]) => name === geminiPick) ? <option value={geminiPick}>{geminiPick}</option> : null}
            </Select>
          </label>
          <p className="meta settings-caption">{t('The voice Gemini speaks with. Applies to the next conversation.')}</p>
          <label className="voice-mode-pick">
            <span className="meta">{t('Web lookups')}</span>
            <Select
              value={geminiSearch}
              onChange={picked => {
                const next = picked as SearchMode
                setGeminiSearch(next)
                setSearchMode('gemini', next)
              }}
            >
              <option value="automatic">{t('Automatic')}</option>
              <option value="hermes">{t('Hermes web search')}</option>
              <option value="google">{t('Google Search')}</option>
              <option value="off">{t('Off')}</option>
            </Select>
          </label>
          <p className="meta settings-caption">
            {t(
              'How Gemini answers quick questions like weather or news. Hermes web search uses the search your Hermes server is set up with (SearXNG, Firecrawl…). Google Search has its own quota on your Gemini key. Automatic uses Hermes when it has a search set up, otherwise Google. Applies to the next conversation.'
            )}
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={geminiMemory}
              onChange={e => {
                setGeminiMemory(e.target.checked)
                setGeminiSendsMemory(e.target.checked)
              }}
            />
            {t('Use Hermes memory')}
          </label>
          <p className="meta settings-caption">
            {t(
              'Gemini gets what your Hermes agent remembers about you, from whichever memory Hermes is set up with, and can search it for more. That memory is sent to Google with the conversation. Applies to the next conversation.'
            )}
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={geminiPersona}
              onChange={e => {
                setGeminiPersona(e.target.checked)
                setGeminiSendsPersona(e.target.checked)
              }}
            />
            {t('Use Hermes personality')}
          </label>
          <p className="meta settings-caption">
            {t(
              "Gemini talks with the personality in this profile's SOUL.md, without reading out actions or emoji. SOUL.md is sent to Google with the conversation. Applies to the next conversation."
            )}
          </p>
        </>
      ) : null}
      {mode === 'qwen' ? (
        <>
          <p
            className={`meta settings-caption${qwenStatus && qwenStatus !== 'checking' && (qwenStatus === 'missing' || !qwenStatus.ok) ? ' voice-call-problem' : ''}`}
          >
            {qwenStatus === 'checking'
              ? t('Checking…')
              : qwenStatus === 'missing'
                ? t('Install or update the Hermes notifier plugin on your Hermes server.')
                : qwenStatus?.ok
                  ? t('Available ({model})', { model: qwenStatus.model })
                  : qwenStatus
                    ? qwenStatus.reason === 'no_api_key'
                      ? t('Add a Qwen API key')
                      : qwenStatus.reason
                        ? t('Qwen Live is not available on this Hermes server: {reason}', { reason: qwenStatus.reason })
                        : t('Qwen Live is not available on this Hermes server.')
                    : null}
          </p>
          <label className="voice-mode-pick">
            <span className="meta">{t('Voice')}</span>
            <input
              type="text"
              value={qwenPick}
              placeholder={QWEN_DEFAULT_VOICE}
              spellCheck={false}
              aria-invalid={!!qwenPick.trim() && !validVoice(qwenPick.trim())}
              onChange={e => {
                setQwenPick(e.target.value)
                const typed = e.target.value.trim()
                if (!typed || validVoice(typed)) setQwenVoice(typed)
              }}
            />
          </label>
          <p className="meta settings-caption">{t('The voice Qwen speaks with. Applies to the next conversation.')}</p>
          <div className="voice-mode-pick">
            <span className="meta">{t('Web lookups')}</span>
            <Select segments aria-label={t('Web lookups')}
              value={qwenSearch}
              onChange={picked => {
                const next = picked as SearchMode
                setQwenSearch(next)
                setSearchMode('qwen', next)
              }}
            >
              <option value="automatic">{t('Automatic')}</option>
              <option value="hermes">{t('Hermes web search')}</option>
              <option value="off">{t('Off')}</option>
            </Select>
          </div>
          <p className="meta settings-caption">{t('Qwen uses Hermes web search. Native search is disabled while function tools are enabled.')}</p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={qwenMemory}
              onChange={e => {
                setQwenMemory(e.target.checked)
                setQwenSendsMemory(e.target.checked)
              }}
            />
            {t('Use Hermes memory')}
          </label>
          <p className="meta settings-caption">
            {t(
              'Qwen gets what your Hermes agent remembers about you, from whichever memory Hermes is set up with, and can search it for more. That memory is sent to Alibaba Cloud with the conversation. Applies to the next conversation.'
            )}
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={qwenPersona}
              onChange={e => {
                setQwenPersona(e.target.checked)
                setQwenSendsPersona(e.target.checked)
              }}
            />
            {t('Use Hermes personality')}
          </label>
          <p className="meta settings-caption">
            {t(
              "Qwen talks with the personality in this profile's SOUL.md, without reading out actions or emoji. SOUL.md is sent to Alibaba Cloud with the conversation. Applies to the next conversation."
            )}
          </p>
        </>
      ) : null}
      {mode === 'grok' ? (
        <>
          <p
            className={`meta settings-caption${grokStatus && grokStatus !== 'checking' && (grokStatus === 'missing' || !grokStatus.ok) ? ' voice-call-problem' : ''}`}
          >
            {grokStatus === 'checking'
              ? t('Checking…')
              : grokStatus === 'missing'
                ? t('Install or update the Hermes notifier plugin on your Hermes server.')
                : grokStatus?.ok
                  ? grokStatus.voice
                    ? t('Available ({model}, voice {voice}, via {via})', { model: grokStatus.model, voice: grokStatus.voice, via: via(grokStatus.auth) })
                    : t('Available ({model}, via {via})', { model: grokStatus.model, via: via(grokStatus.auth) })
                  : grokStatus
                    ? grokStatus.reason
                      ? t('Grok Live is not available on this Hermes server: {reason}', { reason: grokStatus.reason })
                      : t('Grok Live is not available on this Hermes server.')
                    : null}
          </p>
          <p className="meta settings-caption">{t("The voice and model are set on your Hermes server (voice.grok_live in the profile's config).")}</p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={grokMemory}
              onChange={e => {
                setGrokMemory(e.target.checked)
                setGrokSendsMemory(e.target.checked)
              }}
            />
            {t('Use Hermes memory')}
          </label>
          <p className="meta settings-caption">
            {t(
              'Grok Live gets what your Hermes agent remembers about you. That memory is sent to xAI with the conversation. Applies to the next conversation.'
            )}
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={grokPersona}
              onChange={e => {
                setGrokPersona(e.target.checked)
                setGrokSendsPersona(e.target.checked)
              }}
            />
            {t('Use Hermes personality')}
          </label>
          <p className="meta settings-caption">
            {t(
              "Grok Live talks with the personality in this profile's SOUL.md. SOUL.md is sent to xAI with the conversation. Applies to the next conversation."
            )}
          </p>
        </>
      ) : null}
      {mode === 'gpt' ? (
        <>
          <span className="meta">{t('Billing')}</span>
          <div className="segmented" role="group" aria-label={t('Billing')}>
            <button aria-pressed={billing === 'subscription'} onClick={() => pay('subscription')}>
              {t('ChatGPT plan')}
            </button>
            <button aria-pressed={billing === 'api'} onClick={() => pay('api')}>
              {t('API key · billed per minute')}
            </button>
          </div>
          <p className="meta settings-caption">
            {billing === 'api'
              ? t(
                  "Bills your Hermes server's OpenAI API key per minute of call time, separately from any ChatGPT plan. The call screen shows which one a call is on."
                )
              : t('Bills the ChatGPT subscription your Hermes server is signed in to. A call never moves to the API key on its own.')}
          </p>
          <label className="voice-mode-pick">
            <span className="meta">{t('Voice')}</span>
            <Select
              value={voice}
              onChange={picked => {
                setVoice(picked)
                setGptLiveVoice(billing, picked)
              }}
            >
              <option value="">{t('Server default')}</option>
              {billing === 'api'
                ? API_VOICES.map(name => (
                    <option key={name} value={name}>
                      {voiceName(name)}
                    </option>
                  ))
                : PLAN_VOICES.map(v => (
                    <option key={v.name} value={v.name}>
                      {`${voiceName(v.name)} · ${v.style()}`}
                    </option>
                  ))}
              {voice && !(billing === 'api' ? API_VOICES.includes(voice) : PLAN_VOICES.some(v => v.name === voice)) ? (
                <option value={voice}>{voice}</option>
              ) : null}
            </Select>
          </label>
          <p className="meta settings-caption">
            {billing === 'api'
              ? t(
                  "The voice GPT-Live speaks with on the API key. Server default uses voice.gpt_live.voice in the profile's config. Applies to the next conversation."
                )
              : t(
                  "The voice GPT-Live speaks with. Server default uses the voice set on your Hermes server (voice.gpt_live in the profile's config). The model is set there too. Applies to the next conversation."
                )}
          </p>
          {billing === 'api' ? (
            <>
              <label className="voice-mode-pick">
                <span className="meta">{t('Time limit per call')}</span>
                <Select
                  value={limit}
                  onChange={picked => {
                    setLimit(Number(picked))
                    setApiLimitMinutes(Number(picked))
                  }}
                >
                  {(LIMIT_CHOICES.includes(limit) ? LIMIT_CHOICES : [limit, ...LIMIT_CHOICES]).map(minutes => (
                    <option key={minutes} value={minutes}>
                      {limitTitle(minutes, locale())}
                    </option>
                  ))}
                </Select>
              </label>
              <p className="meta settings-caption">{t('An API-key call says goodbye and ends when it reaches this limit.')}</p>
            </>
          ) : null}
          <p className={`meta settings-caption${status && status !== 'checking' && (status === 'missing' || !status.ok) ? ' voice-call-problem' : ''}`}>
            {status === 'checking'
              ? t('Checking…')
              : status === 'missing'
                ? t('Install or update the Hermes notifier plugin on your Hermes server.')
                : status?.ok
                  ? `${t('Ready')} · ${status.model}`
                  : status
                    ? status.reason
                      ? t('GPT-Live is not available on this Hermes server: {reason}', { reason: status.reason })
                      : t('GPT-Live is not available on this Hermes server.')
                    : null}
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={memory}
              onChange={e => {
                setMemory(e.target.checked)
                setSendsMemory(e.target.checked)
              }}
            />
            {t('Use Hermes memory')}
          </label>
          <p className="meta settings-caption">
            {t(
              'GPT-Live gets what your Hermes agent remembers about you. That memory is sent to OpenAI with the conversation. Applies to the next conversation.'
            )}
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={persona}
              onChange={e => {
                setPersona(e.target.checked)
                setSendsPersona(e.target.checked)
              }}
            />
            {t('Use Hermes personality')}
          </label>
          <p className="meta settings-caption">
            {t(
              "GPT-Live talks with the personality in this profile's SOUL.md. SOUL.md is sent to OpenAI with the conversation. Applies to the next conversation."
            )}
          </p>
        </>
      ) : null}
      {mode === 'local' ? <LocalLiveSettings profile={profile} /> : null}
      {isLive(mode) ? <ProviderConsentRow mode={mode} /> : null}
      {mode !== 'classic' ? (
        <>
          <label className="toggle">
            <input
              type="checkbox"
              checked={saveCalls}
              onChange={e => {
                setSaveCalls(e.target.checked)
                setSavesCalls(e.target.checked)
              }}
            />
            {t('Save calls to Sessions')}
          </label>
          <p className="meta settings-caption">
            {t(
              "Each call's transcript is saved to your Hermes server's history and shows under Voice in Sessions, where you can read it or resume the call. Needs an up-to-date Hermes notifier plugin. Shared by every live voice mode. Applies to the next conversation."
            )}
          </p>
          <LiveCallStyleSettings />
        </>
      ) : null}
    </div>
  )
}
