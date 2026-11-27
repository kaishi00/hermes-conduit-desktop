/**
 * Bot categories, after the phone's BotCategories (Eric, 2026-11-27, option A): folders the person makes for
 * their bots (Home, Business), drawn as headings in the Bots sidebar, the bots in none last under Other. Hermes
 * Desktop calls them sections and keeps a bot's on the bot itself, `sectionId` and `sectionName` in its profile's
 * `ui_meta['hermes-bots']`, so a bot filed here, on the phone or in Hermes Desktop shows filed in all three.
 *
 * A category is its name: Hermes gives each section a random id, so the same category has another id on each
 * host. Bots group by name in any case; filing into a name a host already has reuses that host's id. A category
 * exists while a bot is in it. Their order is kept per host by name and synced as `bots.categories`, which the
 * phone reads and writes too.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { cleanOrder, arrange, hostOrder } from './botOrder'
import { installationId, PREFS_PATH } from './pinnedOrder'

export const CATEGORIES_SYNC_KEY = 'bots.categories'
const STORAGE = 'conduit.botCategoryOrder'
const FOLDED = 'conduit.botCategories.folded'
/** Other's key among the headings: no category's name can take it. */
export const OTHER_KEY = '\u0001other'
const MAX_NAME = 40

export interface BotCategory {
  id: string
  name: string
}

/** A category's name trimmed, or null when blank. */
export function cleanName(name: unknown): string | null {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed ? trimmed.slice(0, MAX_NAME) : null
}

export const categoryKey = (name: string) => name.trim().toLowerCase()
export const sameCategory = (a: string | null | undefined, b: string | null | undefined) =>
  a == null || b == null ? a == null && b == null : categoryKey(a) === categoryKey(b)

/** A bot's category from its ui_meta: both fields, or none (an old Hermes Desktop's id with no name has none to show). */
export function categoryOf(meta: Record<string, unknown>): BotCategory | undefined {
  const id = typeof meta.sectionId === 'string' ? meta.sectionId.trim() : ''
  const name = cleanName(meta.sectionName)
  return id && name ? { id, name } : undefined
}

/** The ui_meta patch that files a bot under `category`, or takes it out (null), as Hermes Desktop writes it. */
export function categoryPatch(category: BotCategory | null): Record<string, unknown> {
  return { sectionId: category?.id ?? undefined, sectionName: category?.name ?? undefined }
}

export function newCategoryId(now = Date.now()): string {
  return `sec-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** The category a bot on one host takes for `name`: the id another of that host's bots already files it under, else a new one. */
export function categoryNamed(name: string, among: readonly { category?: BotCategory }[], current?: BotCategory): BotCategory {
  if (current && sameCategory(current.name, name)) return { id: current.id, name }
  const existing = among.map(b => b.category).find(c => c && sameCategory(c.name, name))
  return { id: existing?.id ?? newCategoryId(), name }
}

export interface CategorySection<T> {
  /** Null for Other. */
  name: string | null
  key: string
  items: T[]
}

/** The headings for `items` in `order` (then in the order their first bot shows), Other last; null when no bot is in one. */
export function categorySections<T>(items: readonly T[], order: readonly string[], category: (item: T) => string | null | undefined): CategorySection<T>[] | null {
  const names: string[] = []
  const buckets = new Map<string, T[]>()
  const other: T[] = []
  for (const item of items) {
    const name = cleanName(category(item))
    if (!name) {
      other.push(item)
      continue
    }
    const key = categoryKey(name)
    if (!buckets.has(key)) {
      names.push(name)
      buckets.set(key, [])
    }
    buckets.get(key)!.push(item)
  }
  if (!names.length) return null
  const sections: CategorySection<T>[] = arrange(names, order, n => n).map(name => ({ name, key: categoryKey(name), items: buckets.get(categoryKey(name)) ?? [] }))
  if (other.length) sections.push({ name: null, key: OTHER_KEY, items: other })
  return sections
}

/** The order after `name` moves one place (-1 or 1) among the `shown` ones. */
export function movingCategory(order: readonly string[], name: string, step: -1 | 1, shown: readonly string[]): string[] {
  const at = shown.findIndex(s => sameCategory(s, name))
  const to = at + step
  if (at < 0 || to < 0 || to >= shown.length) return [...order]
  const full = [...cleanOrder([...order, ...shown.filter(s => !order.some(o => sameCategory(o, s)))])].filter(n => !sameCategory(n, name))
  const before = step < 0 ? shown[to] : shown[to + 1]
  const index = before ? full.findIndex(n => sameCategory(n, before)) : -1
  if (index < 0) full.push(name)
  else full.splice(index, 0, name)
  return full
}

/** The order with a renamed category in its old name's place. */
export function renamingCategory(order: readonly string[], old: string, to: string): string[] {
  return order.flatMap(n => (sameCategory(n, old) ? [to] : sameCategory(n, to) ? [] : [n]))
}

function load(host: string): string[] {
  try {
    return cleanOrder(JSON.parse(localStorage.getItem(`${STORAGE}.${host}`) ?? '[]'))
  } catch {
    return []
  }
}

function save(host: string, order: string[]): void {
  try {
    if (order.length) localStorage.setItem(`${STORAGE}.${host}`, JSON.stringify(order))
    else localStorage.removeItem(`${STORAGE}.${host}`)
  } catch {
    // Kept for this window only.
  }
}

type Http = (method: 'GET' | 'PUT', path: string, body?: unknown) => Promise<unknown>

/** This host's categories' order: from this computer, then the host's synced copy once per connection, which wins. */
export function useCategoryOrder(host: string, connected: boolean, http: Http) {
  const [order, setOrder] = useState<string[]>(() => load(host))
  const asked = useRef('')
  useEffect(() => {
    setOrder(load(host))
    asked.current = ''
  }, [host])
  useEffect(() => {
    if (!host || !connected || asked.current === host) return
    asked.current = host
    let live = true
    http('GET', PREFS_PATH).then(
      response => {
        const names = hostOrder(response, CATEGORIES_SYNC_KEY)
        if (!live || !names) return
        save(host, names)
        setOrder(names)
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [host, connected, http])
  const set = useCallback(
    (next: string[]) => {
      if (next.length === order.length && next.every((n, i) => n === order[i])) return
      setOrder(next)
      save(host, next)
      void http('PUT', PREFS_PATH, {
        installation_id: installationId(),
        device: 'Conduit for desktop',
        changes: { [CATEGORIES_SYNC_KEY]: next }
      }).catch(() => undefined)
    },
    [order, host, http]
  )
  return { order, set }
}

/** Folded headings, by key, on this computer only. */
export function useFoldedCategories() {
  const [folded, setFolded] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(FOLDED) ?? '[]')
      return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : []
    } catch {
      return []
    }
  })
  const toggle = useCallback((key: string) => {
    setFolded(current => {
      const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key]
      try {
        localStorage.setItem(FOLDED, JSON.stringify(next))
      } catch {
        // Kept for this window only.
      }
      return next
    })
  }, [])
  return { folded, toggle }
}
