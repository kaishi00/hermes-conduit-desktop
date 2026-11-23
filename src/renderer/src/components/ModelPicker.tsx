import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { ModelSwitch, OpenChat } from '../state/useChat'
import { REASONING_LEVELS, groupModels, typedModelId, typedModelProviders } from '../state/models'
import { Icon } from './icons'
import { isPinned, pinnedRows, recentRows, type ModelPick } from '../state/modelQuickPicks'
import { useModelQuickPicks, useModelVisibility } from './ModelOptions'
import { modelHidden, visibleProviders } from '../state/modelVisibility'
import { EditModelsButton, ModelVisibilityEditor } from './ModelVisibilityEditor'
import { useModelCatalog } from '../state/modelCatalog'
import { ModelCatalogNote, RefreshModelsButton } from './ModelCatalogNote'
import { ask } from '../state/dialogs'
import { ModelCard, PickRow, ProviderHeader, ReasoningBars, SwitchRow, TypedIdRow } from './ModelSheet'

interface Props {
  chat: OpenChat
  profile?: string
  /** The bot's configured default model to show on a new draft before a pick is made. */
  defaultModel?: string
  onClose: () => void
  setModel: (model: string, provider: string, confirmed?: boolean) => Promise<ModelSwitch>
  setReasoning: (effort: string) => Promise<void>
  setSpeed: (speed: 'normal' | 'fast' | 'ultrafast') => Promise<void>
  setYolo: (on: boolean) => Promise<void>
}

/**
 * The chat's model and run settings, as the phone's Model sheet (Eric
 * 2026-11-20, option A): the model in use with its reasoning bars, search,
 * Pinned and Recent, All providers opening in place, and Fast and YOLO.
 * Every control applies when it's clicked, with no Apply step, and the panel
 * stays open. Esc or a click outside closes it (Esc on All providers goes
 * back first, as it does from Edit).
 *
 * Edit hides the providers and models not wanted here, as the phone's does:
 * they leave Quick picks, the matches and All providers, and the typed id
 * isn't offered on a hidden provider or as a hidden model.
 */
