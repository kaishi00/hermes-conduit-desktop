import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { withProfile } from '../state/callSettings'
import { inTurn, readConfig, type Http } from '../state/profileConfig'
import {
  fieldProblem,
  fieldText,
  providerPath,
  saveFields,
  saveProvider,
  selectedProvider,
  speechFields,
  speechProviders,
  statusLabel,
  toolsetPath,
  type SpeechKind,
  type SpeechProvider
} from '../state/hermesSpeech'
import { Select } from './Select'

const http: Http = (method, path, body) => gateway.http(method, path, body)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * A profile's Hermes speech provider, after the phone's Assistant speech
 * (`kind` tts: what Read Aloud and Classic voice speak with when Hermes
 * speaks) and Speech to text (stt: what Classic voice is transcribed with):
 * the provider, its model, voice and language, and a key it's missing.
 * These are Hermes settings, so the phone and Hermes' own apps use them too.
 */
export function HermesSpeechSettings({ kind, profile }: { kind: SpeechKind; profile?: string }) {
  const name = profile || 'default'
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [providers, setProviders] = useState<SpeechProvider[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const live = useRef(true)
  const listId = useId()
  useEffect(() => {
    // Set again on every mount: StrictMode mounts twice with the same ref.
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  /** Reads Hermes' answers again; false (with the reason shown) when it didn't answer. */
  const read = useCallback(async (): Promise<boolean> => {
    try {
      const [loaded, toolset, schema] = await Promise.all([
        readConfig(http, name),
        gateway.http('GET', withProfile(toolsetPath(kind), profile)).catch(() => null),
        gateway.http('GET', withProfile('/api/config/schema', profile)).catch(() => null)
      ])
      if (!live.current) return false
      setConfig(loaded)
      setProviders(speechProviders(kind, toolset, loaded, schema))
      // Drafts Hermes now holds are done; one not saved yet (typed before a key's save) stays.
      setValues(drafts => Object.fromEntries(Object.entries(drafts).filter(([key, draft]) => draft.trim() !== fieldText(loaded, key).trim())))
      setError(null)
      return true
    } catch (e) {
      if (live.current) setError(t("Hermes didn't answer: {error}", { error: message(e) }))
      return false
    }
  }, [kind, name, profile])
  useEffect(() => {
    setConfig(null)
    void read()
  }, [read])

  const run = async (write: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await write()
      // Saved says so only once Hermes' answer shows what was saved.
      if ((await read()) && live.current) setSaved(true)
    } catch (e) {
      if (live.current) setError(message(e))
    } finally {
      if (live.current) setBusy(false)
    }
  }

  const pick = (id: string) =>
    run(async () => {
      const provider = providers.find(p => p.id === id)
      if (provider?.row) {
        // Hermes writes the config for its own rows, so it waits its turn behind the other saves.
        const answer = await inTurn(() => gateway.http<{ error?: unknown }>('PUT', withProfile(providerPath(kind), profile), { provider: provider.row }))
        if (typeof answer?.error === 'string' && answer.error) throw new Error(answer.error)
        return
      }
      // The managed Nous route means something only Hermes' route can say.
      if (id === 'nous') throw new Error(t('Update Hermes to pick the Nous Subscription here.'))
      await saveProvider(http, name, kind, id)
    })

  if (!config) return <p className={`meta settings-caption${error ? ' voice-call-problem' : ''}`}>{error ?? t('Checking…')}</p>

  const selected = selectedProvider(kind, config)
  const provider = providers.find(p => p.id === selected)
  const fields = speechFields(selected, kind)
  const shown = (key: string) => values[key] ?? fieldText(config, key)
  const changed = fields.filter(f => f.key in values && values[f.key]!.trim() !== fieldText(config, f.key).trim())
  const problem = fields.map(f => fieldProblem(f, shown(f.key))).find(Boolean) ?? null
  const missing = provider?.keys.filter(k => !k.isSet) ?? []

  return (
    <div className="local-live-agent hermes-speech-settings">
      <label className="local-live-field">
        <span className="meta">{t('Provider')}</span>
        <Select value={selected} disabled={busy} aria-label={kind === 'stt' ? t('Speech to text') : t('Assistant speech')} onChange={id => void pick(id)}>
          {providers.map(p => (
            <option key={p.id} value={p.id}>
              {p.status && p.status.toLowerCase() !== 'ready' ? `${p.name} · ${statusLabel(p.status)}` : p.name}
            </option>
          ))}
        </Select>
      </label>
      {provider?.status && provider.status.toLowerCase() !== 'ready' ? (
        <p className="meta settings-caption voice-call-problem">
          {provider.status === 'needs_keys'
            ? t('{provider} needs an API key on your Hermes server.', { provider: provider.name })
            : t('{provider}: {status}', { provider: provider.name, status: statusLabel(provider.status) })}
        </p>
      ) : null}
      {missing.map(k => (
        <label key={k.key} className="local-live-field">
          <span className="meta">{k.prompt}</span>
          <span className="hermes-speech-key">
            <input type="password" value={keys[k.key] ?? ''} placeholder={k.key} spellCheck={false} onChange={e => setKeys(v => ({ ...v, [k.key]: e.target.value }))} />
            <button
              className="secondary"
              disabled={busy || !keys[k.key]?.trim()}
              onClick={() =>
                void run(async () => {
                  await gateway.http('PUT', withProfile('/api/env', profile), { key: k.key, value: keys[k.key]!.trim(), profile: name })
                  setKeys(v => ({ ...v, [k.key]: '' }))
                })
              }
            >
              {t('Save Key')}
            </button>
          </span>
        </label>
      ))}
      {fields.map(field => (
        <label key={field.key} className="local-live-field">
          <span className="meta">{field.label}</span>
          <input
            value={shown(field.key)}
            spellCheck={false}
            list={field.suggestions?.length ? `${listId}-${field.key}` : undefined}
            onChange={e => {
              setSaved(false)
              setValues(v => ({ ...v, [field.key]: e.target.value }))
            }}
          />
          {field.suggestions?.length ? (
            <datalist id={`${listId}-${field.key}`}>
              {field.suggestions.map(s => (
                <option key={s} value={s} />
              ))}
            </datalist>
          ) : null}
          <span className="meta settings-caption">{field.help}</span>
        </label>
      ))}
      {fields.length ? (
        <div className="local-live-buttons">
          <button className="primary" disabled={busy || !changed.length || !!problem} onClick={() => void run(() => saveFields(http, name, changed, values))}>
            {t('Save')}
          </button>
          {saved && !changed.length ? <span className="meta">{t('Saved')}</span> : null}
        </div>
      ) : null}
      {problem || error ? <p className="meta settings-caption voice-call-problem">{problem ?? error}</p> : null}
    </div>
  )
}
