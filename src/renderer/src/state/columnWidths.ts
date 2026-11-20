/**
 * Column widths a user dragged, after the phone's Resizable columns on a
 * split window (#1487, #1492): the line between the list and the chat, and
 * between the chat and the panel beside it (Artifacts, Work, Files), drags
 * that column's width. Each is kept on this device, not synced, and a
 * window too small for it gives the column what's left beside the chat's
 * least width.
 */

export interface ColumnBounds {
  /** Where the width is kept on this device. */
  key: string
  min: number
  max: number
}

export const LIST_COLUMN: ColumnBounds = { key: 'conduit.listWidth', min: 240, max: 520 }
export const PANEL_COLUMN: ColumnBounds = { key: 'conduit.panelWidth', min: 300, max: 720 }

/** The rail of sections at the window's leading edge. */
export const RAIL_WIDTH = 72
/** The chat keeps at least this much beside the columns, as the phone's 430 pt. */
export const CHAT_LEAST = 430
/** The panel's standard width: the list leaves room for it whether it's open or not, so the list doesn't jump as it opens. */
export const PANEL_STANDARD = 340
/** One keyboard step, as the phone's VoiceOver adjust. */
export const STEP = 40
/** A press that moves the line less than this keeps the stored width. */
export const DRAG_SLOP = 4

export const clampWidth = (width: number, bounds: ColumnBounds) => Math.round(Math.min(bounds.max, Math.max(bounds.min, width)))

/** A drag of the list's line this far past its least width hides the list, as the Mac's sidebars snap shut. */
export const SNAP_SHUT = 80

/** Whether a drag that started at this width hides the column: dragged well past its least width. */
export const snapsShut = (start: number, dx: number, sign: 1 | -1, bounds: ColumnBounds) => start + sign * dx < bounds.min - SNAP_SHUT

const LIST_HIDDEN_KEY = 'conduit.listHidden'

/** Whether the person hid the chat list (the « at its top, ⌘\ or Ctrl+\, or a drag past its least width), kept on this device. */
export function readListHidden(): boolean {
  try {
    return localStorage.getItem(LIST_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

export function writeListHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(LIST_HIDDEN_KEY, '1')
    else localStorage.removeItem(LIST_HIDDEN_KEY)
  } catch {
    // Kept for this window only.
  }
}

/** What a drag stores: the width it started from moved by the pointer, or null (nothing new) for a press that didn't move. */
export function storedAfterDrag(start: number, dx: number, sign: 1 | -1, bounds: ColumnBounds): number | null {
  if (Math.abs(dx) < DRAG_SLOP) return null
  return clampWidth(start + sign * dx, bounds)
}

/** A keyboard step: wider or narrower by one step. */
export const storedAfterStep = (current: number, wider: boolean, bounds: ColumnBounds) => clampWidth(current + (wider ? STEP : -STEP), bounds)

/** The list's standard width at its widest. */
export const LIST_STANDARD = 320

/**
 * The list's width on a window this wide: the user's, short of the chat's
 * least width, and of the panel's standard room on a window with room for
 * the panel beside a standard list, so widening the list never squeezes it.
 */
export function shownListWidth(stored: number | null, windowWidth: number): number | null {
  if (stored === null) return null
  const besideChat = windowWidth - RAIL_WIDTH - CHAT_LEAST
  const room = besideChat - LIST_STANDARD >= PANEL_STANDARD ? besideChat - PANEL_STANDARD : besideChat
  return Math.max(LIST_COLUMN.min, Math.min(stored, room))
}

/** The panel's width beside a list this wide: the user's, short of the chat's least width. */
export function shownPanelWidth(stored: number | null, windowWidth: number, listWidth: number): number | null {
  if (stored === null) return null
  const room = windowWidth - RAIL_WIDTH - listWidth - CHAT_LEAST
  return Math.max(PANEL_COLUMN.min, Math.min(stored, room))
}

export function readWidth(bounds: ColumnBounds): number | null {
  try {
    const value = Number(localStorage.getItem(bounds.key))
    return Number.isFinite(value) && value > 0 ? clampWidth(value, bounds) : null
  } catch {
    return null
  }
}

export function writeWidth(bounds: ColumnBounds, width: number | null) {
  try {
    if (width === null) localStorage.removeItem(bounds.key)
    else localStorage.setItem(bounds.key, String(clampWidth(width, bounds)))
  } catch {
    // Kept for this window only.
  }
}

/** Whether a chat fits beside the open one: the window less the list leaves the chat its least width and the pane its own. */
export const besideChatFits = (windowWidth: number, listWidth: number) => windowWidth - RAIL_WIDTH - listWidth >= CHAT_LEAST + PANEL_COLUMN.min
