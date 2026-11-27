/**
 * Control from Hermes: a bot, wherever its Hermes runs, drives this computer
 * through the plugin's conduit_user_computer tool. The renderer asks each
 * allowed bot's plugin for work (state/pcControl.ts) and hands each action
 * here, after asking the user when the plugin says the chat isn't allowed
 * yet (askPc; the renderer also follows the same ask on the phone and closes
 * this one when the phone answers first), runs it with the driver
 * (pcExecutor.ts) and shows the control bar.
 *
 * The user stays in charge (Eric 2026-11-27): off until turned on, only the
 * bots picked in Settings, one ask per chat, and while a bot drives, a bar
 * on top of every window says who, with Stop and a hotkey. The bar is kept
 * out of screenshots, so the bot never sees it or clicks it.
 */
import { BrowserWindow, dialog, globalShortcut, screen } from 'electron'
import { hostname } from 'node:os'
import { randomBytes } from 'node:crypto'
import { t } from '../shared/i18n'
import type { PcControlSettings, PcControlState, PcRequest } from '../shared/ipc'
import { artifactFor, deleteDriver, driver, driverPath, installDriver, stopDriver } from './pcDriver'
import { Executor, OWN_TITLES } from './pcExecutor'
import { choosePcControl, pcControlSettings } from './settings'

export const STOP_KEYS = 'CommandOrControl+Alt+Shift+S'
/** The bar stays this long after the last action. */
const BAR_FOR_MS = 60_000
const STOP_URL = 'conduit-stop://stop'

type Notify = (state: PcControlState) => void

let notify: Notify = () => undefined
let onStopped: () => void = () => undefined
let downloading: { progress: number } | null = null
let failed = false
let active: { bot: string; chat: string } | null = null
let executor: Executor | null = null
let bar: BrowserWindow | null = null
let barTimer: ReturnType<typeof setTimeout> | null = null
/** Whether the bar holds the Stop keys, so hiding it never drops another shortcut's. */
let ownKeys = false
/** Asks already on screen, by chat, so a burst of actions asks once, and how to take each away. */
const asking = new Map<string, { shown: Promise<'allowed' | 'denied' | 'closed'>; close: AbortController }>()

