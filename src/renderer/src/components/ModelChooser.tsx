import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@shared/i18n'
import { groupModels, reasoningTitle, typedModelId, typedModelProviders, type ModelProviderRow } from '../state/models'
import { ModelCard, PickRow, ProviderHeader, ReasoningBars, TypedIdRow } from './ModelSheet'
import { isPinned, pinnedRows, recentRows } from '../state/modelQuickPicks'
import { chooserLines, chooserListed, chooserPick, chooserValue, providerStartsOpen } from '../state/modelChooser'
import { useModelQuickPicks, useModelVisibility } from './ModelOptions'
import { modelHidden, visibleProviders } from '../state/modelVisibility'
import { EditModelsButton, ModelVisibilityEditor } from './ModelVisibilityEditor'
import { Icon } from './icons'
import { inSelectMenu } from './Select'

interface Props {
  /** "provider\nmodel", or '' for the setting's default. */
  value: string
  onChange: (value: string) => void
  providers: ModelProviderRow[] | null
  /** The setting's own default, first in the list ("Same as chats", "Profile default"); null when the setting has none. */
  defaultLabel: string | null
  /** The row's name when nothing is picked and there's no default to name. */
  emptyLabel?: string
  label: string
  disabled?: boolean
  className?: string
  /** The setting's reasoning, set in the page's top card with its own levels and inherit choice. */
  reasoning?: ChooserReasoning
}

export interface ChooserReasoning {
  value: string
  levels: readonly string[]
  inheritLabel: string
  onChange: (value: string) => void
}

/**
 * A model setting's row, naming its model and provider, which opens the
 * Model page: the pick on top, the setting's default first, then search,
 * Quick picks and every provider, closed (the phone's ModelChooserPage,
 * Eric 2026-11-08: no drop-down menus). The setting keeps its own saves;
 * this only hands back a pick.
 *
 * Models hidden with Edit (the page has its own) leave its lists, as in the
 * Model panel; the pick stays on top marked Hidden, and search finds hidden
 * models marked Hidden, so a setting can still be put on one.
 */
