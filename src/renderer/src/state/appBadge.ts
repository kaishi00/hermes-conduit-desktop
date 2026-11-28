/**
 * The number on Conduit's app icon (hermes-conduit issue 3458, the phone's
 * App icon badge): how many chats wait on the user. Unread chats (the
 * default) counts what Needs you holds and each unread chat that isn't
 * already one of those; Needs you only counts Needs you; Off shows none.
 * The Mac's Dock and Linux launchers show it as a badge, Windows as a number
 * over the taskbar button. Kept on this computer.
 */
import { t } from '../../../shared/i18n'
import { chatIdsOf, type WaitingRow } from './needsYou'

export type BadgeMode = 'chats' | 'needsYou' | 'off'

export const BADGE_MODES: BadgeMode[] = ['chats', 'needsYou', 'off']
const KEY = 'conduit.appBadge'
/** Sent on the window when Settings picks another mode, for the count to follow. */
export const BADGE_MODE_EVENT = 'conduit:app-badge-mode'

export function loadBadgeMode(): BadgeMode {
  try {
    const saved = localStorage.getItem(KEY)
    return BADGE_MODES.includes(saved as BadgeMode) ? (saved as BadgeMode) : 'chats'
  } catch {
    return 'chats'
  }
}

export function saveBadgeMode(mode: BadgeMode): void {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // Unread chats again next launch.
  }
  window.dispatchEvent(new CustomEvent<BadgeMode>(BADGE_MODE_EVENT, { detail: mode }))
}

export function badgeModeTitle(mode: BadgeMode): string {
  return mode === 'chats' ? t('Unread chats') : mode === 'needsYou' ? t('Needs you only') : t('Off')
}

export function badgeModeCaption(mode: BadgeMode): string {
  if (mode === 'chats') return t('Counts the chats with a reply you haven’t seen or an approval or question waiting on you.')
  if (mode === 'needsYou') return t('Counts the chats with an approval or question waiting on you.')
  return t('Conduit’s icon shows no number.')
}

/**
 * The number: `needs` is what Needs you holds (as the tray counts it),
 * `waitingIds` the chats it's in, and `unreadIds` the unread chats' ids, so
 * a chat that is both counts once.
 */
export function badgeCount(mode: BadgeMode, needs: number, waitingIds: ReadonlySet<string>, unreadIds: readonly string[]): number {
  if (mode === 'off') return 0
  if (mode === 'needsYou') return needs
  return needs + new Set(unreadIds.filter(id => !waitingIds.has(id))).size
}

/**
 * Every id a waiting chat goes by, for `badgeCount`: Needs you's own
 * (`waitingIds`), each live request's id with the stored id this window
 * knows it by (`storedOf`) or a waiting row lists with it, and other
 * dashboards' waiting rows. A chat both waiting and unread then counts once.
 */
export function badgeWaitingIds(
  waitingIds: Iterable<string>,
  requestIds: readonly string[],
  storedOf: (sessionId: string) => string | null | undefined,
  rows: readonly WaitingRow[],
  otherRows: readonly WaitingRow[]
): Set<string> {
  return new Set<string>([
    ...waitingIds,
    ...requestIds.flatMap(id => [id, ...chatIdsOf(id, storedOf(id), rows)]),
    ...otherRows.flatMap(row => row.sessionIds)
  ])
}

/** The badge's text: past 99, "99+". */
export const badgeText = (count: number): string => (count > 99 ? '99+' : String(count))

/**
 * The number drawn as Windows' taskbar overlay (a red circle, 32 px), as a
 * PNG data URL; null for none, or where there's no canvas.
 */
export function badgeImage(count: number): string | null {
  if (count <= 0 || typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#e5484d'
  context.beginPath()
  context.arc(16, 16, 16, 0, Math.PI * 2)
  context.fill()
  const text = badgeText(count)
  context.fillStyle = '#ffffff'
  context.font = `bold ${text.length > 2 ? 13 : text.length > 1 ? 17 : 20}px "Segoe UI", system-ui, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, 16, 17)
  return canvas.toDataURL('image/png')
}
