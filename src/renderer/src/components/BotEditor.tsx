import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { BOTS_META_KEY, botsFromProfiles, keptColor, type Bot } from '../state/bots'
import {
  FACE_COUNT,
  capabilityParams,
  draftFor,
  failedSections,
  faceHex,
  faceName,
  mergedMeta,
  metaOutcome,
  metaPatch,
  normalizedPicture,
  onSummary,
  parseDetails,
  setCapability,
  shownFace,
  type BotDetails,
  type Capabilities,
  type Draft
} from '../state/botEditor'
import { groupModels, type ModelProviderRow } from '../state/models'
import { starterFace } from '../state/starterFaces'
import { avatarChanged, useAvatar } from '../state/useBots'
import { BotPluginRow } from './BotPluginRow'
import { BotWorkSettings } from './BotWorkSettings'
import { StarterFaceArt } from './StarterFaceArt'
import { Icon } from './icons'

interface Props {
  bot: Bot
  onClose: () => void
  /** Read the roster again after a save. */
  onSaved: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function CapabilityList({
  title,
  list,
  rows,
  onToggle
}: {
  title: string
  list: keyof Capabilities
  rows: Capabilities[keyof Capabilities]
  onToggle: (list: keyof Capabilities, name: string, on: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  if (!rows.length) return null
  return (
    <div className="bot-caps">
      <button className="pset-link" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span className="meta">{onSummary(rows)}</span>
        <Icon name={open ? 'chevronDown' : 'chevron'} />
      </button>
      {open ? (
        <div className="bot-caps-list">
          {rows.map(row => (
            <label key={row.name} className="toggle" title={row.description}>
              <input type="checkbox" checked={row.enabled} onChange={e => onToggle(list, row.name, e.target.checked)} />
              <span>
                {row.label ?? row.name}
                {row.description ? <span className="meta"> · {row.description}</span> : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Edit Bot, after the phone's sheet: the face and its color, the picture,
 * the name, description and personality, the model, and the skills, tools
 * and MCP servers the bot may use. Save writes only what changed.
 */
export function BotEditor({ bot, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftFor(bot))
  const [details, setDetails] = useState<BotDetails | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [providers, setProviders] = useState<ModelProviderRow[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const stored = useAvatar(bot.name, bot.hasAvatar)
  const update = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }))

  const loadDetails = async () => {
    setDetailsError(null)
    try {
      const loaded = parseDetails(await gateway.rpc('profiles.describe', { name: bot.name }))
      setDetails(loaded)
      // What's typed stays: only what wasn't touched takes Hermes' answer.
      setDraft(current => ({
        ...current,
        description: current.description === (bot.description ?? '') ? loaded.description : current.description,
        soul: current.soul || loaded.soul,
        provider: current.provider || loaded.provider,
        model: current.model || loaded.model,
        capabilities: current.capabilities ?? loaded.capabilities
      }))
    } catch (e) {
      setDetailsError(message(e))
    }
  }

  useEffect(() => {
    void loadDetails()
    gateway
      .rpc<{ providers?: ModelProviderRow[] }>('model.options', { profile: bot.name, explicit_only: true })
      .then(answer => setProviders(answer.providers ?? []))
      .catch(() => setProviders([]))
  }, [bot.name])

  const groups = useMemo(() => groupModels(providers ?? [], ''), [providers])
  const modelValue = draft.provider && draft.model ? `${draft.provider}\n${draft.model}` : ''
  const listed = groups.some(group => group.slug === draft.provider && group.models.includes(draft.model))

  const pickPicture = async (file: File | undefined) => {
    if (!file) return
    try {
      update({ picture: await normalizedPicture(file), removePicture: false })
      setError(null)
    } catch {
      setError(t('That picture could not be used.'))
    }
  }

  const changed = useMemo(() => {
    if (Object.keys(metaPatch(bot, draft)).length || draft.picture || draft.removePicture) return true
    if (!details) return draft.description.trim() !== (bot.description ?? '').trim()
    return (
      draft.description.trim() !== details.description.trim() ||
      draft.soul !== details.soul ||
      (!!draft.provider && !!draft.model && (draft.provider !== details.provider || draft.model !== details.model)) ||
      (!!draft.capabilities && Object.keys(capabilityParams(details.capabilities, draft.capabilities)).length > 0)
    )
  }, [bot, draft, details])

  /** Writes the look again over Hermes' newest copy, once, after another client wrote it first. */
  const retryMeta = async (patch: Record<string, unknown>) => {
    const fresh = botsFromProfiles(await gateway.rpc('profiles.list', {})).find(other => other.name === bot.name)
    if (!fresh) return 'failed'
    const params: Record<string, unknown> = { name: bot.name, ui_meta: { [BOTS_META_KEY]: mergedMeta(fresh.meta, patch) } }
    if (fresh.metaRevision !== undefined) params.ui_meta_expected_revisions = { [BOTS_META_KEY]: fresh.metaRevision }
    return metaOutcome(await gateway.rpc('profiles.configure', params))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setWarning(null)
    const problems: string[] = []
    try {
      // A new picture goes up before the look says there's a photo, so it never claims one the store lacks.
      let uploaded = false
      if (draft.picture) {
        try {
          await gateway.rpc('profiles.set_asset', { name: bot.name, asset: 'avatar', data: draft.picture })
          uploaded = true
          avatarChanged(bot.name)
        } catch {
          problems.push(t('The picture was not saved.'))
        }
      }
      const removing = !draft.picture && draft.removePicture
      const patch = metaPatch(bot, draft)
      const changesLook = Object.keys(patch).length > 0
      if (uploaded) Object.assign(patch, { imageKind: 'photo', custom: true })
      else if (removing) patch.imageKind = 'shape'

      const description = draft.description.trim()
      const descriptionChanged = description !== (details?.description ?? bot.description ?? '').trim()
      // The personality is only editable once Hermes answered, so an unloaded editor never blanks it.
      const soulChanged = !!details && draft.soul !== details.soul
      const sections = details && draft.capabilities ? capabilityParams(details.capabilities, draft.capabilities) : {}
      const params: Record<string, unknown> = { name: bot.name, ...sections }
      if (Object.keys(patch).length) {
        params.ui_meta = { [BOTS_META_KEY]: mergedMeta(bot.meta, patch) }
        if (bot.metaRevision !== undefined) params.ui_meta_expected_revisions = { [BOTS_META_KEY]: bot.metaRevision }
      }
      if (descriptionChanged) params.description = description
      if (soulChanged) params.soul = draft.soul
      let metaSaved = !Object.keys(patch).length
      if (Object.keys(params).length > 1) {
        const result = await gateway.rpc('profiles.configure', params)
        const failed = failedSections(result, [...(descriptionChanged ? ['description'] : []), ...(soulChanged ? ['soul'] : [])])
        if (failed.length) problems.push(t('The description or personality was not saved.'))
        if (
          failedSections(
            result,
            Object.keys(sections).map(key => key.replace(/^(disabled|enabled)_/, ''))
          ).length
        )
          problems.push(t('The skills, tools or MCP choices were not saved.'))
        if (!metaSaved) {
          let outcome = metaOutcome(result)
          if (outcome === 'conflict') outcome = await retryMeta(patch)
          metaSaved = outcome === 'persisted' || outcome === 'unsupported'
          if (!metaSaved) {
            if (changesLook) problems.push(t('The name or color was not saved.'))
            if (uploaded) problems.push(t('The picture was saved, but its look was not.'))
            if (removing) problems.push(t('The picture was not removed.'))
          }
        }
      }
      if (removing && metaSaved) {
        try {
          await gateway.rpc('profiles.set_asset', { name: bot.name, asset: 'avatar', clear: true })
          avatarChanged(bot.name)
        } catch {
          problems.push(t('The picture was not removed.'))
        }
      }
      if (details && draft.provider && draft.model && (draft.provider !== details.provider || draft.model !== details.model)) {
        const pin = { name: bot.name, provider: draft.provider, model: draft.model }
        try {
          const answer = (await gateway.rpc('profiles.configure', pin)) as { confirm_required?: unknown; confirm_message?: unknown } | null
          if (answer?.confirm_required === true) {
            const note = typeof answer.confirm_message === 'string' && answer.confirm_message ? answer.confirm_message : t('Use This Model?')
            if (window.confirm(note)) await gateway.rpc('profiles.configure', { ...pin, confirm_expensive_model: true })
            else problems.push(t('The model was not saved.'))
          }
        } catch {
          problems.push(t('The model was not saved.'))
        }
      }
      onSaved()
      if (problems.length) {
        setWarning(problems.join(' '))
        void loadDetails()
      } else onClose()
    } catch (e) {
      setError(t('Could not save the bot: {error}', { error: message(e) }))
    } finally {
      setSaving(false)
    }
  }

  const face = shownFace(bot, draft)
  const picture = draft.picture ?? (draft.removePicture ? null : stored)
  const color = keptColor(draft.color)

  return (
    <main className="settings bot-editor">
      <div className="pset">
        <div className="pulse-head">
          <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onClose}>
            <Icon name="back" />
          </button>
          <h1>{t('Edit Bot')}</h1>
          <span className="spacer" />
          <button className="secondary" onClick={onClose} disabled={saving}>
            {t('Cancel')}
          </button>
          <button className="primary" onClick={() => void save()} disabled={saving || !changed}>
            {saving ? t('Saving…') : t('Save')}
          </button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {warning ? <p className="pset-warn">{warning}</p> : null}

        <section className="pset-section">
          <h2>{t('Picture')}</h2>
          <div className="bot-editor-picture">
            <span className="bot-avatar" style={{ width: 96, height: 96 }} aria-hidden="true">
              {picture ? <img src={picture} alt="" draggable={false} /> : <StarterFaceArt face={face} background={color} />}
            </span>
            <div className="pset-actions">
              <button className="secondary" onClick={() => picker.current?.click()} disabled={saving}>
                {t('Choose Photo')}
              </button>
              {draft.picture || (bot.hasAvatar && !draft.removePicture) ? (
                <button className="secondary" onClick={() => update({ picture: undefined, removePicture: bot.hasAvatar })} disabled={saving}>
                  {t('Remove Photo')}
                </button>
              ) : draft.removePicture ? (
                <button className="secondary" onClick={() => update({ removePicture: false })} disabled={saving}>
                  {t('Keep Photo')}
                </button>
              ) : null}
            </div>
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              onChange={e => {
                void pickPicture(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        </section>

        <section className="pset-section">
          <h2>{t('Face')}</h2>
          <div className="bot-faces" role="radiogroup" aria-label={t('Face')}>
            {Array.from({ length: FACE_COUNT }, (_, index) => {
              const selected = (draft.face ?? bot.face) === index
              return (
                <button
                  key={index}
                  role="radio"
                  aria-checked={selected}
                  aria-label={faceName(index)}
                  title={faceName(index)}
                  className={`bot-face${selected ? ' on' : ''}`}
                  onClick={() => update({ face: index, color: faceHex(starterFace(index)) })}
                >
                  <StarterFaceArt face={starterFace(index)} />
                </button>
              )
            })}
          </div>
          <p className="meta">{t("Shown until the bot has a picture. Its color is the bot's color in Conduit.")}</p>
        </section>

        <section className="pset-section">
          <h2>{t('Display Name')}</h2>
          <input
            className="pset-note"
            value={draft.title}
            placeholder={bot.title}
            onChange={e => update({ title: e.target.value })}
            aria-label={t('Display Name')}
          />
          <p className="meta">{t('Profile ID: {name}', { name: bot.name })}</p>
        </section>

        <section className="pset-section">
          <h2>{t('Description')}</h2>
          <textarea
            className="pset-note"
            rows={2}
            value={draft.description}
            placeholder={t('What this bot is for')}
            onChange={e => update({ description: e.target.value })}
            aria-label={t('Description')}
          />
        </section>

        <section className="pset-section">
          <h2>{t('Personality')}</h2>
          {details ? (
            <textarea
              className="pset-note bot-soul"
              rows={12}
              value={draft.soul}
              onChange={e => update({ soul: e.target.value })}
              aria-label={t('Personality')}
            />
          ) : detailsError ? (
            <div className="pset-row">
              <span className="meta">{t("Could not load this bot's personality.")}</span>
              <button className="secondary" onClick={() => void loadDetails()}>
                {t('Try Again')}
              </button>
            </div>
          ) : (
            <p className="meta">{t('Loading…')}</p>
          )}
          <p className="meta">{t("Saved as the bot's SOUL.md.")}</p>
        </section>

        <section className="pset-section">
          <h2>{t('Model')}</h2>
          {details && providers ? (
            <select
              className="language-select"
              value={modelValue}
              aria-label={t('Model')}
              onChange={e => {
                const [provider = '', model = ''] = e.target.value.split('\n')
                update({ provider, model })
              }}
            >
              {!modelValue ? <option value="">{t('Default')}</option> : null}
              {modelValue && !listed ? <option value={modelValue}>{draft.model}</option> : null}
              {groups.map(group => (
                <optgroup key={group.slug} label={group.name}>
                  {group.models.map(model => (
                    <option key={model} value={`${group.slug}\n${model}`}>
                      {model}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <p className="meta">{detailsError ? '—' : t('Loading…')}</p>
          )}
        </section>

        {draft.capabilities && (draft.capabilities.skills.length || draft.capabilities.toolsets.length || draft.capabilities.mcpServers.length) ? (
          <section className="pset-section">
            <h2>{t('Skills and tools')}</h2>
            {(['skills', 'toolsets', 'mcpServers'] as const).map(list => (
              <CapabilityList
                key={list}
                title={list === 'skills' ? t('Skills') : list === 'toolsets' ? t('Tools') : t('MCP Servers')}
                list={list}
                rows={draft.capabilities![list]}
                onToggle={(which, name, on) =>
                  setDraft(current => (current.capabilities ? { ...current, capabilities: setCapability(current.capabilities, which, name, on) } : current))
                }
              />
            ))}
          </section>
        ) : null}
        <BotWorkSettings bot={bot.name} botName={draft.title.trim() || bot.title} groups={groups} />
        <BotPluginRow bot={bot.name} botName={draft.title.trim() || bot.title} />
      </div>
    </main>
  )
}