export function ModelChooser({ value, onChange, providers, defaultLabel, emptyLabel, label, disabled, className, reasoning }: Props) {
  const [open, setOpen] = useState(false)
  const lines = chooserLines(value, providers, defaultLabel ?? emptyLabel ?? t('Not set'))
  return (
    <>
      <button
        type="button"
        className={`model-chooser-row${className ? ` ${className}` : ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span className="model-chooser-title">{lines.title}</span>
        {lines.detail || reasoning?.value ? (
          <span className="meta model-chooser-detail">{[lines.detail, reasoning?.value ? reasoningTitle(reasoning.value) : ''].filter(Boolean).join(' · ')}</span>
        ) : null}
        <Icon name="chevron" />
      </button>
      {open ? (
        <ModelChooserPage
          value={value}
          providers={providers}
          defaultLabel={defaultLabel}
          emptyLabel={emptyLabel}
          label={label}
          reasoning={reasoning}
          onClose={() => setOpen(false)}
          onPick={next => {
            // The page closes on a pick unless it has reasoning to set, as on the phone.
            if (!reasoning) setOpen(false)
            if (next !== value) onChange(next)
          }}
        />
      ) : null}
    </>
  )
}

function ModelChooserPage({
  value,
  providers,
  defaultLabel,
  emptyLabel,
  label,
  reasoning,
  onClose,
  onPick
}: {
  value: string
  providers: ModelProviderRow[] | null
  defaultLabel: string | null
  emptyLabel?: string
  label: string
  reasoning?: ChooserReasoning
  onClose: () => void
  onPick: (value: string) => void
}) {
  const [query, setQuery] = useState('')
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    search.current?.focus()
  }, [editing])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || inSelectMenu(e)) return
      e.preventDefault()
      e.stopPropagation()
      // Esc leaves Edit first.
      if (editing) setEditing(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, editing])

  const { visibility } = useModelVisibility()
  const shownProviders = useMemo(() => (providers ? visibleProviders(visibility, providers) : []), [providers, visibility])
  const listed = useMemo(() => groupModels(providers ?? [], ''), [providers])
  const all = useMemo(() => groupModels(shownProviders, ''), [shownProviders])
  const quick = useModelQuickPicks()
  const searching = !!query.trim()
  const current = value ? chooserPick(value) : null
  // Every match names its provider, as on the phone; ↑ ↓ move a highlight and Return picks it.
  const matches = useMemo(
    () => (searching ? groupModels(providers ?? [], query).flatMap(group => group.models.map(model => ({ model, provider: group.slug }))) : []),
    [providers, query, searching]
  )
  const [highlight, setHighlight] = useState(0)
  const highlighted = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    setHighlight(0)
  }, [query])
  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: 'nearest' })
  }, [highlight])
  const pinned = searching ? [] : pinnedRows(quick.picks, shownProviders)
  const recent = searching ? [] : recentRows(quick.picks, shownProviders, current)
  const typedId = typedModelId(query)
  const typedProviders = typedId && providers ? typedModelProviders(providers, typedId, current?.provider) : []
  const lines = chooserLines(value, providers, defaultLabel ?? emptyLabel ?? t('Not set'))

  function row(model: string, provider: string, withProvider: boolean, index?: number) {
    const v = chooserValue(provider, model)
    const lit = index !== undefined && index === highlight
    return (
      <PickRow
        key={v}
        model={model}
        provider={provider}
        providers={providers}
        withProvider={withProvider}
        on={v === value}
        highlighted={lit}
        pinned={isPinned(quick.picks, { model, provider })}
        hidden={modelHidden(visibility, provider, model)}
        onPick={() => onPick(v)}
        onPin={() => quick.toggle({ model, provider })}
        rowRef={lit ? node => (highlighted.current = node) : undefined}
      />
    )
  }

  // On the body, so a settings sheet's transform or overflow never clips it; its clicks stay its own.
  return createPortal(
    <div
      className="shortcuts-backdrop"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="model-picker model-sheet model-chooser" role="dialog" aria-label={label}>
        {editing ? (
          <ModelVisibilityEditor providers={providers} openProvider={current?.provider} onDone={() => setEditing(false)} />
        ) : (
          <>
            <ModelCard
              model={lines.title}
              provider={current?.model ? current.provider : null}
              providers={providers}
              note={value && !chooserListed(value, listed) ? t('Saved') : current?.model && modelHidden(visibility, current.provider, current.model) ? t('Hidden') : undefined}
              actions={
                <>
                  <EditModelsButton onClick={() => setEditing(true)} />
                  <button className="staged-remove" aria-label={t('Close')} onClick={onClose}>
                    <Icon name="close" />
                  </button>
                </>
              }
            >
              {reasoning ? <ReasoningChoice reasoning={reasoning} /> : null}
            </ModelCard>
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
                  if (!matches.length) return
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault()
                    setHighlight(h => Math.min(matches.length - 1, Math.max(0, h + (e.key === 'ArrowDown' ? 1 : -1))))
                  } else if (e.key === 'Enter') {
                    // Return picks the highlighted match, as on the phone.
                    e.preventDefault()
                    const match = matches[Math.min(highlight, matches.length - 1)]
                    if (match) onPick(chooserValue(match.provider, match.model))
                  }
                }}
              />
            </label>
            <div className="model-list">
              {defaultLabel !== null && !searching ? (
                <section className="model-group-card">
                  <div className={`pick-row-wrap${!value ? ' on' : ''}`}>
                    <button className="pick-row" aria-pressed={!value} onClick={() => onPick('')}>
                      <span className="pick-row-text">
                        <span className="pick-row-name">{defaultLabel}</span>
                      </span>
                      {!value ? <Icon name="check" className="pick-row-check" /> : null}
                    </button>
                  </div>
                </section>
              ) : null}
              {searching ? (
                <>
                  {providers && !matches.length ? <div className="model-note">{t('Nothing matches “{query}”.', { query: query.trim() })}</div> : null}
                  {matches.length ? <section className="model-group-card">{matches.map((m, i) => row(m.model, m.provider, true, i))}</section> : null}
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
                  {!!providers?.length && !all.length ? <div className="model-note">{t('All providers are hidden. Click Edit to restore one.')}</div> : null}
                  {all.map(group => {
                    const opened = toggled[group.slug] ?? providerStartsOpen(group.slug, value, '')
                    return (
                      <section key={group.slug} className="provider-section">
                        <ProviderHeader
                          provider={group.slug}
                          name={group.name}
                          row={providers?.find(p => p.slug === group.slug)}
                          count={group.models.length}
                          open={opened}
                          holdsPick={current?.provider === group.slug}
                          onToggle={() => setToggled(s => ({ ...s, [group.slug]: !opened }))}
                        />
                        {opened ? group.models.map(model => row(model, group.slug, false)) : null}
                      </section>
                    )
                  })}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

/** The setting's reasoning in the top card: the rising bars at its own levels (a saved level it doesn't list stays), its inherit choice under them. */
function ReasoningChoice({ reasoning }: { reasoning: ChooserReasoning }) {
  const levels = reasoning.value && !reasoning.levels.includes(reasoning.value) ? [...reasoning.levels, reasoning.value] : reasoning.levels
  return (
    <>
      <ReasoningBars levels={levels} value={reasoning.value} unsetTitle={reasoning.inheritLabel} onPick={reasoning.onChange} />
      <button className={`model-inherit${!reasoning.value ? ' on' : ''}`} aria-pressed={!reasoning.value} onClick={() => reasoning.onChange('')}>
        <Icon name={!reasoning.value ? 'check' : 'chevron'} />
        {reasoning.inheritLabel}
      </button>
    </>
  )
}
