import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => void

const windows = vi.hoisted(() => [] as FakeWindow[])
interface FakeWindow {
  options: Record<string, unknown>
  url: string
  destroyed: boolean
  handlers: Record<string, Handler[]>
  navigate: (url: string) => boolean
  emit: (name: string) => void
}

const electron = vi.hoisted(() => {
  class BrowserWindow {
    options: Record<string, unknown>
    url = ''
    destroyed = false
    handlers: Record<string, Handler[]> = {}
    navHandlers: Handler[] = []
    webContents = { on: (_name: string, handler: Handler) => this.navHandlers.push(handler) }
    constructor(options: Record<string, unknown>) {
      this.options = options
      windows.push(this as never)
    }
    on(name: string, handler: Handler) {
      ;(this.handlers[name] ??= []).push(handler)
    }
    once(name: string, handler: Handler) {
      this.on(name, handler)
    }
    emit(name: string) {
      for (const handler of this.handlers[name] ?? []) handler()
    }
    navigate(url: string) {
      let prevented = false
      for (const handler of this.navHandlers) handler({ preventDefault: () => (prevented = true) }, url)
      return prevented
    }
    setAlwaysOnTop = vi.fn()
    setContentProtection = vi.fn()
    show = vi.fn()
    focus = vi.fn()
    flashFrame = vi.fn()
    isDestroyed() {
      return this.destroyed
    }
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
    loadURL(url: string) {
      this.url = url
      return Promise.resolve()
    }
  }
  return {
    BrowserWindow,
    globalShortcut: { register: vi.fn(), isRegistered: vi.fn(() => false), unregister: vi.fn() },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }
  }
})
vi.mock('electron', () => electron)
vi.mock('../src/main/pcDriver', () => ({
  artifactFor: () => null,
  deleteDriver: vi.fn(),
  driver: vi.fn(),
  driverPath: () => null,
  installDriver: vi.fn(),
  stopDriver: vi.fn()
}))
vi.mock('../src/main/settings', () => ({
  choosePcControl: vi.fn(() => true),
  pcControlSettings: () => ({ on: true, name: '', bots: ['default'], id: 'computer-1' })
}))

import { askPage, askPc, closePcAsk } from '../src/main/pcControl'
import { OWN_TITLES } from '../src/main/pcExecutor'
import type { PcRequest } from '../src/shared/ipc'

const request = (session: string, extra: Partial<PcRequest> = {}): PcRequest => ({
  id: 'r1',
  session,
  chat: 'Tidy <my> downloads',
  action: 'capture',
  args: {},
  needs_ok: true,
  bot: 'Furina',
  profile: 'default',
  ...extra
})

beforeEach(() => {
  windows.length = 0
})

describe('askPc', () => {
  it('shows Conduit’s own window on top, out of screenshots and out of the bot’s reach', async () => {
    const shown = askPc(request('s1'))
    const win = windows[0] as unknown as InstanceType<typeof electron.BrowserWindow>
    expect(win.options).toMatchObject({ frame: false, alwaysOnTop: true, show: false, title: OWN_TITLES[0] })
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(win.setContentProtection).toHaveBeenCalledWith(true)
    win.emit('ready-to-show')
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(win.navigate('conduit-ask://allow')).toBe(true)
    await expect(shown).resolves.toBe('allowed')
    expect(win.isDestroyed()).toBe(true)
  })

  it('Don’t Allow and closing the window are a no; the phone’s answer is closed', async () => {
    const deny = askPc(request('s2'))
    windows[0].navigate('conduit-ask://deny')
    await expect(deny).resolves.toBe('denied')

    const closed = askPc(request('s3'))
    ;(windows[1] as unknown as { destroy: () => void }).destroy()
    await expect(closed).resolves.toBe('denied')

    const phone = askPc(request('s4'))
    closePcAsk('s4')
    await expect(phone).resolves.toBe('closed')
    expect(windows[2].destroyed).toBe(true)
  })

  it('asks once per chat while its window is up', async () => {
    const first = askPc(request('s5'))
    const again = askPc(request('s5'))
    expect(windows).toHaveLength(1)
    windows[0].navigate('conduit-ask://allow')
    await expect(Promise.all([first, again])).resolves.toEqual(['allowed', 'allowed'])
  })

  it('a link that isn’t the ask’s goes nowhere and answers nothing', async () => {
    const shown = askPc(request('s6'))
    expect(windows[0].navigate('https://example.com')).toBe(true)
    expect(windows[0].destroyed).toBe(false)
    windows[0].navigate('conduit-ask://deny')
    await expect(shown).resolves.toBe('denied')
  })
})

describe('askPage', () => {
  it('names the bot and chat, escaped, with the takeover and Stop’s keys', () => {
    const page = askPage(request('s7', { takes_over: 'Other chat' }))
    expect(page).toContain('Furina')
    expect(page).toContain('Tidy &lt;my&gt; downloads')
    expect(page).toContain('Other chat')
    expect(page).toContain('conduit-ask://allow')
    expect(page).toContain('conduit-ask://deny')
    expect(page).not.toContain('<my>')
  })
})