const platform = (): PcControlState['platform'] => (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux')

export function pcControlState(): PcControlState {
  let settings = pcControlSettings()
  if (!settings.id) {
    choosePcControl({ id: randomBytes(12).toString('base64url') })
    settings = pcControlSettings()
  }
  const driverState: PcControlState['driver'] = !artifactFor()
    ? 'unsupported'
    : downloading
      ? 'downloading'
      : driverPath()
        ? 'ready'
        : failed
          ? 'failed'
          : 'missing'
  return {
    ...settings,
    shownName: settings.name.trim() || hostname(),
    platform: platform(),
    driver: driverState,
    progress: downloading?.progress ?? 0,
    active,
    stopKeys: STOP_KEYS
  }
}

const changed = () => notify(pcControlState())

export function initPcControl(listeners: { notify: Notify; stopped: () => void }) {
  notify = listeners.notify
  onStopped = listeners.stopped
}

export function setPcControl(change: Partial<PcControlSettings> & { bot?: unknown }): PcControlState {
  const clean: Partial<PcControlSettings> = {}
  const bot = change.bot as { name?: unknown; on?: unknown } | undefined
  if (bot && typeof bot.name === 'string' && typeof bot.on === 'boolean') {
    const now = pcControlSettings().bots
    clean.bots = (bot.on ? [...new Set([...now, bot.name])] : now.filter(name => name !== bot.name)).slice(0, 64)
  }
  if (typeof change.on === 'boolean') clean.on = change.on
  if (typeof change.name === 'string') clean.name = change.name.slice(0, 64)
  if (Array.isArray(change.bots)) clean.bots = change.bots.filter(b => typeof b === 'string').slice(0, 64)
  choosePcControl(clean)
  if (clean.on === false) stopControl(false)
  if (clean.on === true && !driverPath()) void installPcDriver()
  changed()
  return pcControlState()
}

/** At launch: a download cut short by quitting picks up again, so an on toggle never sits without a driver. */
export function resumePcDriverInstall() {
  if (pcControlSettings().on && artifactFor() && !driverPath()) void installPcDriver()
}

export async function installPcDriver(): Promise<PcControlState> {
  if (!artifactFor() || driverPath()) return pcControlState()
  downloading = { progress: 0 }
  failed = false
  changed()
  try {
    await installDriver(progress => {
      if (downloading) downloading.progress = progress
      changed()
    })
  } catch {
    failed = true
  }
  downloading = null
  changed()
  return pcControlState()
}

export function deletePcDriver(): PcControlState {
  executor = null
  deleteDriver()
  downloading = null
  failed = false
  changed()
  return pcControlState()
}

/** Asks the user whether this chat may drive the computer: Allow or Don't Allow; 'closed' once closePcAsk took it away. */
export function askPc(request: PcRequest): Promise<'allowed' | 'denied' | 'closed'> {
  const key = request?.session
  if (typeof key !== 'string' || !key) return Promise.resolve('denied')
  const open = asking.get(key)
  if (open) return open.shown
  const detail = [
    request.chat ? t('Chat: {chat}', { chat: request.chat }) : '',
    request.takes_over ? t('This takes over from “{chat}”.', { chat: request.takes_over }) : '',
    t('It can see your screen, click and type until you press Stop ({keys}).', { keys: stopLabel() })
  ]
    .filter(Boolean)
    .join('\n\n')
  const close = new AbortController()
  const shown = dialog
    .showMessageBox({
      type: 'question',
      title: t('Control from Hermes'),
      message: t('Allow {bot} to control this computer?', { bot: request.bot }),
      detail,
      buttons: [t('Allow'), t('Don’t Allow')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      signal: close.signal
    })
    .then(answer => (close.signal.aborted ? 'closed' : answer.response === 0 ? 'allowed' : 'denied') as 'allowed' | 'denied' | 'closed')
    .catch(() => (close.signal.aborted ? 'closed' : 'denied') as 'closed' | 'denied')
    .finally(() => asking.delete(key))
  asking.set(key, { shown, close })
  return shown
}

/** The phone answered a chat's ask first: its dialog goes. */
export function closePcAsk(session: string) {
  asking.get(session)?.close.abort()
}

const stopLabel = () => (process.platform === 'darwin' ? '⌘⌥⇧S' : 'Ctrl+Alt+Shift+S')

/** Runs one action the plugin handed over. The renderer asked first (askPc, and the phone) when it needed asking. */
export async function runPcRequest(request: PcRequest): Promise<Record<string, unknown>> {
  const settings = pcControlSettings()
  if (!settings.on || !settings.bots.includes(request.profile)) return { ok: false, code: 'off' }
  if (!driverPath()) return { ok: false, code: 'unavailable', message: 'The driver isn’t downloaded on this computer yet.' }
  const grant: 'allowed' | undefined = request.needs_ok ? 'allowed' : undefined
  showBar(request.bot, request.chat)
  try {
    executor ??= new Executor(await driver())
    const result = await executor.run(request.session, { action: request.action, args: request.args ?? {} })
    return { ...result, ...(grant ? { grant } : {}) }
  } catch (error) {
    // A driver that died starts again at the next action.
    executor = null
    stopDriver()
    return { ok: false, ...(grant ? { grant } : {}), code: 'driver', message: `The driver failed: ${(error as Error).message}` }
  } finally {
    holdBar()
  }
}

/** Stop: the bar goes, and each allowed bot's plugin hears it (the renderer posts /pc/stop). */
export function stopControl(tell = true) {
  active = null
  executor?.forget()
  hideBar()
  // Turned off: the driver process goes too, and starts again when it's next needed.
  if (!pcControlSettings().on) {
    executor = null
    stopDriver()
  }
  if (tell) onStopped()
  changed()
}

function barPage(botName: string, chat: string, hotkey: boolean): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const line = esc(t('{bot} is controlling this computer', { bot: botName }))
  return `<!doctype html><meta charset="utf-8"><title>${OWN_TITLES[0]}</title><style>
html,body{margin:0;height:100%;background:transparent;font:13px system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none}
div{display:flex;align-items:center;gap:10px;height:100%;box-sizing:border-box;padding:0 6px 0 14px;border-radius:12px;background:#b3261e;color:#fff}
span{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}small{opacity:.8}
a{color:#b3261e;background:#fff;border-radius:8px;padding:5px 12px;font-weight:600;text-decoration:none}
</style><div><span>${line}${chat ? ` <small>· ${esc(chat)}</small>` : ''}</span><a href="${STOP_URL}">${esc(t('Stop'))}${hotkey ? ` <small>${esc(stopLabel())}</small>` : ''}</a></div>`
}

function showBar(botName: string, chat: string) {
  active = { bot: botName, chat }
  if (barTimer) clearTimeout(barTimer)
  barTimer = null
  if (!bar || bar.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea
    const width = Math.min(560, area.width - 40)
    bar = new BrowserWindow({
      width,
      height: 40,
      x: Math.round(area.x + (area.width - width) / 2),
      y: area.y + 8,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      show: false,
      title: OWN_TITLES[0],
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
    })
    bar.setAlwaysOnTop(true, 'screen-saver')
    // Out of every screenshot, the bot's included.
    bar.setContentProtection(true)
    bar.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      if (url.startsWith(STOP_URL)) stopControl()
    })
    bar.on('closed', () => (bar = null))
  }
  // Tried at every action, since another app may hold the keys for a while; the bar
  // shows them only while they're ours.
  // Only keys the bar registered itself: the same keys set for Quick Ask or a call stay theirs.
  if (!ownKeys && !globalShortcut.isRegistered(STOP_KEYS)) ownKeys = globalShortcut.register(STOP_KEYS, () => stopControl())
  const hotkey = ownKeys
  void bar.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(barPage(botName, chat, hotkey))).catch(() => undefined)
  bar.showInactive()
  changed()
}

function holdBar() {
  if (barTimer) clearTimeout(barTimer)
  barTimer = setTimeout(() => {
    active = null
    hideBar()
    changed()
  }, BAR_FOR_MS)
}

function hideBar() {
  if (barTimer) clearTimeout(barTimer)
  barTimer = null
  if (ownKeys) globalShortcut.unregister(STOP_KEYS)
  ownKeys = false
  if (bar && !bar.isDestroyed()) bar.destroy()
  bar = null
}
