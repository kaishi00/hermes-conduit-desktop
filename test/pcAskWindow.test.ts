import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => void

const windows = vi.hoisted(() => [] as FakeWindow[])
interface FakeWindow {
  options: Record<string, unknown>
  url: string
  destroyed: boolean
  handlers: Record<string, Handler[]>
  navigate: (url: string) => boolean
  key: (key: string) => boolean
  emit: (name: string) => void
}

const electron = vi.hoisted(() => {
  class BrowserWindow {
    options: Record<string, unknown>
    url = ''
    destroyed = false
    handlers: Record<string, Handler[]> = {}
    navHandlers: Handler[] = []
    inputHandlers: Handler[] = []
    webContents = {
      on: (name: string, handler: Handler) => (name === 'before-input-event' ? this.inputHandlers : this.navHandlers).push(handler)
    }
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
    key(key: string) {
      let prevented = false
      for (const handler of this.inputHandlers) handler({ preventDefault: () => (prevented = true) }, { type: 'keyDown', key })
      return prevented
    }
    navigate(url: string) {
      let prevented = false
      for (const handler of this.navHandlers) handler({ preventDefault: () => (prevented = true) }, url)
      return prevented
    }
    setAlwaysOnTop = vi.fn()
    setContentProtection = vi.fn()
    show = vi.fn()
    showInactive = vi.fn()
    hide = vi.fn()
    close = vi.fn()
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
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getCursorScreenPoint: () => ({ x: 2500, y: 300 }),
      getDisplayNearestPoint: (point: { x: number }) => ({ workArea: point.x > 1920 ? { x: 1920, y: 0, width: 2560, height: 1440 } : { x: 0, y: 0, width: 1920, height: 1080 } })
    }
  }
})
vi.mock('electron', () => electron)
const drive = vi.hoisted(() => ({ path: null as string | null, runs: [] as { action: string; done: () => void }[] }))
vi.mock('../src/main/pcDriver', () => ({
  artifactFor: () => null,
  deleteDriver: vi.fn(),
  driver: vi.fn(async () => ({})),
  driverPath: () => drive.path,
  installDriver: vi.fn(),
  stopDriver: vi.fn()
}))
vi.mock('../src/main/pcExecutor', () => ({
  OWN_TITLES: ['Conduit control'],
  Executor: class {
    run(_session: string, step: { action: string }) {
      return new Promise(resolve => drive.runs.push({ action: step.action, done: () => resolve({ ok: true }) }))
    }
    forget() {}
  }
}))
vi.mock('../src/main/settings', () => ({
  choosePcControl: vi.fn(() => true),
  pcControlSettings: () => ({ on: true, name: '', bots: ['https://a.example\ndefault'], id: 'computer-1' })
}))

import { askPage, askPc, barPage, closePcAsk, pcControlState, runPcRequest, setPcControl, stopControl } from '../src/main/pcControl'
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
  host: 'https://a.example',
  hostName: 'Home',
  ...extra
})

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  windows.length = 0
  drive.path = null
  drive.runs.length = 0
})

describe('askPc', () => {
  it('shows Conduit’s own window on top, out of screenshots and out of the bot’s reach', async () => {
    const shown = askPc(request('s1'))
    await tick()
    const win = windows[0] as unknown as InstanceType<typeof electron.BrowserWindow>
    expect(win.options).toMatchObject({ frame: false, alwaysOnTop: true, show: false, title: 'Conduit control' })
    // Centered on the screen under the cursor.
    expect(win.options.x).toBe(1920 + (2560 - 440) / 2)
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
    await tick()
    windows[0].navigate('conduit-ask://deny')
    await expect(deny).resolves.toBe('denied')

    const closed = askPc(request('s3'))

    await tick()
    ;(windows[1] as unknown as { destroy: () => void }).destroy()
    await expect(closed).resolves.toBe('denied')

    const esc = askPc(request('s8'))

    await tick()
    expect(windows[2].key('a')).toBe(false)
    expect(windows[2].key('Escape')).toBe(true)
    await expect(esc).resolves.toBe('denied')

    const phone = askPc(request('s4'))

    await tick()
    closePcAsk('s4')
    await expect(phone).resolves.toBe('closed')
    expect(windows[3].destroyed).toBe(true)
  })

  it('asks once per chat while its window is up', async () => {
    const first = askPc(request('s5'))
    await tick()
    const again = askPc(request('s5'))
    expect(windows).toHaveLength(1)
    windows[0].navigate('conduit-ask://allow')
    await expect(Promise.all([first, again])).resolves.toEqual(['allowed', 'allowed'])
  })

  it('a link that isn’t the ask’s goes nowhere and answers nothing', async () => {
    const shown = askPc(request('s6'))
    await tick()
    expect(windows[0].navigate('https://example.com')).toBe(true)
    expect(windows[0].destroyed).toBe(false)
    windows[0].navigate('conduit-ask://deny')
    await expect(shown).resolves.toBe('denied')
  })
})

