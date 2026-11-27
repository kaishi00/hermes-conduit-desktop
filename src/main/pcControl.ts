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
import { BrowserWindow, globalShortcut, screen } from 'electron'
import { hostname } from 'node:os'
import { randomBytes } from 'node:crypto'
import { t } from '../shared/i18n'
import type { PcControlSettings, PcControlState, PcRequest } from '../shared/ipc'
import { artifactFor, deleteDriver, driver, driverPath, installDriver, stopDriver } from './pcDriver'
import { Executor, OWN_TITLES } from './pcExecutor'
import { choosePcControl, pcControlSettings } from './settings'

import { STOP_KEYS, claimStopKeys, releaseStopKeys } from './pcControlKeys'

export { STOP_KEYS }
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
const asking = new Map<string, { shown: Promise<'allowed' | 'denied' | 'closed'>; close: AbortController; profile: string; slot: number }>()
/** Actions running on the driver now, and who waits for none to be (an ask about to show). */
let running = 0
let idleWaiters: (() => void)[] = []
const whenIdle = () => (running ? new Promise<void>(resolve => idleWaiters.push(resolve)) : Promise.resolve())

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
  if (clean.bots) {
    const allowed = new Set(clean.bots)
    closeAsks(profile => allowed.has(profile))
  }
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

const ASK_URL = 'conduit-ask://'
const ASK_WIDTH = 440
const ASK_HEIGHT = 250
/** Each ask open at once sits a step lower and to the right, so none hides another. */
const ASK_CASCADE = 24

/**
 * Asks the user whether this chat may drive the computer: Allow or Don't
 * Allow; 'closed' once closePcAsk took it away. Conduit's own small window,
 * on top of every other one and centered, since a system dialog with no
 * window of its own could open behind the app the user was in (Asuka,
 * 2026-11-27) and looked like any other prompt (Eric). Kept out of
 * screenshots, as the bar is. Don't Allow has the focus, so a stray Enter
 * never lets a bot in; Esc and closing it are a no.
 */
export function askPc(request: PcRequest): Promise<'allowed' | 'denied' | 'closed'> {
  const key = request?.session
  if (typeof key !== 'string' || !key) return Promise.resolve('denied')
  const open = asking.get(key)
  if (open) return open.shown
  const close = new AbortController()
  // The lowest cascade step no open ask holds, so a new ask never lands on an open one.
  const taken = new Set([...asking.values()].map(entry => entry.slot))
  let slot = 0
  while (taken.has(slot)) slot++
  const shown = new Promise<'allowed' | 'denied' | 'closed'>(resolve => {
    let answered = false
    let win: BrowserWindow | null = null
    const answer = (value: 'allowed' | 'denied' | 'closed') => {
      if (answered) return
      answered = true
      resolve(value)
      if (win && !win.isDestroyed()) win.destroy()
    }
    close.signal.addEventListener('abort', () => answer('closed'))
    // Shown once no action is mid-way: one already past its wait (runPcRequest) could
    // otherwise click where the ask just opened.
    void whenIdle().then(() => {
      if (answered) return
      win = askWindow(request, slot, answer, close)
    })
  }).finally(() => asking.delete(key))
  asking.set(key, { shown, close, profile: request.profile, slot })
  return shown
}

