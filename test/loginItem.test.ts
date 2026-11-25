import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    getLoginItemSettings: vi.fn((_options?: unknown) => ({ openAtLogin: false }) as Record<string, unknown>),
    setLoginItemSettings: vi.fn()
  },
  shell: { openExternal: vi.fn(async () => undefined) }
}))
vi.mock('electron', () => electron)

import { HIDDEN_ARG, launchedAtLogin, loginItemKind, loginItemState, openStartupSettings, setLoginItem, startedAtLogin } from '../src/main/loginItem'

function onPlatform(platform: NodeJS.Platform, windowsStore = false) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  Object.defineProperty(process, 'windowsStore', { value: windowsStore || undefined, configurable: true })
}
const realPlatform = process.platform
const realArgv = process.argv

beforeEach(() => {
  onPlatform(realPlatform)
  process.argv = realArgv
  electron.app.isPackaged = true
  electron.app.getLoginItemSettings.mockReset().mockReturnValue({ openAtLogin: false })
  electron.app.setLoginItemSettings.mockReset()
  electron.shell.openExternal.mockClear()
})

describe('how a copy opens at sign-in', () => {
  it('is its own switch for the Windows installer and the Mac, Windows’ for the Store’s copy, none elsewhere', () => {
    expect(loginItemKind({ platform: 'win32', packaged: true, windowsStore: false })).toBe('switch')
    expect(loginItemKind({ platform: 'darwin', packaged: true, windowsStore: false })).toBe('switch')
    expect(loginItemKind({ platform: 'win32', packaged: true, windowsStore: true })).toBe('system')
    expect(loginItemKind({ platform: 'linux', packaged: true, windowsStore: false })).toBe('none')
    for (const platform of ['win32', 'darwin', 'linux'] as const) expect(loginItemKind({ platform, packaged: false, windowsStore: false })).toBe('none')
  })

  it('knows the sign-in’s start by the Windows entry’s argument, and from the Mac itself', () => {
    expect(startedAtLogin(['Conduit.exe', HIDDEN_ARG], 'win32', () => false)).toBe(true)
    expect(startedAtLogin(['Conduit.exe'], 'win32', () => true)).toBe(false)
    expect(startedAtLogin([], 'darwin', () => true)).toBe(true)
    expect(startedAtLogin([HIDDEN_ARG], 'darwin', () => false)).toBe(false)
    expect(
      startedAtLogin([], 'darwin', () => {
        throw new Error('no')
      })
    ).toBe(false)
    expect(startedAtLogin([HIDDEN_ARG], 'linux', () => true)).toBe(false)
  })
})

describe('the switch on Windows', () => {
  beforeEach(() => onPlatform('win32'))

  it('reads the entry with its argument, and is off when Task Manager turned it off', () => {
    electron.app.getLoginItemSettings.mockReturnValue({ openAtLogin: true, executableWillLaunchAtLogin: true })
    expect(loginItemState()).toEqual({ kind: 'switch', on: true })
    expect(electron.app.getLoginItemSettings).toHaveBeenLastCalledWith({ args: [HIDDEN_ARG] })
    electron.app.getLoginItemSettings.mockReturnValue({ openAtLogin: true, executableWillLaunchAtLogin: false })
    expect(loginItemState()).toEqual({ kind: 'switch', on: false })
  })

  it('writes the entry with the argument and its approval, and answers what the system then says', () => {
    electron.app.getLoginItemSettings.mockReturnValue({ openAtLogin: true, executableWillLaunchAtLogin: true })
    expect(setLoginItem(true)).toEqual({ kind: 'switch', on: true })
    expect(electron.app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true, args: [HIDDEN_ARG], enabled: true })
    electron.app.getLoginItemSettings.mockReturnValue({ openAtLogin: false })
    expect(setLoginItem(false)).toEqual({ kind: 'switch', on: false })
    expect(electron.app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false, args: [HIDDEN_ARG], enabled: false })
  })

  it('says off when the system refuses the read or the write', () => {
    electron.app.setLoginItemSettings.mockImplementation(() => {
      throw new Error('refused')
    })
    electron.app.getLoginItemSettings.mockImplementation(() => {
      throw new Error('refused')
    })
    expect(setLoginItem(true)).toEqual({ kind: 'switch', on: false })
  })

  it('starts in the tray only for the entry’s own launch of an installed copy', () => {
    process.argv = ['Conduit.exe', HIDDEN_ARG]
    expect(launchedAtLogin()).toBe(true)
    electron.app.isPackaged = false
    expect(launchedAtLogin()).toBe(false)
    electron.app.isPackaged = true
    process.argv = ['Conduit.exe']
    expect(launchedAtLogin()).toBe(false)
  })
})

describe('the other copies', () => {
  it('the Mac’s switch is its Login Item, with no argument', () => {
    onPlatform('darwin')
    electron.app.getLoginItemSettings.mockReturnValue({ openAtLogin: true, wasOpenedAtLogin: true })
    expect(setLoginItem(true)).toEqual({ kind: 'switch', on: true })
    expect(electron.app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true })
    expect(launchedAtLogin()).toBe(true)
  })

  it('the Store’s copy writes nothing and opens Windows’ Startup apps', () => {
    onPlatform('win32', true)
    expect(setLoginItem(true)).toEqual({ kind: 'system', on: false })
    expect(electron.app.setLoginItemSettings).not.toHaveBeenCalled()
    openStartupSettings()
    expect(electron.shell.openExternal).toHaveBeenCalledWith('ms-settings:startupapps')
  })

  it('a Startup apps page that won’t open is left at that', async () => {
    onPlatform('win32', true)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    electron.shell.openExternal.mockRejectedValueOnce(new Error('no handler'))
    openStartupSettings()
    await new Promise(resolve => setTimeout(resolve, 0))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('a run from source and Linux register nothing', () => {
    onPlatform('linux')
    expect(setLoginItem(true)).toEqual({ kind: 'none', on: false })
    onPlatform('win32')
    electron.app.isPackaged = false
    expect(setLoginItem(true)).toEqual({ kind: 'none', on: false })
    expect(electron.app.setLoginItemSettings).not.toHaveBeenCalled()
    onPlatform('linux')
    openStartupSettings()
    expect(electron.shell.openExternal).not.toHaveBeenCalled()
  })
})
