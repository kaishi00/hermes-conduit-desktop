/**
 * A chat in a window of its own: the whole chat for its own bot, with Open
 * in Main Window. It loads the app's page with the chat in its hash, so it
 * opens the chat over its own gateway calls and stays live. The page sets
 * the window's title as the chat's and the bot's names change.
 */
import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import type { ChatWindowRequest } from '../shared/ipc'
import { chatWindowTitle } from '../shared/chatWindows'

export function createChatWindow(chat: ChatWindowRequest, onClosed: () => void): BrowserWindow {
  const window = new BrowserWindow({
    width: 640,
    height: 780,
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
  const hash = `chat=${encodeURIComponent(JSON.stringify(chat))}`
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  return window
}
