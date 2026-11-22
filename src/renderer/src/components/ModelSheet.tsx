import { useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { reasoningTitle, type ModelProviderRow } from '../state/models'
import { providerQuotaLine } from '../state/usage'
import { ProviderLogo } from './ProviderLogo'
import { Icon } from './icons'

/**
 * The parts the Model panel and every setting's Model page share, after the
 * phone's Model sheet (Eric 2026-11-20, option A): the model in use as a card
 * with its provider's logo, the reasoning as rising bars, rows that name their
 * provider with its logo, and the providers closed, each with its logo,
 * count and quota.
 */

const providerRow = (providers: ModelProviderRow[] | null, slug: string) => providers?.find(p => p.slug === slug)
export const providerName = (providers: ModelProviderRow[] | null, slug: string) => providerRow(providers, slug)?.name || slug

/** The model in use: its provider's logo, its name and provider, and the buttons the panel puts beside them. */
export function ModelCard({
  model,
  provider,
  providers,
  note,
  busy,
  actions,
  children
}: {
  model: string
  provider?: string | null
  providers: ModelProviderRow[] | null
  /** A word after the provider (Saved, Hidden). */
  note?: string
  busy?: boolean
  actions?: ReactNode
  children?: ReactNode
}) {
  const name = provider ? providerName(providers, provider) : ''
  return (
    <div className="model-card">
      <div className="model-card-head">
        <span className="model-card-logo" aria-hidden="true">
          {provider ? <ProviderLogo slug={provider} title={name} size={22} /> : <Icon name="server" />}
        </span>
        <span className="model-card-text">
          <span className="model-card-name">{model}</span>
          {name || note ? <span className="model-card-provider">{[name, note].filter(Boolean).join(' · ')}</span> : null}
        </span>
        {busy ? <Icon name="spinner" className="model-card-busy" style={{ animation: 'spin 1s linear infinite' }} /> : null}
        {actions}
      </div>
      {children}
    </div>
  )
}

/**
 * The reasoning as one bar per level, rising from the first to the last, as
 * on the phone: a click picks a bar, a drag across them follows the pointer
 * and sends the level once, on release; ← → move it from the keyboard.
 */
export function ReasoningBars({
  levels,
  value,
  disabled,
  onPick,
  unsetTitle
}: {
  levels: readonly string[]
  value: string
  disabled?: boolean
  onPick: (level: string) => void
  /** What no level reads as (a setting that follows another's), shown in place of a level. */
  unsetTitle?: string
}) {
  const strip = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const index = levels.indexOf(value)
  const shown = dragging ?? index
  const title = shown >= 0 ? reasoningTitle(levels[shown]!) : (unsetTitle ?? (value ? reasoningTitle(value) : ''))
  const at = (x: number) => {
    const box = strip.current?.getBoundingClientRect()
    if (!box || !box.width) return 0
    return Math.min(levels.length - 1, Math.max(0, Math.floor(((x - box.left) / box.width) * levels.length)))
  }
  const step = (to: number) => {
    const next = Math.min(levels.length - 1, Math.max(0, to))
    if (next !== index) onPick(levels[next]!)
  }
  return (
    <div className="reasoning-bars">
      <div className="reasoning-bars-head">
        <span>{t('Reasoning')}</span>
        <b>{title}</b>
      </div>
      <div
        ref={strip}
        className={`reasoning-bars-strip${disabled ? ' disabled' : ''}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={t('Reasoning')}
        aria-valuemin={0}
        aria-valuemax={levels.length - 1}
        aria-valuenow={index >= 0 ? index : undefined}
        aria-valuetext={title}
        aria-disabled={disabled || undefined}
        onPointerDown={e => {
          if (disabled || e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(at(e.clientX))
        }}
        onPointerMove={e => {
          if (dragging !== null) setDragging(at(e.clientX))
        }}
        onPointerUp={e => {
          if (dragging === null) return
          const level = at(e.clientX)
          setDragging(null)
          if (level !== index) onPick(levels[level]!)
        }}
        onPointerCancel={() => setDragging(null)}
        onKeyDown={e => {
          if (disabled) return
          const moves: Record<string, number> = { ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: levels.length - 1 }
          if (!(e.key in moves)) return
          e.preventDefault()
          // From no level, a step up picks the first and End the last; the rest leave it unset.
          if (index < 0) {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') step(0)
            else if (e.key === 'End') step(levels.length - 1)
            return
          }
          step(moves[e.key]!)
        }}
      >
        {levels.map((level, i) => (
          <span
            key={level}
            className={`reasoning-bar${i < shown ? ' below' : i === shown ? ' on' : ''}`}
            style={{ height: `${28 + (72 * i) / Math.max(1, levels.length - 1)}%` }}
            title={reasoningTitle(level)}
          />
        ))}
      </div>
      <div className="reasoning-bars-ends" aria-hidden="true">
        <span>{reasoningTitle(levels[0]!)}</span>
        <span>{reasoningTitle(levels[levels.length - 1]!)}</span>
      </div>
    </div>
  )
}

/** A model row: the model, and under it the provider with its logo where the row names one, and Hidden for one hidden with Edit; checked, switching, highlighted; Pin beside it. */
export function PickRow({
  model,
  provider,
  providers,
  withProvider,
  on,
  busy,
  highlighted,
  disabled,
  pinned,
  hidden,
  onPick,
  onPin,
  rowRef
}: {
  model: string
  provider: string
  providers: ModelProviderRow[] | null
  withProvider: boolean
  on: boolean
  busy?: boolean
  highlighted?: boolean
  disabled?: boolean
  pinned: boolean
  /** Hidden with Edit, found by a setting's search all the same. */
  hidden?: boolean
  onPick: () => void
  onPin: () => void
  rowRef?: (node: HTMLDivElement | null) => void
}) {
  const name = providerName(providers, provider)
  // Several providers serve one model, so Pin names both.
  const label = withProvider ? `${model}, ${name}` : model
  return (
    <div ref={rowRef} className={`pick-row-wrap${on ? ' on' : ''}${highlighted ? ' highlighted' : ''}`}>
      <button className="pick-row" aria-pressed={on} disabled={disabled} onClick={onPick}>
        <span className="pick-row-text">
          <span className="pick-row-name">{model}</span>
          {withProvider || hidden ? (
            <span className="pick-row-provider">
              {withProvider ? (
                <>
                  <ProviderLogo slug={provider} title={name} size={15} />
                  {name}
                </>
              ) : null}
              {hidden ? <span className="pick-row-hidden">{withProvider ? ` · ${t('Hidden')}` : t('Hidden')}</span> : null}
            </span>
          ) : null}
        </span>
        {busy ? <Icon name="spinner" style={{ animation: 'spin 1s linear infinite' }} /> : on ? <Icon name="check" className="pick-row-check" /> : null}
      </button>
      <button
        className={`pick-row-pin${pinned ? ' pinned' : ''}`}
        aria-label={pinned ? t('Unpin {name}', { name: label }) : t('Pin {name}', { name: label })}
        title={pinned ? t('Unpin') : t('Pin')}
        aria-pressed={pinned}
        onClick={onPin}
      >
        <Icon name="pin" />
      </button>
    </div>
  )
}

/** A provider's row: its logo, name and quota left, how many models it lists, open or closed. Sticks to the top while its models scroll under it. */
export function ProviderHeader({
  provider,
  name,
  row,
  count,
  open,
  holdsPick,
  onToggle
}: {
  provider: string
  name: string
  row?: ModelProviderRow
  count: number
  open: boolean
  holdsPick: boolean
  onToggle: () => void
}) {
  const quota = providerQuotaLine(row)
  return (
    <button className={`provider-header${open ? ' open' : ''}`} aria-expanded={open} onClick={onToggle}>
      <ProviderLogo slug={provider} title={name} size={22} />
      <span className="provider-header-text">
        <span className="provider-header-name">{name}</span>
        {quota ? <span className={`provider-header-quota ${quota.tone}`}>{quota.text}</span> : null}
      </span>
      {holdsPick && !open ? <Icon name="check" className="pick-row-check" /> : null}
      <span className="provider-header-count">{count}</span>
      <Icon name={open ? 'chevronDown' : 'chevron'} />
    </button>
  )
}

/** "Use “…” as a model ID", one row under the matches, opening to the providers it can go on. */
export function TypedIdRow({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="model-typed" aria-label={t('Use “{id}” as a model ID', { id })}>
      <button className="provider-header typed" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="code" />
        <span className="provider-header-text">
          <span className="provider-header-name">{t('Use “{id}” as a model ID', { id })}</span>
        </span>
        <Icon name={open ? 'chevronDown' : 'chevron'} />
      </button>
      {open ? children : null}
    </section>
  )
}

/** A switch, as Settings draws one: the whole row toggles it. */
export function SwitchRow({ label, checked, disabled, title, onChange }: { label: string; checked: boolean; disabled?: boolean; title?: string; onChange: (on: boolean) => void }) {
  return (
    <label className="model-switch" title={title}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="model-switch-track" aria-hidden="true" />
    </label>
  )
}
