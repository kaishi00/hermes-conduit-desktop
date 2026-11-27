import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { answerKeeper, keptAnswer } from '../state/keptAnswers'
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
import { starterFace } from '../state/starterFaces'
import { movingPicture, mayMove, TooLargeError } from '../state/movingPicture'
import { avatarChanged, useAvatar } from '../state/useBots'
import { SummaryHost } from '../state/useStepSummaries'
import { readPicks, savePick, subscribePicks } from '../state/glowColors'
import { GlowContext } from './GlowColors'
import { BotPluginRow } from './BotPluginRow'
import { BotWorkSettings } from './BotWorkSettings'
import { StarterFaceArt } from './StarterFaceArt'
import { Icon } from './icons'
import { ModelChooser } from './ModelChooser'
import { useModelCatalog } from '../state/modelCatalog'
import { ModelCatalogNote, RefreshModelsButton } from './ModelCatalogNote'
import { ask, askText } from '../state/dialogs'
import { categoryNamesOf, cleanName, editCategoryPatch, sameCategory } from '../state/botCategories'

interface Props {
  bot: Bot
  /** This host's bots, for the Category choices and the id a category already has here. */
  among?: readonly Bot[]
  onClose: () => void
  /** Read the roster again after a save. */
  onSaved: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function CapabilityList({
  title,
  list,
  rows,
  onToggle,
  disabled
}: {
  title: string
  list: keyof Capabilities
  rows: Capabilities[keyof Capabilities]
  onToggle: (list: keyof Capabilities, name: string, on: boolean) => void
  disabled?: boolean
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
              <input type="checkbox" checked={row.enabled} disabled={disabled} onChange={e => onToggle(list, row.name, e.target.checked)} />
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
export function BotEditor({ bot, among = [], onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftFor(bot))
  const [details, setDetails] = useState<BotDetails | null>(null)
  // Shown from the last answer on this dashboard while Hermes answers again, and changed only once it has (Screens that open on their last answer).
  const describeRoute = `rpc:profiles.describe?name=${encodeURIComponent(bot.name)}`
  const kept = useMemo(() => {
    const answer = keptAnswer(describeRoute)
    return answer === undefined ? null : parseDetails(answer)
  }, [describeRoute])
  const shown = details ?? kept
  const capabilitiesShown = draft.capabilities ?? kept?.capabilities ?? null
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const catalog = useModelCatalog(useMemo(() => ({ profile: bot.name, explicit_only: true }), [bot.name]))
  const providers = catalog.providers
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const movingPicker = useRef<HTMLInputElement>(null)
  const stored = useAvatar(bot.name, bot.hasAvatar)
  const host = useContext(SummaryHost)
  const glowOf = useContext(GlowContext)
  const [glowPicked, setGlowPicked] = useState(() => !!readPicks(host)[bot.name])
  useEffect(() => subscribePicks((changed, picks) => changed === host && setGlowPicked(!!picks[bot.name])), [host, bot.name])
  /** The color picker shows the glow now: picked, from the picture, or Hermes' color; a color it can't show as hex shows the face's. */
  const glowShown = glowOf(bot.name)
  const glowValue = /^#[0-9a-f]{6}$/i.test(glowShown) ? glowShown : faceHex(starterFace(draft.face ?? bot.face))
  const update = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }))

  const loadDetails = async () => {
    setDetailsError(null)
    try {
      const keep = answerKeeper(describeRoute)
      const answer = await gateway.rpc('profiles.describe', { name: bot.name })
      const loaded = parseDetails(answer)
      setDetails(loaded)
      keep(answer)
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
  }, [bot.name])

  const modelValue = draft.provider && draft.model ? `${draft.provider}\n${draft.model}` : ''

  const [making, setMaking] = useState(false)
  const pickPicture = async (file: File | undefined, moving = false) => {
    if (!file) return
    setMaking(true)
    try {
      // Choose GIF or Video: a picture that moves, or a video, becomes a looping one; a still is used as a photo.
      const animation = moving && mayMove(file) ? await movingPicture(file) : null
      update({ picture: animation ?? (await normalizedPicture(file)), removePicture: false })
      setError(null)
    } catch (e) {
      setError(e instanceof TooLargeError ? t('That animation is too large. Try a shorter or simpler clip.') : t('That picture could not be used.'))
    } finally {
      setMaking(false)
    }
  }

