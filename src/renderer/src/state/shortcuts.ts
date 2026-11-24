/**
 * Conduit's keyboard shortcuts, after the phone's catalog: ⌘N New Chat, ⌘F
 * Search, ⌘. Stop, ⌘, Settings, ⌘1 to ⌘6 the sections, ⌘+ ⌘− ⌘0 the chat's
 * text size, ⌘\ the chat list and ⌘/ this list. The Mac's menu bar holds them there; Windows
 * has no menu bar, so the window reads Ctrl and the same key.
 */
import { t } from '../../../shared/i18n'
import { DEFAULT_RAIL_SECTIONS, type MenuAction, type RailSection } from '../../../shared/ipc'

export type GoTo = RailSection
/** ⌘1 to ⌘6, in the rail's default order. */
export const GO_TO: GoTo[] = [...DEFAULT_RAIL_SECTIONS]

/** The key a shortcut takes, as KeyboardEvent.key; the first is the one shown. */
const KEYS: Partial<Record<MenuAction, string[]>> = {
  'new-chat': ['n'],
  search: ['f'],
  stop: ['.'],
  settings: [','],
  'text-bigger': ['+', '='],
  'text-smaller': ['-', '_'],
  'text-normal': ['0'],
  shortcuts: ['/', '?'],
  'toggle-sidebar': ['\\'],
  'go-1': ['1'],
  'go-2': ['2'],
  'go-3': ['3'],
  'go-4': ['4'],
  'go-5': ['5'],
  'go-6': ['6']
}

/** Ctrl (or ⌘ on a Mac, where the menu bar normally answers first) and a key, as the action it runs. */
export function shortcutFor(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, mac: boolean): MenuAction | null {
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!command || event.altKey) return null
  const key = event.key.toLowerCase()
  for (const [action, keys] of Object.entries(KEYS) as [MenuAction, string[]][]) {
    if (keys.includes(key)) return action
  }
  return null
}

/** "⌘N" on a Mac, "Ctrl+N" elsewhere. */
export function glyphs(action: MenuAction, mac: boolean): string {
  const key = KEYS[action]?.[0] ?? ''
  if (mac) return `⌘${key === '-' ? '−' : key.toUpperCase()}`
  return `Ctrl+${key === '+' ? 'Plus' : key === '-' ? 'Minus' : key.toUpperCase()}`
}

export function sectionTitle(section: GoTo): string {
  switch (section) {
    case 'bots':
      return t('Bots')
    case 'chats':
      return t('Chats')
    case 'tasks':
      return t('Tasks')
    case 'pulse':
      return t('Pulse')
    case 'artifacts':
      return t('Artifacts')
    default:
      return t('Needs you')
  }
}

/** The shortcut glyph for `section` among `pinned` (⌘1–⌘6 or Ctrl+1–Ctrl+6), or null when unpinned. */
export function shortcutForSection(section: GoTo, pinned: readonly GoTo[], mac: boolean): string | null {
  const index = pinned.indexOf(section)
  if (index < 0 || index >= 6) return null
  return glyphs(`go-${index + 1}` as MenuAction, mac)
}

export interface ShortcutRow {
  title: string
  keys: string[]
}

/** The list ⌘/ opens, grouped as the phone's sheet is, with Go to following the pinned rail order. */
export function shortcutGroups(mac: boolean, sections: readonly GoTo[] = GO_TO, quickAsk?: string | null): { title: string; rows: ShortcutRow[] }[] {
  const row = (title: string, action: MenuAction): ShortcutRow => ({ title, keys: [glyphs(action, mac)] })
  return [
    {
      title: t('Chats'),
      rows: [
        row(t('New Chat'), 'new-chat'),
        row(t('Search'), 'search'),
        { title: t('Send'), keys: [mac ? '↩' : 'Enter'] },
        { title: t('Stop'), keys: [glyphs('stop', mac), 'Esc'] },
        row(t('Show or Hide Sidebar'), 'toggle-sidebar'),
        // From anywhere, with the keys Settings > Quick Ask holds; left out while it's off or another app has them.
        ...(quickAsk ? [{ title: t('Quick Ask'), keys: [quickAsk] }] : [])
      ]
    },
    {
      title: t('Go to'),
      rows: [...sections.slice(0, 6).map((section, i) => row(sectionTitle(section), `go-${i + 1}` as MenuAction)), row(t('Settings'), 'settings')]
    },
    {
      title: t('Chat text size'),
      rows: [row(t('Make Text Bigger'), 'text-bigger'), row(t('Make Text Smaller'), 'text-smaller'), row(t('Make Text Normal Size'), 'text-normal')]
    },
    { title: '', rows: [row(t('Keyboard Shortcuts'), 'shortcuts')] }
  ]
}

const SCALE_KEY = 'conduit.chatTextScale'
/** The chat's text size steps, normal at 1. */
export const SCALES = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.7]

export function nextScale(current: number, by: -1 | 0 | 1): number {
  if (by === 0) return 1
  const i = SCALES.findIndex(s => s >= current - 0.001)
  const at = i < 0 ? SCALES.length - 1 : i
  return SCALES[Math.min(SCALES.length - 1, Math.max(0, at + by))]
}

export function readScale(): number {
  try {
    const value = Number(localStorage.getItem(SCALE_KEY))
    return SCALES.includes(value) ? value : 1
  } catch {
    return 1
  }
}

export function applyScale(scale: number): void {
  document.documentElement.style.setProperty('--chat-scale', String(scale))
  try {
    if (scale === 1) localStorage.removeItem(SCALE_KEY)
    else localStorage.setItem(SCALE_KEY, String(scale))
  } catch {
    // Normal size next time.
  }
}

/** The scale another window just saved, from its `storage` event; null for any other key. */
export function scaleFromStorage(event: Pick<StorageEvent, 'key' | 'newValue'>): number | null {
  if (event.key !== SCALE_KEY) return null
  const value = Number(event.newValue)
  return SCALES.includes(value) ? value : 1
}

/** The text-size step a shortcut asks for, or null when the action is another one. */
export function scaleStep(action: MenuAction | null): -1 | 0 | 1 | null {
  return action === 'text-bigger' ? 1 : action === 'text-smaller' ? -1 : action === 'text-normal' ? 0 : null
}
