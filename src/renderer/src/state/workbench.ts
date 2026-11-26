/**
 * The workbench beside a chat with a folder (Eric, 2026-11-26, "B · Project
 * mode"; desktop issues 450 to 453): whether it's open, its width, and its
 * terminal drawer, kept on this device.
 */
import type { ColumnBounds } from './columnWidths'
import { RAIL_WIDTH } from './columnWidths'

/** The bench's views, on its tab strip, before its Browser tabs. */
export type BenchView = 'changes' | 'files'
export const BENCH_VIEWS: BenchView[] = ['changes', 'files']

/**
 * A Browser tab (issue 451): a page a dev server on the host serves, or a web
 * page. `url` is where it is now (null for a new tab), `nav` counts the times
 * it was sent somewhere (an address typed, a link opened), so the tab loads
 * then and only then.
 */
export interface BenchPage {
  id: string
  url: string | null
  title?: string
  nav: number
}

const PAGES_KEY = 'conduit.benchPages'
export const MAX_PAGES = 8
const MAX_FOLDERS = 30

/** A folder's Browser tabs, kept on this device so they come back with the bench. */
export function readPages(root: string): BenchPage[] {
  try {
    const all = JSON.parse(localStorage.getItem(PAGES_KEY) ?? '{}') as Record<string, unknown>
    const list = all && typeof all === 'object' ? all[root] : null
    if (!Array.isArray(list)) return []
    return list
      .filter((p): p is { id: string; url: string; title?: unknown } => !!p && typeof p.id === 'string' && typeof p.url === 'string')
      .slice(0, MAX_PAGES)
      .map(p => ({ id: p.id, url: p.url, title: typeof p.title === 'string' ? p.title : undefined, nav: 0 }))
  } catch {
    return []
  }
}

export function writePages(root: string, pages: BenchPage[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(PAGES_KEY) ?? '{}') as Record<string, unknown>
    const kept = all && typeof all === 'object' && !Array.isArray(all) ? all : {}
    delete kept[root]
    const saved = pages.filter(p => p.url).map(p => ({ id: p.id, url: p.url, title: p.title }))
    if (saved.length) kept[root] = saved
    // The newest folders last; the oldest go past 30.
    const roots = Object.keys(kept)
    for (const old of roots.slice(0, Math.max(0, roots.length - MAX_FOLDERS))) delete kept[old]
    localStorage.setItem(PAGES_KEY, JSON.stringify(kept))
  } catch {
    // Kept for this window only.
  }
}

export const pageKey = (page: BenchPage) => `page:${page.id}`

/** The view the bench shows: the one picked, or Changes when it names a Browser tab the strip doesn't have (a ninth, or another folder's). */
export const shownView = (view: string, pages: readonly BenchPage[]): string =>
  view.startsWith('page:') && !pages.some(p => pageKey(p) === view) ? 'changes' : view

export const BENCH_COLUMN: ColumnBounds = { key: 'conduit.benchWidth', min: 420, max: 1600 }
/** Beside an open bench the chat narrows to a column, down to this. */
export const CHAT_BESIDE_BENCH = 360
/** The bench's share of the room beside the rail and list when no width was dragged. */
export const BENCH_SHARE = 0.6

const OPEN_KEY = 'conduit.benchOpen'
const DRAWER_KEY = 'conduit.benchDrawer'

export function readBenchOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

export function writeBenchOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    // Kept for this window only.
  }
}

/** The bench's width on a window this wide, beside a list this wide: the user's, or its share, short of the chat's column. */
export function shownBenchWidth(stored: number | null, windowWidth: number, listWidth: number): number {
  const room = windowWidth - RAIL_WIDTH - listWidth
  const most = room - CHAT_BESIDE_BENCH
  const wanted = stored ?? Math.round(room * BENCH_SHARE)
  return Math.max(Math.min(BENCH_COLUMN.min, most), Math.min(wanted, most, BENCH_COLUMN.max))
}

export interface DrawerState {
  height: number
  folded: boolean
}

export const DRAWER_DEFAULT: DrawerState = { height: 260, folded: false }

export function readDrawer(): DrawerState {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAWER_KEY) ?? 'null') as Partial<DrawerState> | null
    if (!raw || typeof raw !== 'object') return DRAWER_DEFAULT
    const height = typeof raw.height === 'number' && Number.isFinite(raw.height) ? Math.max(120, Math.min(2000, raw.height)) : DRAWER_DEFAULT.height
    return { height, folded: raw.folded === true }
  } catch {
    return DRAWER_DEFAULT
  }
}

export function writeDrawer(state: DrawerState): void {
  try {
    localStorage.setItem(DRAWER_KEY, JSON.stringify(state))
  } catch {
    // Kept for this window only.
  }
}
