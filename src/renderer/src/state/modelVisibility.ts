/**
 * Edit's filters for the model lists, after the phone's ModelVisibility: the
 * providers and models hidden from the Model panel and every setting's Model
 * page. They stay on this computer, per host, and never change Hermes'
 * configuration.
 */
import { runnableModels, type ModelProviderRow } from './models'

export { runnableModels }

export interface ModelVisibility {
  /** Provider slugs. */
  hiddenProviders: string[]
  /** `modelKey(provider, model)` of each model hidden on its own. */
  hiddenModels: string[]
}

export const NOTHING_HIDDEN: ModelVisibility = {
  hiddenProviders: [],
  hiddenModels: []
}

/** A hidden model's key: its provider's slug and its id, as the phone keeps them. */
export const modelKey = (provider: string, model: string) => `${provider}\u001F${model}`

export const providerHidden = (visibility: ModelVisibility, provider: string) => visibility.hiddenProviders.includes(provider)

/** Hidden on its own or with its provider. */
export const modelHidden = (visibility: ModelVisibility, provider: string, model: string) => providerHidden(visibility, provider) || visibility.hiddenModels.includes(modelKey(provider, model))

/** The providers and models Edit leaves shown, in Hermes' order. */
export function visibleProviders(visibility: ModelVisibility, providers: ModelProviderRow[]): ModelProviderRow[] {
  if (!visibility.hiddenProviders.length && !visibility.hiddenModels.length) return providers
  const hidden = new Set(visibility.hiddenModels)
  return providers
    .filter(provider => !providerHidden(visibility, provider.slug))
    .map(provider =>
      provider.models?.some(model => hidden.has(modelKey(provider.slug, model)))
        ? {
            ...provider,
            models: provider.models.filter(model => !hidden.has(modelKey(provider.slug, model)))
          }
        : provider
    )
}

export function toggleProvider(visibility: ModelVisibility, provider: string): ModelVisibility {
  const hiddenProviders = providerHidden(visibility, provider) ? visibility.hiddenProviders.filter(p => p !== provider) : [...visibility.hiddenProviders, provider]
  return { ...visibility, hiddenProviders }
}

/** Hides or shows one model; its provider's own switch stays as it was. */
export function toggleModel(visibility: ModelVisibility, provider: string, model: string): ModelVisibility {
  const key = modelKey(provider, model)
  const hiddenModels = visibility.hiddenModels.includes(key) ? visibility.hiddenModels.filter(k => k !== key) : [...visibility.hiddenModels, key]
  return { ...visibility, hiddenModels }
}

/** Show all or Hide all of a provider's models. Hiding a provider keeps these choices for when it's shown again. */
export function setAllModels(visibility: ModelVisibility, provider: ModelProviderRow, visible: boolean): ModelVisibility {
  const keys = new Set(runnableModels(provider).map(model => modelKey(provider.slug, model)))
  const rest = visibility.hiddenModels.filter(k => !keys.has(k))
  return { ...visibility, hiddenModels: visible ? rest : [...rest, ...keys] }
}

/** How many of a provider's models its own switches leave shown. */
export const shownCount = (visibility: ModelVisibility, provider: ModelProviderRow) => runnableModels(provider).filter(model => !visibility.hiddenModels.includes(modelKey(provider.slug, model))).length

/**
 * Edit's own search: a provider whose slug or name holds the text keeps all
 * its models, another keeps the models whose id holds it.
 */
export function editorMatches(providers: ModelProviderRow[], query: string): { provider: ModelProviderRow; models: string[] }[] {
  const q = query.trim().toLowerCase()
  return providers.flatMap(provider => {
    const models = runnableModels(provider)
    // A provider with nothing it can run isn't in Edit, as in every other list (desktop#307).
    if (!models.length) return []
    if (!q || `${provider.slug} ${provider.name}`.toLowerCase().includes(q)) return [{ provider, models }]
    const matching = models.filter(model => model.toLowerCase().includes(q))
    return matching.length ? [{ provider, models: matching }] : []
  })
}

const storageKey = (host: string) => `conduit.modelVisibility.${host}`
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v) : [])

/** Each once, sorted, as the phone saves them. */
const normalized = (visibility: ModelVisibility): ModelVisibility => ({
  hiddenProviders: [...new Set(visibility.hiddenProviders.filter(Boolean))].sort(),
  hiddenModels: [...new Set(visibility.hiddenModels.filter(Boolean))].sort()
})

export function loadVisibility(host: string): ModelVisibility {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(host)) ?? 'null') as Partial<ModelVisibility> | null
    if (raw)
      return normalized({
        hiddenProviders: strings(raw.hiddenProviders),
        hiddenModels: strings(raw.hiddenModels)
      })
  } catch {
    // A fresh start.
  }
  return NOTHING_HIDDEN
}

const cache = new Map<string, ModelVisibility>()
const listeners = new Set<() => void>()

export function visibilityFor(host: string): ModelVisibility {
  let visibility = cache.get(host)
  if (!visibility) cache.set(host, (visibility = loadVisibility(host)))
  return visibility
}

export function saveVisibility(host: string, visibility: ModelVisibility): void {
  const next = normalized(visibility)
  cache.set(host, next)
  try {
    localStorage.setItem(storageKey(host), JSON.stringify(next))
  } catch {
    // Kept for this window only.
  }
  for (const listener of listeners) listener()
}

/** Told of every change, for a hook that draws them. */
export function subscribeVisibility(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