function askWindow(
  request: PcRequest,
  slot: number,
  answer: (value: 'allowed' | 'denied' | 'closed') => void,
  close: AbortController
): BrowserWindow {
  // The screen the user is on: the one under the cursor; the cascade wraps before it leaves it.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const left = Math.round(area.x + (area.width - ASK_WIDTH) / 2)
  const top = Math.round(area.y + (area.height - ASK_HEIGHT) / 3)
  const room = Math.max(1, Math.floor(Math.min(area.x + area.width - ASK_WIDTH - left, area.y + area.height - ASK_HEIGHT - top) / ASK_CASCADE) + 1)
  const cascade = (slot % room) * ASK_CASCADE
  const win = new BrowserWindow({
    width: ASK_WIDTH,
    height: ASK_HEIGHT,
    x: left + cascade,
    y: top + cascade,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    // The bar's title, so the bot's actions never pick this window (pcExecutor).
    title: OWN_TITLES[0],
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (url.startsWith(ASK_URL)) answer(url.startsWith(`${ASK_URL}allow`) ? 'allowed' : 'denied')
  })
  // Esc is Don't Allow, as closing is (the page runs no script).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      answer('denied')
    }
  })
  win.on('closed', () => answer(close.signal.aborted ? 'closed' : 'denied'))
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    win.show()
    win.focus()
    win.flashFrame(true)
  })
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(askPage(request))).catch(() => answer('denied'))
  return win
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The ask's page, in Conduit's colors (theme.css) for the system's light or dark. */
export function askPage(request: PcRequest): string {
  const initial = esc((request.bot.trim()[0] ?? '?').toUpperCase())
  const lines = [
    request.chat ? `<p class="chat">${esc(t('Chat: {chat}', { chat: request.chat }))}</p>` : '',
    request.takes_over ? `<p>${esc(t('This takes over from “{chat}”.', { chat: request.takes_over }))}</p>` : '',
    `<p>${esc(t('It can see your screen, click and type until you press Stop ({keys}).', { keys: stopLabel() }))}</p>`
  ].join('')
  return `<!doctype html><meta charset="utf-8"><title>${OWN_TITLES[0]}</title><style>
:root{color-scheme:dark;--card:#16181f;--line:rgba(255,255,255,.12);--text:#fff;--text-3:rgba(235,235,245,.6);--soft:rgba(255,255,255,.07);--accent:#e0ab47;--ink:#1a1408}
@media (prefers-color-scheme: light){:root{color-scheme:light;--card:#fff;--line:rgba(0,0,0,.14);--text:#111318;--text-3:rgba(60,60,67,.65);--soft:rgba(0,0,0,.05)}}
html,body{margin:0;height:100%;background:transparent;font:13px 'Segoe UI Variable','Segoe UI',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:var(--text);-webkit-user-select:none;overflow:hidden}
.card{box-sizing:border-box;height:calc(100% - 16px);margin:8px;padding:18px 20px 16px;border-radius:18px;background:var(--card);border:1px solid var(--line);box-shadow:0 10px 28px rgba(0,0,0,.35);display:flex;flex-direction:column;-webkit-app-region:drag}
.top{display:flex;gap:12px;align-items:center}
.face{flex:none;width:40px;height:40px;border-radius:50%;background:var(--accent);color:var(--ink);display:grid;place-items:center;font-weight:700;font-size:17px}
.kicker{margin:0;font-size:12px;color:var(--text-3)}
h1{margin:2px 0 0;font-size:16px;font-weight:600;line-height:1.3}
.body{flex:1;min-height:0;overflow-y:auto;margin:10px 0 12px}
p{margin:4px 0 0;color:var(--text-3);line-height:1.4}
p.chat{color:var(--text)}
.chat,h1{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.actions{display:flex;justify-content:flex-end;gap:8px;-webkit-app-region:no-drag}
a{text-decoration:none;padding:7px 16px;border-radius:10px;font-weight:600}
a.no{color:var(--text);background:var(--soft);border:1px solid var(--line)}
a.yes{color:var(--ink);background:var(--accent)}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style><div class="card"><div class="top"><div class="face">${initial}</div><div><p class="kicker">${esc(t('Control from Hermes'))}</p><h1>${esc(t('Allow {bot} to control this computer?', { bot: request.bot }))}</h1></div></div><div class="body">${lines}</div><div class="actions"><a class="no" href="${ASK_URL}deny" autofocus>${esc(t('Don’t Allow'))}</a><a class="yes" href="${ASK_URL}allow">${esc(t('Allow'))}</a></div></div>`
}

/** Takes away the asks of bots that may no longer ask (all of them once it's off or stopped). */
function closeAsks(keep: (profile: string) => boolean = () => false) {
  for (const entry of asking.values()) if (!keep(entry.profile)) entry.close.abort()
}

/** The phone answered a chat's ask first: its dialog goes. */
export function closePcAsk(session: string) {
  asking.get(session)?.close.abort()
}

const stopLabel = () => (process.platform === 'darwin' ? '⌘⌥⇧S' : 'Ctrl+Alt+Shift+S')

/** Runs one action the plugin handed over. The renderer asked first (askPc, and the phone) when it needed asking. */
export async function runPcRequest(request: PcRequest): Promise<Record<string, unknown>> {
  // No action runs while an ask is up: the ask is out of the bot's screenshots, so a
  // click meant for what it saw could land on Allow (desktop#721 review).
  while (asking.size) await Promise.allSettled([...asking.values()].map(open => open.shown))
  const settings = pcControlSettings()
  if (!settings.on || !settings.bots.includes(request.profile)) return { ok: false, code: 'off' }
  if (!driverPath()) return { ok: false, code: 'unavailable', message: 'The driver isn’t downloaded on this computer yet.' }
  const grant: 'allowed' | undefined = request.needs_ok ? 'allowed' : undefined
  // Counted from here, with no wait since the asks were checked, so no ask shows mid-action.
  running++
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
    running--
    if (!running) {
      const waiting = idleWaiters
      idleWaiters = []
      for (const wake of waiting) wake()
    }
  }
}

/** Stop: the bar goes, and each allowed bot's plugin hears it (the renderer posts /pc/stop). */
export function stopControl(tell = true) {
  // Stop takes away the asks too: a no, as the phone's answer closing one is.
  closeAsks()
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
  ownKeys = claimStopKeys(globalShortcut, ownKeys, () => stopControl())
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
  releaseStopKeys(globalShortcut, ownKeys)
  ownKeys = false
  if (bar && !bar.isDestroyed()) bar.destroy()
  bar = null
}
