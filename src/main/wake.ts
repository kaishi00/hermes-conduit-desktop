/**
 * The wake phrase on this computer (Wake phrase, #174): Vosk listens in a
 * hidden window, offline, with the model downloaded for the language the
 * person picked. The main window says which phrases to listen for, or null
 * to stop; the listener reports which one it heard. Nothing is recorded or
 * kept, and the window (with the microphone) closes whenever it stops.
 */
import { app, BrowserWindow, ipcMain, net, type WebContents } from 'electron'
import { join } from 'node:path'
import { IPC, type WakeListenerState, type WakeModelChoice, type WakeModelsState } from '../shared/ipc'
import { WakeModels } from './wakeModels'

type Report = { kind: 'heard'; index: number } | { kind: 'listening' } | { kind: 'failed'; error: string }

export function registerWake(mainWindow: () => BrowserWindow | null): { isListener: (window: BrowserWindow) => boolean } {
  const models = new WakeModels(join(app.getPath('userData'), 'wake-model'), url => net.fetch(url, { cache: 'no-store' }))
  let choices: WakeModelChoice[] | null = null
  let downloading: WakeModelsState['downloading'] = null
  let error: string | undefined
  let abort: AbortController | null = null
  let listener: BrowserWindow | null = null
  let phrases: string[] | null = null
  let heardState: WakeListenerState = { state: 'off' }

  const send = (channel: string, value: unknown) => {
    const window = mainWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, value)
  }
  const state = async (): Promise<WakeModelsState> => ({ choices, installed: await models.installed(), downloading, error, listener: heardState })
  const changed = async () => send(IPC.wakeModelsChanged, await state())
  const listenerState = (value: WakeListenerState) => {
    heardState = value
    send(IPC.wakeListener, value)
  }

  ipcMain.handle(IPC.wakeModels, async () => {
    if (!choices) {
      try {
        choices = await models.catalog()
        error = undefined
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
    }
    return state()
  })

  ipcMain.handle(IPC.wakeDownload, async (_event, lang: unknown) => {
    const choice = choices?.find(c => c.lang === lang)
    if (!choice || downloading) return
    abort = new AbortController()
    downloading = { lang: choice.lang, received: 0, total: choice.bytes }
    error = undefined
    stopListener()
    void changed()
    let last = 0
    try {
      await models.download(
        choice,
        (received, total) => {
          downloading = { lang: choice.lang, received, total }
          if (Date.now() - last > 250) {
            last = Date.now()
            void changed()
          }
        },
        abort.signal
      )
    } catch (e) {
      error = abort.signal.aborted ? undefined : e instanceof Error ? e.message : String(e)
    } finally {
      downloading = null
      abort = null
      await changed()
      if (phrases) startListener()
    }
  })

  ipcMain.on(IPC.wakeCancel, () => abort?.abort())

  ipcMain.handle(IPC.wakeRemove, async () => {
    stopListener()
    await models.remove()
    await changed()
  })

  ipcMain.on(IPC.wakeListen, (_event, value: unknown) => {
    const next = Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : null
    phrases = next?.length ? next : null
    if (!phrases) return stopListener()
    if (listener && !listener.isDestroyed()) listener.webContents.send(IPC.wakePhrases, phrases)
    else startListener()
  })

  const fromListener = (sender: WebContents) => !!listener && !listener.isDestroyed() && sender === listener.webContents

  ipcMain.handle(IPC.wakeModelBytes, async event => {
    if (!fromListener(event.sender)) throw new Error('not the listener')
    const bytes = await models.read()
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  })

  ipcMain.on(IPC.wakeReport, (event, report: Report) => {
    if (!fromListener(event.sender)) return
    if (report.kind === 'heard' && Number.isInteger(report.index)) send(IPC.wakeHeard, report.index)
    else if (report.kind === 'listening') listenerState({ state: 'listening' })
    else if (report.kind === 'failed') {
      listenerState({ state: 'failed', error: String(report.error) })
      stopListener(false)
    }
  })

  async function startListener() {
    if (listener || !phrases || downloading) return
    if (!(await models.installed())) return listenerState({ state: 'off' })
    if (listener || !phrases) return
    const window = new BrowserWindow({
      show: false,
      width: 200,
      height: 200,
      webPreferences: {
        preload: join(__dirname, '../preload/wake.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    listener = window
    listenerState({ state: 'starting' })
    window.on('closed', () => {
      if (listener === window) listener = null
    })
    window.webContents.on('render-process-gone', () => {
      if (listener !== window) return
      listenerState({ state: 'failed', error: 'The listener stopped.' })
      stopListener(false)
    })
    window.webContents.once('did-finish-load', () => {
      if (phrases && !window.isDestroyed()) window.webContents.send(IPC.wakePhrases, phrases)
    })
    if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/wake.html`)
    else void window.loadFile(join(__dirname, '../renderer/wake.html'))
  }

  function stopListener(announce = true) {
    const window = listener
    listener = null
    if (window && !window.isDestroyed()) window.destroy()
    if (announce) listenerState({ state: 'off' })
  }

  app.on('before-quit', () => stopListener(false))
  return { isListener: window => window === listener }
}
