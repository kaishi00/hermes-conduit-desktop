/**
 * The Model panel's Quick picks, after the phone's ModelQuickPicks (#1984):
 * models pinned here, then the ones switched between lately, so a switch
 * rarely needs the full list of providers. Kept on this computer, per host,
 * and shared by every model setting's list.
 */
import { runnableModels, type ModelProviderRow } from './models'

/** A model under the provider that serves it: the same model from two providers is two picks. */
export interface ModelPick {
  provider: string
  model: string
}

export interface ModelQuickPicks {
  pinned: ModelPick[]
  /** Newest first. */
  recent: ModelPick[]
}

/** Recent models kept, and how many show under the pinned ones. */
export const RECENT_LIMIT = 8
export const RECENT_SHOWN = 3

const same = (a: ModelPick, b: ModelPick) => a.model === b.model && a.provider === b.provider

export const isPinned = (picks: ModelQuickPicks, pick: ModelPick) => picks.pinned.some(p => same(p, pick))

/** Pins a model after the pinned ones, or unpins it. */
export function togglePin(picks: ModelQuickPicks, pick: ModelPick): ModelQuickPicks {
  return isPinned(picks, pick) ? { ...picks, pinned: picks.pinned.filter(p => !same(p, pick)) } : { ...picks, pinned: [...picks.pinned, pick] }
}

/** A chat switched from `previous` to `current`: both lead the recent models, the one switched to first. */
export function recordSwitch(picks: ModelQuickPicks, current: ModelPick, previous?: ModelPick | null): ModelQuickPicks {
  let recent = picks.recent
  for (const pick of [previous, current]) {
    if (!pick?.model) continue
    recent = [pick, ...recent.filter(p => !same(p, pick))]
  }
  return { ...picks, recent: recent.slice(0, RECENT_LIMIT) }
}

/** The picks the providers list (a model no longer listed stays kept but isn't shown), each once. */
function listed(picks: ModelPick[], providers: ModelProviderRow[]): ModelPick[] {
  const seen = new Set<string>()
  return picks.filter(pick => {
    const provider = providers.find(p => p.slug === pick.provider)
    if (!provider || !runnableModels(provider).includes(pick.model)) return false
    const key = `${pick.provider}\n${pick.model}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const pinnedRows = (picks: ModelQuickPicks, providers: ModelProviderRow[]) => listed(picks.pinned, providers)

/** Up to three recent models that aren't pinned and aren't the one in use, newest first. */
export function recentRows(picks: ModelQuickPicks, providers: ModelProviderRow[], current?: ModelPick | null): ModelPick[] {
  return listed(picks.recent, providers)
    .filter(pick => !isPinned(picks, pick) && !(current && current.model === pick.model && (!current.provider || current.provider === pick.provider)))
    .slice(0, RECENT_SHOWN)
}

const storageKey = (host: string) => `conduit.modelQuickPicks.${host}`
const EMPTY: ModelQuickPicks = { pinned: [], recent: [] }

function readPicks(value: unknown): ModelPick[] {
  return Array.isArray(value)
    ? value
        .filter((p): p is ModelPick => !!p && typeof p.provider === 'string' && typeof p.model === 'string')
        .map(p => ({ provider: p.provider, model: p.model }))
    : []
}

export function loadPicks(host: string): ModelQuickPicks {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(host)) ?? 'null') as Partial<ModelQuickPicks> | null
    if (raw) return { pinned: readPicks(raw.pinned), recent: readPicks(raw.recent).slice(0, RECENT_LIMIT) }
  } catch {
    // A fresh start.
  }
  return EMPTY
}

const cache = new Map<string, ModelQuickPicks>()
const listeners = new Set<() => void>()

function current(host: string): ModelQuickPicks {
  let picks = cache.get(host)
  if (!picks) cache.set(host, (picks = loadPicks(host)))
  return picks
}

export function updatePicks(host: string, change: (picks: ModelQuickPicks) => ModelQuickPicks): void {
  const next = change(current(host))
  cache.set(host, next)
  try {
    localStorage.setItem(storageKey(host), JSON.stringify(next))
  } catch {
    // Kept for this window only.
  }
  for (const listener of listeners) listener()
}

/** Told of every change, for a hook that draws them. */
export function subscribePicks(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const picksFor = current
