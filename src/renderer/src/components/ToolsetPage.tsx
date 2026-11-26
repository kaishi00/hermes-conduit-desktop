import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import { inTurn } from '../state/profileConfig'
import { scoped } from '../state/capabilities'
import {
  MODEL_TOOLSETS,
  choosingBackend,
  configPath,
  hermesModelsPath,
  parseBackends,
  parseModels,
  pickModel,
  providerPath,
  readModels,
  settingKey,
  type Backend,
  type ToolsetBackends,
  type ToolsetModels
} from '../state/toolsetPage'
import { Icon } from './icons'
import { useMouseBack } from '../state/mouseBack'

interface Props {
  name: string
  label: string
  profile: string
  onBack: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const http = (method: 'GET' | 'PUT', path: string, body?: unknown) => gateway.http(method, path, body)

function statusBadge(status: string) {
  if (status === 'ready') return <span className="cap-badge">{t('Ready')}</span>
  if (status === 'needs_setup') return <span className="cap-badge warn">{t('Needs setup')}</span>
  if (status === 'needs_auth') return <span className="cap-badge warn">{t('Needs sign-in')}</span>
  if (status === 'needs_keys') return <span className="cap-badge warn">{t('Needs keys')}</span>
  return null
}

/**
 * A toolset's page in Capabilities > Tools, after the phone's: its backends,
 * each with its readiness and keys, Use This Backend, and for image and
 * video generation the active backend's models, the one in use checked.
 * Settings > Models' Image generation row opens it too. Each opens on what
 * it showed last time for the profile, while Hermes is asked again.
 */
export function ToolsetPage({ name, label, profile, onBack }: Props) {
  useMouseBack(onBack)
  const [backends, setBackends] = useState<ToolsetBackends | null>(null)
  const [models, setModels] = useState<ToolsetModels | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const generation = useRef(0)
  const hasModels = MODEL_TOOLSETS.has(name)

  const loadModels = useCallback(
    async (mine: number) => {
      if (!hasModels) return
      try {
        const raw = await readModels(http, name, profile)
        if (generation.current !== mine) return
        setModels(parseModels(raw))
        setModelsError(null)
        answerKeeper(hermesModelsPath(name, profile))(raw)
      } catch (e) {
        if (generation.current === mine) setModelsError(t('Couldn’t read this backend’s models.') + ` ${message(e)}`)
      }
    },
    [hasModels, name, profile]
  )

  const load = useCallback(async () => {
    const mine = generation.current
    setError(null)
    try {
      const path = configPath(name, profile)
      const raw = await gateway.http('GET', path)
      if (generation.current !== mine) return
      setBackends(parseBackends(raw))
      answerKeeper(path)(raw)
    } catch (e) {
      if (generation.current === mine) setError(message(e))
    }
    await loadModels(mine)
  }, [name, profile, loadModels])

  useEffect(() => {
    generation.current++
    const kept = keptAnswer(configPath(name, profile))
    setBackends(kept ? parseBackends(kept) : null)
    const keptModels = hasModels ? keptAnswer(hermesModelsPath(name, profile)) : null
    setModels(keptModels ? parseModels(keptModels) : null)
    setNotice(null)
    setKeys({})
    setWorking(null)
    setError(null)
    setModelsError(null)
    void load()
  }, [name, profile, hasModels, load])

  /** A change in turn with every other config save; the page reads again after it. */
  const change = async (id: string, write: () => Promise<void>) => {
    // A new generation, so a read still in flight from before the change can't land over it.
    const mine = ++generation.current
    setWorking(id)
    setNotice(null)
    try {
      await write()
      if (generation.current === mine) await load()
    } catch (e) {
      if (generation.current === mine) setNotice(t('Couldn’t save that change: {error}', { error: message(e) }))
    } finally {
      if (generation.current === mine) setWorking(null)
    }
  }

  const useBackend = (backend: Backend) =>
    change(backend.name, async () => {
      const body: Record<string, unknown> = { provider: backend.name }
      if (profile !== 'default') body.profile = profile
      const answer = (await inTurn(() => gateway.http('PUT', providerPath(name, profile), body))) as { needs_nous_auth?: unknown; error?: unknown } | null
      if (typeof answer?.error === 'string' && answer.error) throw new Error(answer.error)
      // Shown as Hermes now holds it; the models are the new backend's.
      setBackends(shown => shown && choosingBackend(shown, backend.name))
      setModels(null)
      if (answer?.needs_nous_auth === true) setNotice(t('Sign in to Nous Portal on your host to use this backend.'))
    })

  const saveKey = (key: string) =>
    change(key, async () => {
      const value = keys[key]?.trim()
      if (!value) return
      await gateway.http('PUT', scoped('/api/env', profile), profile !== 'default' ? { key, value, profile } : { key, value })
      setKeys(v => ({ ...v, [key]: '' }))
      setBackends(shown => shown && settingKey(shown, key))
    })

  const chooseModel = (id: string) =>
    change(id, async () => {
      await inTurn(() => pickModel(http, name, profile, id))
      setModels(shown => shown && { ...shown, current: id })
    })

  const backendRow = (backend: Backend) => (
    <div key={backend.name} className="cap-row-block">
      <div className="cap-row">
        <div className="cap-row-text">
          <strong>{backend.name}</strong>
          {backend.badge ? <span className="cap-badge">{backend.badge}</span> : null}
          {statusBadge(backend.status)}
          {backend.tag ? <span className="meta">{backend.tag}</span> : null}
        </div>
        {backend.active ? (
          <span className="meta cap-ok">{t('In use')}</span>
        ) : (
          <button className="secondary" disabled={working !== null} onClick={() => void useBackend(backend)}>
            {working === backend.name ? t('Saving…') : t('Use This Backend')}
          </button>
        )}
      </div>
      {backend.keys.map(k => (
        <div key={k.key} className="pset-row toolset-key">
          <code>{k.key}</code>
          <span className={k.isSet ? 'meta cap-ok' : 'meta'}>{k.isSet ? t('Set') : t('Not set')}</span>
          <input
            type="password"
            value={keys[k.key] ?? ''}
            placeholder={k.isSet ? t('Replace') : t('API key')}
            aria-label={k.key}
            spellCheck={false}
            onChange={e => setKeys(v => ({ ...v, [k.key]: e.target.value }))}
          />
          <button className="secondary" disabled={working !== null || !keys[k.key]?.trim()} onClick={() => void saveKey(k.key)}>
            {k.isSet ? t('Replace') : t('Add')}
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{label}</h1>
      </div>
      {notice ? <p className="error-text">{notice}</p> : null}
      {backends?.hasCategory && backends.backends.length ? (
        <section className="pset-section">
          <h2>{t('Backends')}</h2>
          {backends.backends.map(backendRow)}
        </section>
      ) : !backends ? (
        error ? (
          <div className="pset-row">
            <span className="error-text">{error}</span>
            <button className="secondary" onClick={() => void load()}>
              {t('Try Again')}
            </button>
          </div>
        ) : (
          <p className="meta">{t('Loading…')}</p>
        )
      ) : !hasModels ? (
        <p className="meta">{t('This tool has no backends to set up.')}</p>
      ) : null}
      {models ? (
        <section className="pset-section">
          <h2>{t('Model')}</h2>
          {models.models.map(model => {
            const inUse = model.id === models.current
            return (
              <div key={model.id} className="cap-row">
                <div className="cap-row-text">
                  <strong>{model.display}</strong>
                  {model.id === models.default ? <span className="cap-badge">{t('Default')}</span> : null}
                  {model.facts ? <span className="meta">{model.facts}</span> : null}
                  {model.strengths ? <span className="meta">{model.strengths}</span> : null}
                </div>
                {inUse ? (
                  <span className="meta cap-ok">{t('In use')}</span>
                ) : (
                  <button className="secondary" disabled={working !== null} onClick={() => void chooseModel(model.id)}>
                    {working === model.id ? t('Saving…') : t('Use')}
                  </button>
                )}
              </div>
            )
          })}
          {models.override ? (
            <p className="meta voice-call-problem">
              {t('{env} on your host picks {model}, over this setting.', { env: models.override.env, model: models.override.model })}
            </p>
          ) : null}
        </section>
      ) : modelsError ? (
        <p className="meta">{modelsError}</p>
      ) : null}
      <p className="meta">{t('Changes apply to new sessions.')}</p>
    </div>
  )
}
