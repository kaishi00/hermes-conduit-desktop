/**
 * A bot's screen in a window of its own (Eric, 2026-11-21): the main
 * window's chat stays in view while the screen is watched or driven. It
 * loads the app's page with the bot in its hash, over the same gateway.
 */
import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import type { ScreenWindowRequest } from '../shared/ipc'
import { screenWindowHash } from '../shared/screenWindows'
import { confineNavigation } from './navigation'
import { keepWindowPlace, openingPlace } from './windowPlaces'

export function createScreenWindow(screen: ScreenWindowRequest, onClosed: () => void): BrowserWindow {
  // Where this kind of window was last, beside any already open.
  const place = openingPlace('screen', { width: 1040, height: 720 }, { width: 480, height: 360 })
  const window = new BrowserWindow({
    ...place.bounds,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: screen.botName,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f5f5f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  keepWindowPlace(window, 'screen', place.maximized)
  window.on('ready-to-show', () => (place.maximized ? window.maximize() : window.show()))
  window.on('closed', onClosed)
  confineNavigation(window.webContents)
  const hash = screenWindowHash(screen).slice(1)
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  return window
}
