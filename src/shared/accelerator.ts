/**
 * A global shortcut as Electron spells it ("Alt+Space", "Ctrl+Shift+K"):
 * read from a key press in Settings, checked before it's registered, and
 * shown the way each system writes its keys.
 */

/** Quick Ask's shortcut until another is picked: Option+Space on the Mac. */
export const DEFAULT_QUICK_ASK_ACCELERATOR = 'Alt+Space'

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Cmd', 'Super'] as const

/** KeyboardEvent.code to the accelerator's key, for the keys that aren't a letter, a digit or F1 to F24. */
const CODES: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`'
}

const KEYS = new Set([
  ...Object.values(CODES),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`)
])

const isFunctionKey = (key: string) => /^F\d+$/.test(key)

type Press = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

/**
 * The accelerator a key press makes, or null while only modifiers are down
 * or the keys can't be a global shortcut: it takes Ctrl, Alt or ⌘ (the
 * Windows key), or a function key, so typing never sets it off.
 */
export function acceleratorFromEvent(event: Press, mac: boolean): string | null {
  // The letter the layout types, so Ctrl+Z is Z on a QWERTZ keyboard too; Option on a Mac types a symbol, so then the key's place.
  const typed = /^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : null
  const placed = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : /^F\d{1,2}$/.test(event.code) ? event.code : (CODES[event.code] ?? null)
  const key = typed ?? placed
  if (!key || !KEYS.has(key)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push(mac ? 'Cmd' : 'Super')
  const accelerator = [...parts, key].join('+')
  return validAccelerator(accelerator) ? accelerator : null
}

/** Whether these are keys Conduit will register: known modifiers, one known key, and more than Shift unless it's a function key. */
export function validAccelerator(accelerator: unknown): accelerator is string {
  if (typeof accelerator !== 'string' || accelerator.length > 40) return false
  // "Ctrl++" can't happen: no key here is spelled "+".
  const parts = accelerator.split('+')
  const key = parts.pop() ?? ''
  if (!KEYS.has(key)) return false
  if (new Set(parts).size !== parts.length) return false
  if (!parts.every(part => (MODIFIERS as readonly string[]).includes(part))) return false
  return isFunctionKey(key) || parts.some(part => part !== 'Shift')
}

const MAC_GLYPHS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Cmd: '⌘', Super: '⌘', Return: '↩', Up: '↑', Down: '↓', Left: '←', Right: '→' }

/** "⌥Space" on a Mac, "Alt+Space" elsewhere, with the Windows key named on Windows. */
export function acceleratorLabel(accelerator: string, platform: string): string {
  const parts = accelerator.split('+')
  if (platform === 'darwin') return parts.map(part => MAC_GLYPHS[part] ?? part).join('')
  return parts.map(part => (part === 'Super' || part === 'Cmd' ? (platform === 'win32' ? 'Win' : 'Super') : part === 'Return' ? 'Enter' : part)).join('+')
}