describe('more than one ask', () => {
  it('asks again once a chat’s ask was answered', async () => {
    const first = askPc(request('s9'))
    await tick()
    windows[0].navigate('conduit-ask://deny')
    await expect(first).resolves.toBe('denied')
    const again = askPc(request('s9'))
    await tick()
    expect(windows).toHaveLength(2)
    windows[1].navigate('conduit-ask://allow')
    await expect(again).resolves.toBe('allowed')
  })

  it('cascades asks open at once, so none hides another', async () => {
    const a = askPc(request('s10'))
    await tick()
    const b = askPc(request('s11'))
    await tick()
    expect((windows[1].options.x as number) - (windows[0].options.x as number)).toBe(24)
    expect((windows[1].options.y as number) - (windows[0].options.y as number)).toBe(24)
    windows[0].navigate('conduit-ask://deny')
    windows[1].navigate('conduit-ask://deny')
    await Promise.all([a, b])
  })

  it('a new ask takes the lowest free step, not one an open ask holds', async () => {
    const a = askPc(request('s14'))
    await tick()
    const b = askPc(request('s15'))
    await tick()
    windows[0].navigate('conduit-ask://deny')
    await a
    const c = askPc(request('s16'))
    await tick()
    expect(windows[2].options.x).toBe(windows[0].options.x)
    windows[1].navigate('conduit-ask://deny')
    windows[2].navigate('conduit-ask://deny')
    await Promise.all([b, c])
  })

  it('Stop and turning it off take open asks away, and so does taking the bot off the list', async () => {
    const a = askPc(request('s17'))
    await tick()
    stopControl(false)
    await expect(a).resolves.toBe('closed')
    const b = askPc(request('s18', { profile: 'zhongli' }))
    const c = askPc(request('s19'))
    await tick()
    setPcControl({ bots: ['https://a.example\ndefault'] })
    await expect(b).resolves.toBe('closed')
    expect(windows[2].destroyed).toBe(false)
    windows[2].navigate('conduit-ask://deny')
    await c
  })

  it('an action that waited through Stop doesn’t run after it', async () => {
    drive.path = '/driver'
    const ask = askPc(request('s20'))
    await tick()
    const run = runPcRequest(request('s21', { needs_ok: false }))
    await tick()
    stopControl(false)
    await expect(ask).resolves.toBe('closed')
    await expect(run).resolves.toEqual({ ok: false, code: 'stopped' })
    expect(drive.runs).toHaveLength(0)
  })

  it('the rest of a batch fetched before Stop doesn’t run after it', async () => {
    drive.path = '/driver'
    const { pcControlState } = await import('../src/main/pcControl')
    const gen = pcControlState().stops
    stopControl(false)
    await expect(runPcRequest(request('s24', { needs_ok: false, gen }))).resolves.toEqual({ ok: false, code: 'stopped' })
    // Fetched after it: runs.
    const run = runPcRequest(request('s25', { needs_ok: false, gen: pcControlState().stops }))
    await tick()
    expect(drive.runs).toHaveLength(1)
    drive.runs[0].done()
    await expect(run).resolves.toMatchObject({ ok: true })
  })

  it('an ask waits for a running action before it shows', async () => {
    drive.path = '/driver'
    const run = runPcRequest(request('s22', { needs_ok: false }))
    await tick()
    expect(drive.runs).toHaveLength(1)
    // The control bar is a window too; the ask is the one the ask's size.
    const asks = () => windows.filter(w => w.options.width === 440)
    const ask = askPc(request('s23'))
    await tick()
    expect(asks()).toHaveLength(0)
    drive.runs[0].done()
    await expect(run).resolves.toMatchObject({ ok: true })
    await tick()
    expect(asks()).toHaveLength(1)
    asks()[0].navigate('conduit-ask://deny')
    await ask
  })

  it('runs no action while an ask is up, since a click could land on Allow', async () => {
    const ask = askPc(request('s12'))
    await tick()
    let ran = false
    const run = runPcRequest(request('s13', { needs_ok: false })).then(result => {
      ran = true
      return result
    })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(ran).toBe(false)
    windows[0].navigate('conduit-ask://deny')
    await ask
    await expect(run).resolves.toMatchObject({ ok: false, code: 'unavailable' })
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
    // Don't Allow has the focus, so Enter is a no.
    expect(page).toMatch(/href="conduit-ask:\/\/deny" autofocus/)
  })

  // Desktop issue 729: two dashboards' same-named bots ask with different pages.
  it('names the dashboard asking, so a same-named bot elsewhere reads differently', () => {
    const home = askPage(request('s8'))
    const office = askPage(request('s8', { host: 'https://b.example', hostName: 'Office <2>' }))
    expect(home).toContain('Hermes: Home')
    expect(office).toContain('Hermes: Office &lt;2&gt;')
    expect(home).not.toEqual(office)
  })
})

describe('askPc after Stop', () => {
  it('shows no card for an action fetched before the latest Stop (desktop issue 735)', async () => {
    const gen = pcControlState().stops
    stopControl(false)
    await expect(askPc(request('s31', { gen }))).resolves.toBe('closed')
    expect(windows).toHaveLength(0)
  })
})

describe('barPage', () => {
  it('names the bot’s dashboard beside its chat', () => {
    const page = barPage('Furina', 'Office', 'Tidy <up>', false)
    expect(page).toContain('Office · Tidy &lt;up&gt;')
    expect(page).not.toContain('<up>')
  })
})

describe('the allow list, per dashboard', () => {
  it('takes no tick without a bot’s name (desktop#740 review)', async () => {
    const settings = await import('../src/main/settings')
    const choose = vi.mocked(settings.choosePcControl)
    choose.mockClear()
    setPcControl({ bot: { name: '', host: 'https://a.example', on: true } } as never)
    expect(choose.mock.calls.at(-1)?.[0]).not.toHaveProperty('bots')
  })

  it('runs nothing for a same-named bot on a dashboard it wasn’t ticked on', async () => {
    drive.path = '/driver'
    await expect(runPcRequest(request('s30', { needs_ok: false, host: 'https://b.example' }))).resolves.toEqual({ ok: false, code: 'off' })
    expect(drive.runs).toHaveLength(0)
  })
})
