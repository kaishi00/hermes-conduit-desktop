import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  dialog: { showMessageBox: vi.fn() },
  BrowserWindow: vi.fn(),
  globalShortcut: { register: vi.fn(), isRegistered: vi.fn(() => false), unregister: vi.fn() },
  screen: { getPrimaryDisplay: vi.fn() }
}))
vi.mock('electron', () => electron)
vi.mock('../src/main/pcDriver', () => ({
  artifactFor: () => null,
  deleteDriver: vi.fn(),
  driver: vi.fn(),
  driverPath: () => null,
  installDriver: vi.fn(),
  stopDriver: vi.fn()
}))
vi.mock('../src/main/pcExecutor', () => ({ Executor: vi.fn(), OWN_TITLES: ['Conduit'] }))
vi.mock('../src/main/settings', () => ({
  choosePcControl: vi.fn(() => true),
  pcControlSettings: () => ({ on: true, name: '', bots: ['default'], id: 'computer-1' })
}))

import { askPc, closePcAsk, initPcControl } from '../src/main/pcControl'
import type { PcRequest } from '../src/shared/ipc'

const request = (session: string): PcRequest => ({ id: 'r1', session, chat: 'Tidy', action: 'capture', args: {}, needs_ok: true, bot: 'Furina', profile: 'default' })

function fakeWindow(state: { minimized?: boolean; visible?: boolean } = {}) {
  return {
    isDestroyed: () => false,
    isMinimized: () => !!state.minimized,
    isVisible: () => state.visible !== false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    flashFrame: vi.fn()
  }
}

beforeEach(() => {
  electron.dialog.showMessageBox.mockReset()
})

describe('askPc', () => {
  it('puts the ask on the main window, brought forward and flashing until answered', async () => {
    const win = fakeWindow({ minimized: true, visible: false })
    initPcControl({ notify: () => undefined, stopped: () => undefined, window: () => win as never })
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0 })
    await expect(askPc(request('s1'))).resolves.toBe('allowed')
    expect(electron.dialog.showMessageBox.mock.calls[0][0]).toBe(win)
    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(win.flashFrame.mock.calls).toEqual([[true], [false]])
  })

  it('still asks with no window, and a phone answer closes it', async () => {
    initPcControl({ notify: () => undefined, stopped: () => undefined, window: () => null })
    electron.dialog.showMessageBox.mockImplementation(
      (options: { signal: AbortSignal }) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    )
    const shown = askPc(request('s2'))
    closePcAsk('s2')
    await expect(shown).resolves.toBe('closed')
    expect(typeof electron.dialog.showMessageBox.mock.calls[0][0]).toBe('object')
    expect(electron.dialog.showMessageBox.mock.calls[0]).toHaveLength(1)
  })
})
