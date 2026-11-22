/**
 * The Model panel's lists: Hermes' `model.options` providers and their
 * models, narrowed by what's typed in the search, and the reasoning levels
 * the phone offers.
 */
import { t } from '../../../shared/i18n'

export interface ModelProviderRow {
  slug: string
  name: string
  models?: string[]
  is_current?: boolean | null
  unavailable_models?: string[] | null
}

/** Lowest first; Hermes turns reasoning off with "none". */
export const REASONING_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const

export function reasoningTitle(level: string): string {
  switch (level) {
    case 'none':
      return t('Off')
    case 'minimal':
      return t('Minimal')
    case 'low':
      return t('Low')
    case 'medium':
      return t('Medium')
    case 'high':
      return t('High')
    case 'xhigh':
      return t('Extra High')
    case 'max':
      return t('Max')
    case 'ultra':
      return t('Ultra')
    default:
      return level.replace(/[-_]/g, ' ').replace(/^\w/, c => c.toUpperCase())
  }
}

/**
 * Each provider with the models that match `query`: every word must be in
 * the provider's name or the model's id. A provider whose name matches
 * keeps all its models. Models Hermes says can't run are left out.
 */
/**
 * The search text as a model id Hermes doesn't list (hermes-conduit issue
 * 2841): a model a provider serves but doesn't list, or a snapshot id. One
 * word only, as a model id never has a space; null otherwise.
 */
export function typedModelId(query: string): string | null {
  const id = query.trim()
  return id && !/\s/.test(id) ? id : null
}

/** The providers a typed id can be put on: each that doesn't list it already, the chat's provider first. */
export function typedModelProviders(providers: ModelProviderRow[], id: string, preferred?: string | null): ModelProviderRow[] {
  const wanted = id.toLowerCase()
  const offered = providers.filter(provider => !(provider.models ?? []).some(model => model.toLowerCase() === wanted))
  const first = preferred ? offered.find(provider => provider.slug === preferred) : undefined
  return first ? [first, ...offered.filter(provider => provider !== first)] : offered
}

/** A provider's models less the ones Hermes lists as unavailable: the only ones any list shows. */
export function runnableModels(provider: ModelProviderRow): string[] {
  const unavailable = new Set(provider.unavailable_models ?? [])
  return (provider.models ?? []).filter(model => !unavailable.has(model))
}

export function groupModels(providers: ModelProviderRow[], query: string): { slug: string; name: string; models: string[] }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const groups: { slug: string; name: string; models: string[] }[] = []
  for (const provider of providers) {
    const models = runnableModels(provider)
    const label = `${provider.name} ${provider.slug}`.toLowerCase()
    const matches = words.length ? models.filter(m => words.every(w => label.includes(w) || m.toLowerCase().includes(w))) : models
    if (matches.length) groups.push({ slug: provider.slug, name: provider.name || provider.slug, models: matches })
  }
  return groups
}
