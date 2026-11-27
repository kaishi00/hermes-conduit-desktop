/**
 * Remembers where each kind of window was (Eric, 2026-11-27): the main
 * window, a chat's own window and a bot's screen window open where they were
 * last moved or resized, maximized again when they were, and on the primary
 * screen when theirs is gone. Kept in window-places.json in the data folder.
 *
 * It also keeps each window's normal bounds itself, so unmaximizing puts the
 * window back where it was: a window with our own title bar can come back
 * from maximized at the size it was made with on Windows.
 */
import { app, screen, type BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './atomicWrite'
import { cascade, placeOnScreen, readPlace, restoreFix, steadyPlace, type Rect, type WindowKind, type WindowPlace } from '../shared/windowPlaces'

const path = () => join(app.getPath('userData'), 'window-places.json')

let places: Partial<Record<WindowKind, WindowPlace>> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** The windows of each kind open now, which a new one opens beside. */
const open: Record<WindowKind, Set<BrowserWindow>> = { main: new Set(), chat: new Set(), screen: new Set() }

function load(): Partial<Record<WindowKind, WindowPlace>> {
  if (places) return places
  places = {}
  try {
    const stored = JSON.parse(readFileSync(path(), 'utf8')) as Record<string, unknown>
    for (const kind of ['main', 'chat', 'screen'] as const) {
      const place = readPlace(stored?.[kind])
      if (place) places[kind] = place
    }
  } catch {
    // None yet, or unreadable: windows open at their usual size.
  }
  return places
}

/** Writes what's changed now, as Conduit quits. */
export function saveWindowPlaces(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if (!places) return
  try {
    writeFileAtomic(path(), JSON.stringify(places, null, 2))
  } catch {
    // Not saved: the next move tries again.
  }
}

function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveWindowPlaces, 600)
}

const workAreas = (): Rect[] => {
  const primary = screen.getPrimaryDisplay()
  return [primary, ...screen.getAllDisplays().filter(d => d.id !== primary.id)].map(d => d.workArea)
}

/**
 * The bounds a new window of this kind opens at, from its last place or its
 * usual size, beside (not on top of) the windows of its kind already open.
 */
export function openingPlace(
  kind: WindowKind,
  usual: { width: number; height: number },
  min: { width: number; height: number }
): { bounds: Partial<Rect>; maximized: boolean } {
  const saved = load()[kind]
  if (!saved) return { bounds: usual, maximized: false }
  const areas = workAreas()
  let bounds = placeOnScreen(saved, areas, min)
  const taken = [...open[kind]].filter(w => !w.isDestroyed()).map(w => w.getNormalBounds())
  if (taken.length) {
    const area = screen.getDisplayMatching(bounds).workArea
    bounds = placeOnScreen(cascade(bounds, taken, area), areas, min)
  }
  // A second chat window over a maximized one opens unmaximized, beside it.
  return { bounds, maximized: saved.maximized === true && !taken.length }
}

/**
 * Follows a window's normal bounds and maximized state, saving them as its
 * kind's place, and puts its normal bounds back if unmaximizing lost them.
 * Call before it shows. `maximized` says it will open maximized (its caller
 * maximizes it as it shows: maximize() shows a hidden window).
 */
export function keepWindowPlace(window: BrowserWindow, kind: WindowKind, opening: { bounds: Partial<Rect>; maximized: boolean }): void {
  const { maximized } = opening
  const b = opening.bounds
  // The place it was opened at, kept as saved until it really moves (see steadyPlace).
  const opened: Rect | null = b.x !== undefined && b.y !== undefined && b.width && b.height ? { x: b.x, y: b.y, width: b.width, height: b.height } : null
  let normal: Rect | null = maximized ? window.getBounds() : null
  let settle: ReturnType<typeof setTimeout> | null = null
  let restoring: ReturnType<typeof setTimeout> | null = null
  open[kind].add(window)
  window.on('closed', () => open[kind].delete(window))
  const remember = () => {
    if (restoring || window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return
    const isMax = window.isMaximized()
    if (!isMax) normal = window.getBounds()
    load()[kind] = { ...steadyPlace(normal ?? window.getNormalBounds(), opened), maximized: isMax }
    saveSoon()
  }
  // Read once a move or resize has settled: mid-maximize, Windows can report the full-screen size before it says maximized.
  const later = (ms: number) => {
    if (settle) clearTimeout(settle)
    settle = setTimeout(() => {
      settle = null
      remember()
    }, ms)
  }
  window.on('resize', () => later(250))
  window.on('move', () => later(250))
  window.on('maximize', () => later(250))
  // Its own timer, which the restore's own resize events don't cancel, and nothing is read as normal until it has run.
  window.on('unmaximize', () => {
    if (restoring) clearTimeout(restoring)
    restoring = setTimeout(() => {
      restoring = null
      if (window.isDestroyed() || window.isMaximized()) return
      const fix = restoreFix(window.getBounds(), normal)
      if (fix) window.setBounds(fix)
      later(250)
    }, 60)
  })
  window.on('close', () => {
    if (settle) clearTimeout(settle)
    settle = null
    remember()
  })
}