  const changed = useMemo(() => {
    if (Object.keys(metaPatch(bot, draft)).length || draft.picture || draft.removePicture) return true
    if (editCategoryPatch(bot.category, draft.category, among)) return true
    if (!details) return draft.description.trim() !== (bot.description ?? '').trim()
    return (
      draft.description.trim() !== details.description.trim() ||
      draft.soul !== details.soul ||
      (!!draft.provider && !!draft.model && (draft.provider !== details.provider || draft.model !== details.model)) ||
      (!!draft.capabilities && Object.keys(capabilityParams(details.capabilities, draft.capabilities)).length > 0)
    )
  }, [bot, draft, details, among])

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
      Object.assign(patch, editCategoryPatch(bot.category, draft.category, among) ?? {})
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
            if (changesLook) problems.push(Object.keys(patch).every(key => key === 'sectionId' || key === 'sectionName') ? t('Couldn’t save that change. Try again.') : t('The name or color was not saved.'))
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
            if (await ask(note)) await gateway.rpc('profiles.configure', { ...pin, confirm_expensive_model: true })
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
              <button className="secondary" onClick={() => picker.current?.click()} disabled={saving || making}>
                {t('Choose Photo')}
              </button>
              <button className="secondary" onClick={() => movingPicker.current?.click()} disabled={saving || making}>
                {making ? t('Working…') : t('Choose GIF or Video')}
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
            <input
              ref={movingPicker}
              type="file"
              accept="image/gif,image/webp,image/png,video/mp4,video/quicktime,video/webm"
              hidden
              onChange={e => {
                void pickPicture(e.target.files?.[0], true)
                e.target.value = ''
              }}
            />
          </div>
          <p className="meta">{t('A GIF, a short video or a picture brought to life moves on Bots Home and in Hermes Desktop.')}</p>
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
          <h2>{t('Background glow')}</h2>
          <div className="glow-pick">
            <input type="color" aria-label={t('Background glow')} value={glowValue} onChange={e => savePick(host, bot.name, e.target.value)} />
            {glowPicked ? (
              <button className="ask-btn" onClick={() => savePick(host, bot.name, null)}>
                {t('Automatic')}
              </button>
            ) : null}
          </div>
          <p className="meta">{t("Kept on this computer. Automatic takes the picture's main color, else the bot's color.")}</p>
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
          <h2>{t('Category')}</h2>
          {(() => {
            const names = categoryNamesOf(among, [])
            const current = cleanName(draft.category)
            if (current && !names.some(n => sameCategory(n, current))) names.push(current)
            const value = names.find(n => sameCategory(n, current)) ?? ''
            return (
              <select
                className="pset-note"
                value={value}
                aria-label={t('Category')}
                onChange={async e => {
                  const picked = e.target.value
                  if (picked !== '\u0001new') return update({ category: picked })
                  const name = cleanName(await askText(t('New Category'), '', { confirm: t('Create'), maxLength: 40 }))
                  if (name) update({ category: name })
                }}
              >
                <option value="">{t('None')}</option>
                {names.map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
                <option value={'\u0001new'}>{t('New Category…')}</option>
              </select>
            )
          })()}
          <p className="meta">{t('The Bots list shows the bot under this heading.')}</p>
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
          {shown ? (
            <textarea
              className="pset-note bot-soul"
              rows={12}
              value={details ? draft.soul : shown.soul}
              readOnly={!details}
              onChange={e => update({ soul: e.target.value })}
              aria-label={t('Personality')}
            />
          ) : null}
          {details ? null : detailsError ? (
            <div className="pset-row">
              <span className="meta">{t("Could not load this bot's personality.")}</span>
              <button className="secondary" onClick={() => void loadDetails()}>
                {t('Try Again')}
              </button>
            </div>
          ) : shown ? null : (
            <p className="meta">{t('Loading…')}</p>
          )}
          <p className="meta">{t("Saved as the bot's SOUL.md.")}</p>
        </section>

        <section className="pset-section">
          <h2 className="model-section-title">
            {t('Model')}
            <RefreshModelsButton catalog={catalog} />
          </h2>
          {shown && (providers || catalog.failed) ? (
            <ModelChooser
              value={details ? modelValue : shown.provider && shown.model ? `${shown.provider}\n${shown.model}` : ''}
              providers={providers}
              defaultLabel={null}
              emptyLabel={t('Default')}
              label={t('Model')}
              disabled={!catalog.answered || !details}
              onChange={next => {
                const [provider = '', model = ''] = next.split('\n')
                update({ provider, model })
              }}
            />
          ) : !shown ? (
            <p className="meta">{detailsError ? '—' : t('Loading…')}</p>
          ) : null}
          {shown ? <ModelCatalogNote catalog={catalog} /> : null}
        </section>

        {capabilitiesShown && (capabilitiesShown.skills.length || capabilitiesShown.toolsets.length || capabilitiesShown.mcpServers.length) ? (
          <section className="pset-section">
            <h2>{t('Skills and tools')}</h2>
            {(['skills', 'toolsets', 'mcpServers'] as const).map(list => (
              <CapabilityList
                key={list}
                title={list === 'skills' ? t('Skills') : list === 'toolsets' ? t('Tools') : t('MCP Servers')}
                list={list}
                rows={capabilitiesShown[list]}
                disabled={!draft.capabilities}
                onToggle={(which, name, on) =>
                  setDraft(current => (current.capabilities ? { ...current, capabilities: setCapability(current.capabilities, which, name, on) } : current))
                }
              />
            ))}
          </section>
        ) : null}
        <BotWorkSettings bot={bot.name} botName={draft.title.trim() || bot.title} providers={providers} />
        <BotPluginRow bot={bot.name} botName={draft.title.trim() || bot.title} />
      </div>
    </main>
  )
}
