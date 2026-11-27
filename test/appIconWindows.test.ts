import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const listeners: Record<string, (event: unknown, window: { setIcon: (image: unknown) => void }) => void> = {}
const image = { kind: 'icon' }
vi.mock('electron', () => ({
  app: { on: (name: string, listener: (typeof listeners)[string]) => (listeners[name] = listener), isPackaged: false },
  nativeImage: { createFromPath: () => image },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { watchNewWindows } = await import('../src/main/appIcon')

describe('the app icon on new windows', () => {
  it.skipIf(process.platform === 'darwin')('gives every new window the icon, the dark one included (a chat window showed Electron’s)', () => {
    watchNewWindows()
    const setIcon = vi.fn()
    listeners['browser-window-created']!({}, { setIcon })
    expect(setIcon).toHaveBeenCalledWith(image)
  })
})

describe('a narrow chat window’s header', () => {
  const css = readFileSync(join(__dirname, '../src/renderer/src/styles/app.css'), 'utf8')

  it('turns Open in Main Window into an icon and keeps room for the title only in a chat window', () => {
    const narrow = css.slice(css.indexOf('@container chat (max-width: 720px)'))
    expect(narrow).toMatch(/\.open-main > \.open-main-label \{\s*display: none;/)
    expect(narrow).toMatch(/\.chat-head\.soft:has\(\.open-main\) \.chat-title \{\s*min-width: 6em;/)
  })
})
