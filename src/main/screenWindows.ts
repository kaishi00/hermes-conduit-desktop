/**
 * A bot's screen in a window of its own (Eric, 2026-11-21): the main
 * window's chat stays in view while the screen is watched or driven. It
 * loads the app's page with the bot in its hash, over the same gateway.
 */
import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import type { ScreenWindowRequest } from '../shared/ipc'
import { screenWindowHash } from '../shared/screenWindows'

export function createScreenWindow(screen: ScreenWindowRequest, onClosed: () => void): BrowserWindow {
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
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
  window.on('ready-to-show', () => window.show())
  window.on('closed', onClosed)
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:\/\/|mailto:|tel:|sms:)/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    }
  })
  const hash = screenWindowHash(screen).slice(1)
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  return window
}
