import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { ModelProviderRow } from '../state/models'
import { editorMatches, modelKey, providerHidden, setAllModels, shownCount, toggleModel, toggleProvider } from '../state/modelVisibility'
import { useModelVisibility } from './ModelOptions'
import { ProviderLogo } from './ProviderLogo'
import { Icon } from './icons'

/** Models a provider shows before "Show N more", as on the phone. */
const FIRST_MODELS = 8

/**
 * Edit, after the phone's ModelVisibilityEditor: every provider Hermes lists,
 * each shown or hidden, opening to its models, each shown or hidden. A change
 * is saved as it's clicked; Done goes back to the lists. Hiding a provider
 * keeps its models' own choices. The filters stay on this computer.
 */
export function ModelVisibilityEditor({ providers, openProvider, onDone }: { providers: ModelProviderRow[] | null; openProvider?: string | null; onDone: () => void }) {
  const { visibility, change } = useModelVisibility()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(openProvider ?? null)
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    search.current?.focus()
  }, [])
  const searching = !!query.trim()
  const groups = editorMatches(providers ?? [], query)

  return (
    <>
      <div className="model-sheet-bar">
        <span className="model-sheet-title">{t('Model visibility')}</span>
        <button className="model-edit-button" onClick={onDone}>
          {t('Done')}
        </button>
      </div>
      <label className="model-search-field">
        <Icon name="search" />
        <input ref={search} type="search" placeholder={t('Search providers or models')} aria-label={t('Search providers or models')} value={query} onChange={e => setQuery(e.target.value)} />
      </label>
      <div className="model-note">{t('Hiding a provider preserves its individual model choices. These filters stay on this computer.')}</div>
      <div className="model-list">
        {providers && !groups.length ? <div className="model-note">{t('Nothing matches “{query}”.', { query: query.trim() })}</div> : null}
        {groups.map(({ provider, models }) => {
          const name = provider.name || provider.slug
          const hidden = providerHidden(visibility, provider.slug)
          // A search opens every provider it finds.
          const opened = searching || open === provider.slug
          const shown = searching || showAll[provider.slug] ? models : models.slice(0, FIRST_MODELS)
          return (
            <section key={provider.slug} className={`provider-section visibility-provider${hidden ? ' hidden' : ''}`}>
              <div className="visibility-provider-head">
                <button className={`provider-header${opened ? ' open' : ''}`} aria-expanded={opened} onClick={() => setOpen(opened ? null : provider.slug)}>
                  <Icon name={opened ? 'chevronDown' : 'chevron'} />
                  <ProviderLogo slug={provider.slug} title={name} size={22} />
                  <span className="provider-header-text">
                    <span className="provider-header-name">{name}</span>
                    <span className="provider-header-quota">
                      {t('{shown} of {count} shown', {
                        shown: String(shownCount(visibility, provider)),
                        count: String(provider.models?.length ?? 0)
                      })}
                    </span>
                  </span>
                </button>
                <VisibilityPill hidden={hidden} label={name} onClick={() => change(v => toggleProvider(v, provider.slug))} />
              </div>
              {opened ? (
                <>
                  <div className="visibility-all">
                    <button onClick={() => change(v => setAllModels(v, provider, true))}>{t('Show all')}</button>
                    <button onClick={() => change(v => setAllModels(v, provider, false))}>{t('Hide all')}</button>
                  </div>
                  {shown.map(model => {
                    const off = visibility.hiddenModels.includes(modelKey(provider.slug, model))
                    return (
                      <button
                        key={model}
                        className={`visibility-model${off ? ' hidden' : ''}`}
                        aria-pressed={!off}
                        aria-label={`${model}, ${off ? t('Hidden') : t('Visible')}`}
                        onClick={() => change(v => toggleModel(v, provider.slug, model))}
                      >
                        <span className="pick-row-name">{model}</span>
                        <span className="visibility-state">{off ? t('Hidden') : t('Visible')}</span>
                      </button>
                    )
                  })}
                  {models.length > shown.length ? (
                    <button className="visibility-more" onClick={() => setShowAll(s => ({ ...s, [provider.slug]: true }))}>
                      {t('Show {count} more', {
                        count: String(models.length - shown.length)
                      })}
                    </button>
                  ) : null}
                </>
              ) : null}
            </section>
          )
        })}
      </div>
    </>
  )
}

function VisibilityPill({ hidden, label, onClick }: { hidden: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`visibility-pill${hidden ? ' hidden' : ''}`} aria-pressed={!hidden} aria-label={`${label}, ${hidden ? t('Hidden') : t('Visible')}`} onClick={onClick}>
      {hidden ? t('Hidden') : t('Visible')}
    </button>
  )
}

/** The Edit button beside the panel's and the page's other buttons. */
export function EditModelsButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="model-edit-button" onClick={onClick}>
      {t('Edit')}
    </button>
  )
}
