/**
 * A chat in a window of its own: the whole chat for its own bot, with Open
 * in Main Window. It loads the app's page with the chat in its hash, so it
 * opens the chat over its own gateway calls and stays live. The page sets
 * the window's title as the chat's and the bot's names change, and its pin
 * keeps the window on top (issue 608).
 */
import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import type { ChatWindowRequest } from '../shared/ipc'
import { chatWindowTitle, onTopKey } from '../shared/chatWindows'
import { keptOnTop } from './chatWindowsOnTop'
import { confineNavigation } from './navigation'
import { keepWindowPlace, openingPlace } from './windowPlaces'

export function createChatWindow(chat: ChatWindowRequest, onClosed: () => void): BrowserWindow {
  // Where this kind of window was last, beside any already open.
  const place = openingPlace('chat', { width: 640, height: 780 }, { width: 360, height: 400 })
  const window = new BrowserWindow({
    ...place.bounds,
    minWidth: 360,
    minHeight: 400,
    show: false,
    title: chatWindowTitle(chat.title ?? '', chat.botChat ? undefined : chat.author),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f5f5f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  keepWindowPlace(window, 'chat', place)
  // A chat whose window was kept on top opens kept on top again (issue 608).
  if (keptOnTop(onTopKey(chat))) window.setAlwaysOnTop(true)
  window.on('ready-to-show', () => (place.maximized ? window.maximize() : window.show()))
  window.on('closed', onClosed)
  confineNavigation(window.webContents)
  const hash = `chat=${encodeURIComponent(JSON.stringify(chat))}`
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  return window
}
