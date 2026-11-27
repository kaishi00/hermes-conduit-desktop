/**
 * A chat in a window of its own: the whole chat for its own bot, with Open
 * in Main Window. It loads the app's page with the chat in its hash, so it
 * opens the chat over its own gateway calls and stays live. A call window
 * (the Live call shortcut's) is the same page, smaller and on top, starting
 * a call as it opens. The page sets
 * the window's title as the chat's and the bot's names change.
 */
import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import type { ChatWindowRequest } from '../shared/ipc'
import { chatWindowTitle } from '../shared/chatWindows'
import { confineNavigation } from './navigation'
import { keepWindowPlace, openingPlace } from './windowPlaces'

export function createChatWindow(chat: ChatWindowRequest, onClosed: () => void): BrowserWindow {
  // Where this kind of window was last, beside any already open. The Live call shortcut's window is small,
  // and stays over other apps so the call can be watched while working in them.
  const call = chat.call === true
  const kind = call ? 'call' : 'chat'
  const place = call
    ? openingPlace('call', { width: 460, height: 600 }, { width: 340, height: 360 })
    : openingPlace('chat', { width: 640, height: 780 }, { width: 360, height: 400 })
  const window = new BrowserWindow({
    ...place.bounds,
    minWidth: call ? 340 : 360,
    minHeight: call ? 360 : 400,
    ...(call ? { alwaysOnTop: true } : {}),
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
  keepWindowPlace(window, kind, place)
  window.on('ready-to-show', () => {
    if (place.maximized) window.maximize()
    else window.show()
    // Pressed from another app, the call window comes to the front with its keys, not behind the app in use.
    if (call) window.focus()
  })
  window.on('closed', onClosed)
  confineNavigation(window.webContents)
  const hash = `chat=${encodeURIComponent(JSON.stringify(chat))}`
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  return window
}