export function ModelPicker({ chat, profile, defaultModel, onClose, setModel, setReasoning, setSpeed, setYolo }: Props) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; tone: 'error' | 'info' } | null>(null)
  const [allProviders, setAllProviders] = useState(false)
  const [editing, setEditing] = useState(false)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [highlight, setHighlight] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const highlighted = useRef<HTMLDivElement | null>(null)

  const params = useMemo(() => {
    const params: Record<string, unknown> = { explicit_only: true }
    if (chat.liveId) params.session_id = chat.liveId
    if (profile) params.profile = profile
    return params
  }, [chat.liveId, profile])
  const catalog = useModelCatalog(params)
  const providers = catalog.providers
  const { visibility } = useModelVisibility()
  const shownProviders = useMemo(() => (providers ? visibleProviders(visibility, providers) : null), [providers, visibility])
  useEffect(() => {
    search.current?.focus()
  }, [allProviders, editing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (editing) setEditing(false)
      else if (allProviders) setAllProviders(false)
      else onClose()
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // The model chip toggles the panel itself.
      if (panel.current && !panel.current.contains(target) && !target.closest?.('.chip-button')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose, allProviders, editing])

  const searching = !!query.trim()
  const all = useMemo(() => groupModels(shownProviders ?? [], ''), [shownProviders])
  // Every match names its provider, the same model from two providers being two matches, as on the phone.
  const matches = useMemo(
    () => (searching ? groupModels(shownProviders ?? [], query).flatMap(group => group.models.map(model => ({ model, provider: group.slug }))) : []),
    [shownProviders, query, searching]
  )
  useEffect(() => {
    setHighlight(0)
  }, [query])
  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: 'nearest' })
  }, [highlight])
  // A model Hermes doesn't list, typed as its id, on any provider (issue 2841): one row under the matches.
  // Checked against every listed row and what Edit hid, so a hidden model stays hidden once its row is gone.
  const typedId = typedModelId(query)
  const typedProviders =
    typedId && catalog.answered ? typedModelProviders(providers ?? [], typedId, chat.provider).filter(provider => !modelHidden(visibility, provider.slug, typedId)) : []
  const quick = useModelQuickPicks()
  const inUse: ModelPick | null = chat.model ? { model: chat.model, provider: chat.provider ?? '' } : null
  const pinned = pinnedRows(quick.picks, shownProviders ?? [])
  const recent = recentRows(quick.picks, shownProviders ?? [], inUse)
  const current = (model: string, provider: string) => model === chat.model && (!chat.provider || provider === chat.provider)

  async function pick(model: string, provider: string) {
    // Kept models wait for Hermes' answer before one is picked.
    if (busy || !catalog.answered || current(model, provider)) return
    setBusy(`${provider}/${model}`)
    setNote(null)
    let outcome = await setModel(model, provider)
    // A model Hermes guards (an expensive one, say) asks on the click; Cancel leaves the chat where it was.
    if (outcome.kind === 'confirm') {
      if (!(await ask(outcome.message))) {
        setBusy(null)
        return
      }
      outcome = await setModel(model, provider, true)
    }
    // A switch leads the recent models, with the one left a click away.
    if (outcome.kind === 'switched') quick.switched({ model, provider }, inUse)
    if (outcome.kind === 'failed') setNote({ text: outcome.message, tone: 'error' })
    else if (outcome.kind === 'switched' && outcome.deferred) setNote({ text: t('Switches to {model} when this reply finishes.', { model }), tone: 'info' })
    setBusy(null)
  }

  async function apply(name: string, write: () => Promise<void>) {
    if (busy) return
    setBusy(name)
    setNote(null)
    try {
      await write()
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  function row(model: string, provider: string, withProvider: boolean, index?: number) {
    const key = `${provider}/${model}`
    const lit = index !== undefined && index === highlight
    return (
      <PickRow
        key={key}
        model={model}
        provider={provider}
        providers={providers}
        withProvider={withProvider}
        on={current(model, provider)}
        busy={busy === key}
        highlighted={lit}
        disabled={(!!busy && busy !== key) || !catalog.answered}
        pinned={isPinned(quick.picks, { model, provider })}
        onPick={() => void pick(model, provider)}
        onPin={() => quick.toggle({ model, provider })}
        rowRef={lit ? node => (highlighted.current = node) : undefined}
      />
    )
  }

  const reasoning = (chat.reasoning ?? '').toLowerCase()
  const card = (
    <ModelCard
      model={chat.model || defaultModel || t('Model')}
      provider={chat.provider}
      providers={providers}
      busy={!!busy && busy.includes('/')}
      actions={
        <>
          <RefreshModelsButton catalog={catalog} />
          <EditModelsButton onClick={() => setEditing(true)} />
          <button className="staged-remove" aria-label={t('Close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </>
      }
    >
      <ReasoningBars levels={REASONING_LEVELS} value={reasoning} unsetTitle={reasoning ? undefined : t('Default')} disabled={!!busy} onPick={level => void apply('reasoning', () => setReasoning(level))} />
    </ModelCard>
  )

  const searchField = (
    <label className="model-search-field">
      <Icon name="search" />
      <input
        ref={search}
        type="search"
        placeholder={t('Search providers or models')}
        aria-label={t('Search providers or models')}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          // ↑ ↓ move the highlight through the matches and Return picks it, as on the phone with a keyboard.
          if (!matches.length) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight(h => Math.min(matches.length - 1, Math.max(0, h + (e.key === 'ArrowDown' ? 1 : -1))))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const match = matches[Math.min(highlight, matches.length - 1)]
            if (match) void pick(match.model, match.provider)
          }
        }}
      />
    </label>
  )

  return (
    <div className={`model-picker model-sheet${allProviders || searching ? ' tall' : ''}`} role="dialog" aria-label={t('Model')} ref={panel}>
      {editing ? (
        <ModelVisibilityEditor providers={providers} openProvider={chat.provider} onDone={() => setEditing(false)} />
      ) : allProviders ? (
        <>
          <div className="model-sheet-bar">
            <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={() => setAllProviders(false)}>
              <Icon name="back" />
            </button>
            <span className="model-sheet-title">{t('All providers')}</span>
            <RefreshModelsButton catalog={catalog} />
            {/* Edit goes back to the panel's, so "Click Edit to restore one" holds here too. */}
            <EditModelsButton
              onClick={() => {
                setAllProviders(false)
                setEditing(true)
              }}
            />
            <button className="staged-remove" aria-label={t('Close')} onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
          {note ? <div className={`model-note${note.tone === 'error' ? ' error' : ''}`}>{note.text}</div> : null}
          <div className="model-list">
            <ModelCatalogNote catalog={catalog} />
            {!!providers?.length && !all.length ? <div className="model-note">{t('All providers are hidden. Click Edit to restore one.')}</div> : null}
            {all.map(group => {
              // The provider holding the model in use opens first.
              const opened = toggled[group.slug] ?? group.slug === chat.provider
              return (
                <section key={group.slug} className="provider-section">
                  <ProviderHeader
                    provider={group.slug}
                    name={group.name}
                    row={providers?.find(p => p.slug === group.slug)}
                    count={group.models.length}
                    open={opened}
                    holdsPick={group.slug === chat.provider}
                    onToggle={() => setToggled(s => ({ ...s, [group.slug]: !opened }))}
                  />
                  {opened ? group.models.map(model => row(model, group.slug, false)) : null}
                </section>
              )
            })}
          </div>
        </>
      ) : (
        <>
          {card}
          {note ? <div className={`model-note${note.tone === 'error' ? ' error' : ''}`}>{note.text}</div> : null}
          {searchField}
          <div className="model-list">
            {searching ? (
              <>
                {providers && !matches.length ? <div className="model-note">{t('Nothing matches “{query}”.', { query: query.trim() })}</div> : null}
                {matches.length ? <section className="model-group-card">{matches.map((m, i) => row(m.model, m.provider, true, i))}</section> : null}
                <ModelCatalogNote catalog={catalog} />
                {typedId && typedProviders.length ? (
                  <TypedIdRow key={typedId} id={typedId}>{typedProviders.map(provider => row(typedId, provider.slug, true))}</TypedIdRow>
                ) : null}
              </>
            ) : (
              <>
                {pinned.length || recent.length ? (
                  <section className="model-group-card" aria-label={t('Quick picks')}>
                    {pinned.length ? <div className="model-group-name">{t('Pinned')}</div> : null}
                    {pinned.map(p => row(p.model, p.provider, true))}
                    {recent.length ? <div className="model-group-name">{t('Recent')}</div> : null}
                    {recent.map(p => row(p.model, p.provider, true))}
                  </section>
                ) : null}
                <ModelCatalogNote catalog={catalog} />
                <button className="model-all-providers" onClick={() => setAllProviders(true)}>
                  <Icon name="server" />
                  <span>{t('All providers')}</span>
                  {catalog.answered || providers ? <span className="provider-header-count">{all.length}</span> : null}
                  <Icon name="chevron" />
                </button>
              </>
            )}
          </div>
          <div className="model-switches">
            {chat.speed === 'ultrafast' ? (
              <div className="model-switch">
                <span>{t('Fast mode')}</span>
                <div className="segmented" role="radiogroup" aria-label={t('Fast mode')}>
                  {(['normal', 'fast', 'ultrafast'] as const).map(speed => (
                    <button
                      key={speed}
                      role="radio"
                      aria-checked={chat.speed === speed}
                      className={chat.speed === speed ? 'on' : undefined}
                      disabled={!!busy}
                      onClick={() => void apply('speed', () => setSpeed(speed))}
                    >
                      {speed === 'normal' ? t('Off') : speed === 'fast' ? t('Fast') : t('Ultrafast')}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <SwitchRow label={t('Fast mode')} checked={chat.speed === 'fast'} disabled={!!busy} onChange={on => void apply('speed', () => setSpeed(on ? 'fast' : 'normal'))} />
            )}
            <SwitchRow
              label={t('YOLO mode')}
              title={t('YOLO automatically approves tool actions for this conversation only. Set the profile default in Workspace & safety.')}
              checked={chat.yolo === true}
              disabled={!!busy}
              onChange={on => void apply('yolo', () => setYolo(on))}
            />
          </div>
        </>
      )}
    </div>
  )
}
