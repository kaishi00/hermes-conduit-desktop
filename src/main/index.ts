import {
  BrowserWindow,
  ClipboardItem,
  Menu,
  app,
  clipboard,
  dialog,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  webContents,
  type MenuItemConstructorOptions
} from 'electron'
import { registerWake } from './wake'
import { handleUncaught } from './uncaughtErrors'
import { EventRouter } from './eventRouting'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { LINK_SCHEME, linkUrl, linkUrlFromArgs } from '../shared/linkUrls'
import {
  DEFAULT_RAIL_SECTIONS,
  IPC,
  type GatewayEventMessage,
  type LanguageChoice,
  type MenuAction,
  type RailSection,
  type ChatWindowRequest,
  type ConnectionStatus,
  type OpenChatRequest,
  type RpcOutcome,
  type SignInRequest,
  type ThemeChoice,
  type AppIconChoice,
  type HotkeyName,
  type PcRequest
} from '../shared/ipc'
import { probeHost } from './auth'
import { forgetSignInSession, openSignInWindow } from './browserSignIn'
import { pageServed, pageUrl, registerPageScheme, servePages } from './pages'
import { HOST_PAGE_PRIVILEGES, attachedBrowserKind, browserFrameKind, confineBrowserPage, hostPageKey, serveHostPages } from './hostPages'
import { FILE_SCHEME_PRIVILEGES, openPageInBrowser, serveViewedFiles, viewHostFile, viewStagedFile } from './viewFiles'
import { isPagePath, pageDownloadDecision, type PageRead } from '../shared/viewFileRules'
import { confineNavigation } from './navigation'
import { endSocket, LiveOwners, PAGE_CLOSED, PAGE_RELOADED, replacesPage, type LiveClose } from './liveOwners'
import { pluginRelease } from './pluginRelease'
import { cleanHeaders } from './proxyHeaders'
import { KeptHosts, keptRpcWritable } from './keptHosts'
import { readServerCertificate } from './serverCertificate'
import { hostSpellings, isThisComputer } from './localFolders'
import { writeFile } from 'node:fs/promises'
import { hostFileName, hostFilePath, dataUrlBytes, streamToFile, isDashboardPage, kanbanAttachmentPath, copyDown } from './hostFiles'
import { Connection, DISPLAY_SOCKET_PATH } from './connection'
import { Pairing } from './pairing'
import { createFileStore } from './store'
import { QuickAsk } from './quickAsk'
import { GlobalHotkey } from './hotkey'
import { CallWindowClose } from './callWindowClose'
import { validAccelerator } from '../shared/accelerator'
import { ChatWindowSet, chatWindowFor } from './chatWindowSet'
import { createChatWindow } from './chatWindows'
import { LIVE_CALL_WINDOW_ID, dockedFrameHost, onTopKey } from '../shared/chatWindows'
import { keepOnTop } from './chatWindowsOnTop'
import { ScreenWindowSet } from './screenWindowSet'
import { createScreenWindow } from './screenWindows'
import { keepWindowPlace, openingPlace, saveWindowPlaces } from './windowPlaces'
import { parseScreenKey, releaseScreen } from '../shared/screenWindows'
import { ConduitTray } from './tray'
import { DockPresence } from './dockPresence'
import { applyAppIcon, watchNewWindows } from './appIcon'
import { rebuildMenu } from './menuGate'
import { watchEditMenu } from './editMenu'
import { launchedAtLogin, loginItemState, openStartupSettings, setLoginItem } from './loginItem'
import { askPc, closePcAsk, deletePcDriver, initPcControl, installPcDriver, pcControlState, resumePcDriverInstall, runPcRequest, setPcControl, stopControl } from './pcControl'
import {
  appIconChoice,
  askHostAtLaunch,
  chooseAppIcon,
  chooseAskHost,
  chooseHideDock,
  hideDockWhenClosed,
  chooseHotkeyAccelerator,
  hotkeyAccelerator,
  chooseLanguage,
  chooseLock,
  chooseTheme,
  languageChoice,
  lockOnLaunch,
  resolvedLanguage,
  themeChoice
} from './settings'
import { lockKind, promptUnlock } from './appLock'
import { declineDeviceReports, deviceReports, sendDeviceReports, watchDeviceReports, watchWindowFreezes } from './deviceReports'
import type { WebSocketLike } from '../vendor/hermes-shared/json-rpc-gateway'
import { jsonRpcErrorReason } from '../vendor/hermes-shared/json-rpc-channel'
import { LIVE_TOKEN_PATHS, mintedSocket, type LiveSocketEvent } from '../shared/ipc'
import { setLanguage, t } from '../shared/i18n'
import { STALLED_CLOSE_CODE, STALLED_REASON, liveSendDecision } from './liveBacklog'
import { trustSystemRoots } from './systemRoots'
import { checkForUpdates, downloadUpdate, installUpdate, setAutoUpdate, startUpdates, updateState } from './updates'

const isMac = process.platform === 'darwin'
let mainWindow: BrowserWindow | null = null
/** Set by Quit: until then, closing the window only hides it (Conduit stays in the tray). */
let quitting = false

/** Restart to Update, from Settings or the tray: the windows close for good rather than hide. */
function restartToUpdate(): void {
  installUpdate(() => {
    quitting = true
  })
}

function showWindow(): void {
  if (!mainWindow) createWindow()
  const window = mainWindow
  if (!window) return
  if (window.isMinimized()) window.restore()
  reveal(window)
  window.focus()
}

/** The main window was maximized when Conduit last closed: it maximizes as it first shows (maximize() shows a hidden window). */
let maximizeOnShow = false

function reveal(window: BrowserWindow): void {
  if (maximizeOnShow) {
    maximizeOnShow = false
    window.maximize()
  } else window.show()
}

/** A Conduit link opened from another app (a Link invite, a new chat) that the window hasn't taken yet. */
let pendingLinkUrl: string | null = linkUrlFromArgs(process.argv)

/** Shows the window and hands it the link: now if it's loaded, else when it asks. */
function openLinkUrl(url: string): void {
  pendingLinkUrl = url
  showWindow()
  const target = mainWindow ?? BrowserWindow.getAllWindows()[0]
  if (target && !target.isDestroyed() && !target.webContents.isLoading()) {
    pendingLinkUrl = null
    target.webContents.send(IPC.linkUrl, url)
  }
}

function sendCommand(action: MenuAction): void {
  const target = mainWindow ?? BrowserWindow.getAllWindows()[0]
  if (target && !target.isDestroyed()) target.webContents.send(IPC.menu, action)
}

const quickAsk = new QuickAsk()
/**
 * The global shortcuts picked in Settings: Quick Ask's, and the Live call's,
 * which the main window answers with a call in a small window of its own
 * (or by coming forward to the call it already has).
 */
const hotkeys: Record<HotkeyName, GlobalHotkey> = {
  quickAsk: new GlobalHotkey(() => quickAsk.toggle()),
  liveCall: new GlobalHotkey(() => sendCommand('live-call'))
}
const showHotkeys = () => tray.setHotkeys(hotkeys.quickAsk.held, hotkeys.liveCall.held)

/** The Mac's Hide from the Dock (desktop#586): the Dock icon only while a window of Conduit's own is open. */
const dockPresence = isMac && app.dock
  ? new DockPresence(
      { hide: () => app.dock!.hide(), show: () => app.dock!.show(), isVisible: () => app.dock!.isVisible() },
      () => BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && !quickAsk.owns(window) && (window.isVisible() || window.isMinimized()))
    )
  : null

const tray = new ConduitTray({
  quickAsk: () => quickAsk.toggle(),
  liveCall: () => sendCommand('live-call'),
  window: () => mainWindow,
  showWindow,
  command: sendCommand,
  quit: () => app.quit(),
  installUpdate: () => restartToUpdate()
})

function send(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}
/** To every window and the main window's docked frames, which getAllWindows leaves out (a far chat's header reads which screens are open). */
function sendWithDocked(channel: string, payload: unknown): void {
  send(channel, payload)
  for (const page of dockedPages()) page.send(channel, payload)
}

const eventRouter = new EventRouter()
/** The wake-phrase listener's window, which runs no app and reads no gateway events. */
let isWakeListener: (window: BrowserWindow) => boolean = () => false

/**
 * The dashboard each window's chat or bot's screen is on, by its webContents id, when it's another combined one. A
 * window on another combined dashboard reads through that host's kept
 * connection whole (its calls, events, requests and status); every other
 * window reads through the one on screen.
 */
const windowHosts = new Map<number, string>()
/**
 * The main window's docked frames (another combined dashboard's chat opened in
 * place, in its chat pane, or its Pulse feed on the Pulse page), by their
 * frames' webContents ids. Each reads
 * through its own dashboard's kept connection, as a chat window on it does,
 * and never through the one on screen.
 */
const dockedChats = new Set<number>()
/** The dashboard on screen. */
let shownHost: string | null = null
/** The other dashboard a window's chat is on; null for the one on screen. */
function farHost(contentsId: number): string | null {
  const host = dockedChats.has(contentsId) ? dockedHost(contentsId) : windowHosts.get(contentsId)
  return host && host !== shownHost ? host : null
}
/**
 * A docked chat's dashboard, read from its address as it is now (its first
 * load starts before the main window hears it attach, and the main window
 * points it at another chat by its hash); '' for one that names none.
 */
function dockedHost(contentsId: number): string {
  const page = webContents.fromId(contentsId)
  if (!page || page.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) return ''
  return dockedFrameHost(page.getURL(), mainWindow.webContents.getURL()) ?? ''
}
/** The docked chats' frames, which BrowserWindow.getAllWindows() leaves out. */
function dockedPages(): Electron.WebContents[] {
  return [...dockedChats].map(id => webContents.fromId(id)).filter((page): page is Electron.WebContents => !!page && !page.isDestroyed())
}
/**
 * The main window's frames: only a docked chat or Pulse feed, at the main window's own page,
 * on a combined dashboard kept beside the one on screen, with the preload and
 * the sandbox every window has. Its calls go to the dashboard its address names.
 */
function watchDockedChats(window: BrowserWindow): void {
  window.webContents.on('will-attach-webview', (event, preferences, params) => {
    // A workbench Browser tab (hostPages.ts): its own session, no preload, nothing of the app's.
    if (browserFrameKind(params.src, params.partition)) {
      delete (preferences as { preloadURL?: string }).preloadURL
      delete preferences.preload
      preferences.contextIsolation = true
      preferences.sandbox = true
      preferences.nodeIntegration = false
      preferences.nodeIntegrationInSubFrames = false
      preferences.webSecurity = true
      preferences.allowRunningInsecureContent = false
      return
    }
    if (params.partition) {
      event.preventDefault()
      return
    }
    const host = dockedFrameHost(params.src, window.webContents.getURL())
    if (!host || host === shownHost || !chatWindowDashboards().includes(host)) {
      event.preventDefault()
      return
    }
    delete (preferences as { preloadURL?: string }).preloadURL
    preferences.preload = join(__dirname, '../preload/index.js')
    preferences.contextIsolation = true
    preferences.sandbox = true
    preferences.nodeIntegration = false
    preferences.nodeIntegrationInSubFrames = false
    preferences.webSecurity = true
  })
  window.webContents.on('did-attach-webview', (_event, page) => {
    const browser = attachedBrowserKind(page)
    if (browser) {
      confineBrowserPage(page, browser)
      return
    }
    const id = page.id
    dockedChats.add(id)
    confineNavigation(page)
    page.on('did-start-navigation', navigation => {
      if (replacesPage(navigation)) eventRouter.forget(id)
    })
    page.once('destroyed', () => {
      dockedChats.delete(id)
      eventRouter.forget(id)
    })
  })
}

/** A gateway event (or the pending requests) to the windows that read it, each cloned once per window it goes to (desktop#200). */
function sendGatewayEvent(channel: string, payload: unknown, sessionId?: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || isWakeListener(window) || farHost(window.webContents.id)) continue
    if (channel === IPC.event && window !== mainWindow && !eventRouter.wants(window.webContents.id, sessionId)) continue
    window.webContents.send(channel, payload)
  }
}
/** The status of the dashboard on screen, to every window but the chat windows on another one. */
function sendStatus(status: ConnectionStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !isWakeListener(window) && !farHost(window.webContents.id)) window.webContents.send(IPC.statusChanged, status)
  }
}
/** What a kept host says, to the chat windows open on it. */
function sendToFarWindows(url: string, channel: string, payload: unknown, sessionId?: string): void {
  const pages = [...BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).map(window => window.webContents), ...dockedPages()]
  for (const page of pages) {
    if (farHost(page.id) !== url) continue
    if (channel === IPC.event && !eventRouter.wants(page.id, sessionId)) continue
    page.send(channel, payload)
  }
}
// A refused socket option is logged, not shown; anything else gets Electron's own dialog (uncaughtErrors.ts).
process.on('uncaughtException', error => {
  handleUncaught(error, { log: message => console.warn(message), showError: (title, body) => dialog.showErrorBox(title, body) })
})

app.on('browser-window-created', (_event, window) => {
  const id = window.webContents.id
  // A reloaded page (a language change) opens its sessions again: until it does, it hasn't, so a notification
  // for one isn't left to a page that can't tell it's its own yet.
  window.webContents.on('did-start-navigation', navigation => {
    if (replacesPage(navigation)) eventRouter.forget(id)
  })
  window.on('closed', () => {
    eventRouter.forget(id)
    windowHosts.delete(id)
  })
  if (dockPresence) {
    // A window shown while the Dock icon was hidden can open behind the app in front: it comes forward once the icon is back.
    window.on('show', () =>
      dockPresence.update(() => {
        if (!window.isDestroyed() && window.isVisible()) window.focus()
      })
    )
    const update = () => dockPresence.update()
    window.on('hide', update)
    window.on('minimize', update)
    window.on('restore', update)
    window.on('closed', update)
  }
})

/** The chat windows' own BrowserWindows, so a notification can find the one that has its chat. */
const chatBrowserWindows = new WeakSet<BrowserWindow>()
// Asking again for a chat's window brings it back, out of the dock or the taskbar too.
/** Each chat window by its chat's stored id, so it's found before its session opens. */
const chatBrowserById = new Map<string, BrowserWindow>()
/** The Live call window, and the id it's kept under now: its chat's once the call makes one (a reload's new chat too). */
let callBrowser: BrowserWindow | null = null
let callWindowId = LIVE_CALL_WINDOW_ID
/** The call window's close, waiting on its call to end when it's closed mid-call (main/callWindowClose.ts). */
let callClosing: CallWindowClose | null = null
/**
 * The call window brought forward while it closes (its chat's row, a notification, the shortcut) stays open, while
 * it's still the set's (its own close button). One a sign-out or a lock dropped from the set finishes closing.
 */
function keepClosingCallWindow(window: BrowserWindow): boolean {
  if (window !== callBrowser || !callClosing?.closing) return true
  if (!chatWindows.ids().includes(callWindowId)) return false
  callClosing.cancel()
  return true
}
/** What each chat window's pin is remembered by (issue 608). The call window's pin isn't remembered: it opens on top. */
const chatOnTopKeys = new WeakMap<BrowserWindow, string>()
const chatWindows = new ChatWindowSet(
  (chat, onClosed) => {
    const window = createChatWindow(chat, onClosed)
    chatBrowserWindows.add(window)
    if (!chat.call) chatOnTopKeys.set(window, onTopKey(chat))
    chatBrowserById.set(chat.id, window)
    window.on('closed', () => {
      if (chatBrowserById.get(chat.id) === window) chatBrowserById.delete(chat.id)
    })
    if (chat.host) windowHosts.set(window.webContents.id, chat.host)
    return {
      focus: () => {
        if (window.isDestroyed()) return
        keepClosingCallWindow(window)
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
      },
      close: () => {
        if (!window.isDestroyed()) window.close()
      }
    }
  },
  ids => send(IPC.chatWindowsChanged, ids)
)
const screenWindows: ScreenWindowSet<BrowserWindow> = new ScreenWindowSet(
  (screen, onClosed) => {
    const window = createScreenWindow(screen, onClosed)
    // Its bot's dashboard: once that's another combined one (from the start, or after a switch), the window's calls go
    // through its kept connection, as a far chat window's do.
    if (screen.host) windowHosts.set(window.webContents.id, screen.host)
    return window
  },
  profiles => sendWithDocked(IPC.screenWindowsChanged, profiles),
  (key, viewerId, owed) => {
    const { host, profile } = parseScreenKey(key)
    const through = host && host !== shownHost ? keptHosts.connection(host) : connection
    if (!through) return
    return releaseScreen((method, params) => through.rpc(method, params), profile, viewerId, owed)
  }
)
/** The dashboards a chat window can be on: the one on screen and the combined ones kept beside it. */
function chatWindowDashboards(): string[] {
  return shownHost ? [shownHost, ...keptHosts.wanted(shownHost)] : []
}
/** Closes the chat windows on a dashboard no longer on screen or kept beside it. */
function closeStrandedChatWindows(): void {
  const open = chatWindowDashboards()
  chatWindows.closeWhere(chat => !open.includes(chat.host ?? ''))
  // Another combined dashboard's bot's screen goes with its dashboard too.
  screenWindows.closeWhere(key => {
    const { host } = parseScreenKey(key)
    return !!host && !open.includes(host)
  })
}
/** The connection a window's calls go through: a kept host's for a chat window on it, else the one on screen. */
function connectionOf(contentsId: number): Connection | null {
  const far = farHost(contentsId)
  if (far) return keptHosts.connection(far)
  // A docked chat that names no dashboard reads through nothing; one whose dashboard came on screen, through it.
  if (dockedChats.has(contentsId) && dockedHost(contentsId) !== shownHost) return null
  return connection
}

const hostStore = createFileStore()
// Browsers' WebSocket can't set headers; `ws` can, and has the same shape.
const createSocket = (url: string, headers: Record<string, string>) => new WebSocket(url, { headers }) as unknown as WebSocketLike

/** Combine Dashboards: the group's other hosts, connected beside the one on screen. */
const keptHosts: KeptHosts = new KeptHosts({
  fetch: globalThis.fetch.bind(globalThis),
  store: hostStore,
  createSocket,
  onChange: hosts => {
    send(IPC.keptHostsChanged, hosts)
    closeStrandedChatWindows()
  },
  onHermesName: (url, name) => noteHermesName(url, name),
  onStatus: (url, status) => sendToFarWindows(url, IPC.statusChanged, status),
  onEvent: (url, event) => {
    // Its chats on the main window's Chats list are read again now, not on the minute's poll, as on the phone.
    if (event.type === 'sessions.changed' && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.keptChatsChanged, url)
    sendToFarWindows(url, IPC.event, event, event.session_id)
  },
  onRequests: (url, requests) => sendToFarWindows(url, IPC.requestsChanged, requests),
  // Its bots' screens close and hand back their holds through its connection, before that closes (desktop#351).
  beforeStop: (url: string): Promise<void> => screenWindows.closeWhere(key => parseScreenKey(key).host === url)
})

const connection = new Connection({
  fetch: globalThis.fetch.bind(globalThis),
  store: hostStore,
  openExternal: url => shell.openExternal(url),
  browserSignIn: (url, headers, signal, signedIn) => openSignInWindow({ url, headers, signal, signedIn, parent: mainWindow }),
  forgetBrowser: forgetSignInSession,
  createSocket,
  onStatus: status => {
    const before = shownHost
    shownHost = status.phase === 'signed-out' || status.phase === 'locked' ? null : (status.url ?? null)
    sendStatus(status)
    keptHosts.sync(status)
    if (shownHost !== before) {
      // A switch keeps the chat and screen windows on the combined dashboards (the one left becomes a kept one); any other closes them.
      closeStrandedChatWindows()
      eventRouter.clear([...windowHosts.keys()])
      // The one left is dialed again beside the new one: its windows wait for it, and its kept connection tells them once it's open.
      if (before) sendToFarWindows(before, IPC.statusChanged, { phase: 'connecting', url: before } satisfies ConnectionStatus)
    }
  },
  onEvent: (event: GatewayEventMessage) => sendGatewayEvent(IPC.event, event, event.session_id),
  onRequests: requests => sendGatewayEvent(IPC.requestsChanged, requests),
  onHermesName: (url, name) => noteHermesName(url, name)
})

/** A host's plugin named its Hermes: the window hears the new names when that changed one. */
function noteHermesName(url: string, name: string): void {
  if (hostStore.setHermesName?.(url, name)) connection.hostsChanged()
}

const pairing = new Pairing({
  fetch: globalThis.fetch.bind(globalThis),
  mailbox: process.env.CONDUIT_PAIR_MAILBOX || undefined,
  onEvent: event => send(IPC.pairEvent, event),
  signIn: request => connection.signIn(request),
  switchHost: url => connection.switchHost(url, taken => keptHosts.take(taken)),
  nameHost: (url, name) => {
    if (hostStore.get?.(url)?.name) return
    hostStore.rename?.(url, name)
    connection.hostsChanged()
  }
})

let unlocking: Promise<boolean> | null = null

/** Touch ID or Windows Hello, then the saved hosts open; one prompt at a time. */
function unlock(): Promise<boolean> {
  if (!connection.isLocked) return Promise.resolve(true)
  unlocking ??= promptUnlock(t('open your Hermes sign-ins'))
    .then(async given => {
      if (given) await connection.unlocked({ askWhich: askHostAtLaunch() })
      return given
    })
    .finally(() => (unlocking = null))
  return unlocking
}

/** At launch: the host open last time, after the lock when it's on and the computer still offers it. */
async function openSavedHosts(): Promise<void> {
  if (lockOnLaunch() && connection.hosts().length && (await lockKind())) {
    connection.lock()
    void unlock()
    return
  }
  await connection.restore({ askWhich: askHostAtLaunch() })
}

/** This launch came from the sign-in: its first window stays hidden. */
let startInTray: boolean | null = null

function createWindow(): void {
  if (startInTray === null) startInTray = launchedAtLogin()
  // Where it was last time (Eric, 2026-11-27), on a screen that's still there.
  const place = openingPlace('main', { width: 1280, height: 820 }, { width: 760, height: 520 })
  maximizeOnShow = place.maximized
  const window = new BrowserWindow({
    ...place.bounds,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Conduit',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f5f5f7',
    // Our own title bar: traffic lights stay on the Mac, Windows gets drawn caption buttons.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Only for a docked chat or Pulse feed: watchDockedChats lets no other frame in.
      webviewTag: true
    }
  })
  mainWindow = window
  keepWindowPlace(window, 'main', place)
  watchWindowFreezes(window)
  watchDockedChats(window)
  // The sign-in's start stays in the tray (issue 442): the window is made, and shows when asked for.
  window.on('ready-to-show', () => {
    if (!startInTray) reveal(window)
    startInTray = false
    // Hide from the Dock takes over once the window has shown, or stayed in the tray, so a launch doesn't flicker the icon.
    dockPresence?.setEnabled(hideDockWhenClosed())
  })
  window.on('close', event => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  // Links open in the browser, never inside the app.
  confineNavigation(window.webContents)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** What a host file's save says when it fails: the file gone from Hermes, or try again. */
function saveFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return code === 404 || code === 410 ? t('This file is no longer on your Hermes host.') : t("Couldn't save the file. Try again.")
}

function registerIpc(): void {
  // Elsewhere Electron's default menu would take Ctrl+0 and Ctrl+Plus for zoom: the window reads them for the chat's text size.
  Menu.setApplicationMenu(process.platform === 'darwin' ? macMenu() : null)
  ipcMain.on(IPC.setRailSections, (_event, value: unknown) => {
    if (!Array.isArray(value)) return
    const valid = value.filter((s): s is RailSection => typeof s === 'string' && (DEFAULT_RAIL_SECTIONS as readonly string[]).includes(s))
    const next: RailSection[] = [...new Set<RailSection>(valid.includes('chats') ? valid : [...valid, 'chats'])].slice(0, 6)
    if (next.length === currentRailSections.length && next.every((s, i) => s === currentRailSections[i])) return
    currentRailSections = next
    // Not while Settings listens for Quick Ask's keys: the menu stays aside, and comes back in this order when that ends.
    if (rebuildMenu(isMac, recordingIn !== null)) Menu.setApplicationMenu(macMenu())
  })
  ipcMain.handle(IPC.requests, event => connectionOf(event.sender.id)?.requests() ?? [])
  ipcMain.on(IPC.setWaiting, (_event, count: number) => tray.setWaiting(Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0))
  ipcMain.on(IPC.windowShow, () => showWindow())
  ipcMain.on(IPC.language, event => {
    const choice = languageChoice()
    event.returnValue = { choice, resolved: resolvedLanguage(choice) }
  })
  ipcMain.on(IPC.setLanguage, (_event, choice: LanguageChoice) => {
    chooseLanguage(choice)
    // Not while Settings listens for Quick Ask's keys: the reload below ends the pick, which puts the menu back in the new language.
    if (rebuildMenu(isMac, recordingIn !== null)) Menu.setApplicationMenu(macMenu())
    tray.refresh()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.reload()
    }
  })
  ipcMain.on(IPC.theme, event => {
    event.returnValue = themeChoice()
  })
  ipcMain.on(IPC.appIcon, event => {
    event.returnValue = appIconChoice()
  })
  ipcMain.on(IPC.setAppIcon, (event, choice: AppIconChoice) => {
    const valid = chooseAppIcon(choice)
    applyAppIcon(valid)
    tray.setAppIcon(valid)
    // Every window's title bar follows, not only the one that changed it.
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && window.webContents !== event.sender) window.webContents.send(IPC.setAppIcon, valid)
    }
  })
  ipcMain.on(IPC.setTheme, (_event, choice: ThemeChoice) => {
    chooseTheme(choice)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f5f5f7')
    }
  })
  ipcMain.handle(IPC.appLock, async () => ({ kind: await lockKind(), on: lockOnLaunch() }))
  const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
  isWakeListener = registerWake(() => mainWindow).isListener
  ipcMain.handle(IPC.deviceReports, () => deviceReports())
  ipcMain.handle(IPC.updateState, () => updateState())
  ipcMain.handle(IPC.loginItem, () => loginItemState())
  initPcControl({
    notify: state => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send(IPC.pcControlChanged, state),
    stopped: () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send(IPC.pcControlStopped)
  })
  // Only the main window runs the poll loop and Settings. A docked chat shows another
  // dashboard's pages, so it must never hand over an action or change the setting.
  const fromMain = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
  const refused = { ok: false, code: 'refused', message: 'Only Conduit’s main window can do that.' }
  ipcMain.handle(IPC.pcControlState, event => (fromMain(event) ? pcControlState() : null))
  ipcMain.handle(IPC.pcControlSet, (event, change: unknown) => (fromMain(event) ? setPcControl(change && typeof change === 'object' ? change : {}) : null))
  ipcMain.handle(IPC.pcControlInstall, event => (fromMain(event) ? installPcDriver() : null))
  ipcMain.handle(IPC.pcControlDelete, event => (fromMain(event) ? deletePcDriver() : null))
  ipcMain.handle(IPC.pcControlRun, (event, request: PcRequest) => (fromMain(event) ? runPcRequest(request) : refused))
  ipcMain.handle(IPC.pcControlAsk, (event, request: PcRequest) => (fromMain(event) ? askPc(request) : 'denied'))
  ipcMain.on(IPC.pcControlCloseAsk, (event, session: unknown) => {
    if (fromMain(event) && typeof session === 'string') closePcAsk(session)
  })
  ipcMain.on(IPC.pcControlStoppedElsewhere, event => {
    if (fromMain(event)) stopControl(false)
  })
  // Stop stays open to every window: stopping is always safe.
  ipcMain.on(IPC.pcControlStop, () => stopControl())
  resumePcDriverInstall()
  ipcMain.handle(IPC.setLoginItem, (_event, on: unknown) => setLoginItem(on === true))
  ipcMain.on(IPC.openStartupSettings, () => openStartupSettings())
  ipcMain.handle(IPC.checkForUpdates, () => checkForUpdates())
  ipcMain.handle(IPC.downloadUpdate, () => downloadUpdate())
  ipcMain.on(IPC.installUpdate, () => restartToUpdate())
  ipcMain.handle(IPC.setAutoUpdate, (_event, on: unknown) => setAutoUpdate(on !== false))
  ipcMain.handle(IPC.sendDeviceReports, (_event, value: unknown) => sendDeviceReports(ids(value)))
  ipcMain.handle(IPC.declineDeviceReports, (_event, value: unknown) => declineDeviceReports(ids(value)))
  ipcMain.handle(IPC.setAppLock, async (_event, on: unknown) => {
    if (typeof on !== 'boolean' || !(await lockKind())) return false
    if (!(await promptUnlock(on ? t('turn on the lock for your Hermes sign-ins') : t('turn off the lock for your Hermes sign-ins')))) return false
    return chooseLock(on)
  })
  ipcMain.handle(IPC.unlock, () => unlock())
  ipcMain.handle(IPC.askHost, () => askHostAtLaunch())
  ipcMain.handle(IPC.setAskHost, (_event, on: unknown) => typeof on === 'boolean' && chooseAskHost(on))
  ipcMain.handle(IPC.hideDock, () => (dockPresence ? hideDockWhenClosed() : null))
  ipcMain.handle(IPC.setHideDock, (_event, on: unknown) => {
    if (!dockPresence) return null
    if (typeof on !== 'boolean') return hideDockWhenClosed()
    // As the other settings do, an unsaved choice still applies until Conduit quits.
    chooseHideDock(on)
    dockPresence.setEnabled(on)
    return on
  })
  ipcMain.on(IPC.openChat, (_event, chat: OpenChatRequest) => {
    quickAsk.hide()
    showWindow()
    mainWindow?.webContents.send(IPC.openChat, chat)
  })
  ipcMain.handle(IPC.openChatWindow, (_event, chat: unknown) => {
    const request = chat as ChatWindowRequest | null
    if (!request || typeof request.id !== 'string' || !request.id) return false
    // The dashboard on screen, or a combined one kept beside it.
    const host = typeof request.host === 'string' && request.host ? request.host : shownHost
    if (!host || !chatWindowDashboards().includes(host)) return false
    // The Live call shortcut's window: a new chat that starts a call as it opens. Asked for again, the window
    // it already is comes forward and starts another call if it has none.
    const call = request.call === true && request.id === LIVE_CALL_WINDOW_ID
    // By the window, as its id becomes its chat's once the call's first request makes one.
    // One closing mid-call that's still the set's (its own close button) is kept after all; one a sign-out or a
    // switch dropped from the set finishes closing, and a new window opens.
    const kept = callBrowser && !callBrowser.isDestroyed() && (!callClosing?.closing || chatWindows.ids().includes(callWindowId))
    const had = call && kept ? callBrowser : undefined
    if (had) {
      keepClosingCallWindow(had)
      if (had.isMinimized()) had.restore()
      had.show()
      had.focus()
      had.webContents.send(IPC.menu, 'live-call')
      return true
    }
    const shown = chatWindows.show({
      host,
      id: request.id,
      profile: typeof request.profile === 'string' ? request.profile : undefined,
      title: typeof request.title === 'string' ? request.title : undefined,
      author: typeof request.author === 'string' ? request.author : undefined,
      ...(request.botChat === true ? { botChat: true } : {}),
      ...(call ? { call: true, fresh: true } : {})
    })
    const opened = shown && call ? chatBrowserById.get(LIVE_CALL_WINDOW_ID) : undefined
    if (opened) {
      callBrowser = opened
      callWindowId = LIVE_CALL_WINDOW_ID
      // Under whichever id its chat gave it by then.
      opened.once('closed', () => {
        // By the window: a newer call window may have the module's id by then.
        for (const [id, window] of chatBrowserById) if (window === opened) chatBrowserById.delete(id)
      })
      // Closed mid-call (its close button, a sign-out, a switch): the page ends the call first, so it saves the
      // call, files a Classic call's chat and lets go of its presence, as the call's End does; closing at once
      // would drop the page before any of that ran. Hidden meanwhile, it closes once the call has ended, or
      // after a few seconds.
      const closing = new CallWindowClose(() => {
        if (!opened.isDestroyed()) opened.destroy()
      })
      callClosing = closing
      opened.on('close', event => {
        if (quitting || opened.isDestroyed() || windowCallIn !== opened.webContents) return
        event.preventDefault()
        // Asked again while it closes (a sign-out after its own close button): one close is under way.
        if (!closing.start()) return
        opened.hide()
        afterWindowCall = () => closing.callEnded()
        opened.webContents.send(IPC.menu, 'end-call')
      })
    }
    return shown
  })
  ipcMain.handle(IPC.pageWatched, event => {
    const owner = BrowserWindow.fromWebContents(event.sender.hostWebContents ?? event.sender)
    return !!owner && !owner.isDestroyed() && owner.isVisible() && !owner.isMinimized() && owner.isFocused()
  })
  // A chat window's pin (issue 608): kept in front of every other window, other apps' too, and remembered for its chat.
  const ownChatWindow = (sender: Electron.WebContents) => {
    const window = BrowserWindow.fromWebContents(sender)
    return window && !window.isDestroyed() && chatBrowserWindows.has(window) ? window : null
  }
  ipcMain.on(IPC.openChatSettings, () => {
    showWindow()
    sendCommand('chat-settings')
  })
  ipcMain.handle(IPC.chatWindowOnTop, event => ownChatWindow(event.sender)?.isAlwaysOnTop() ?? null)
  ipcMain.handle(IPC.setChatWindowOnTop, (event, on: unknown) => {
    const window = ownChatWindow(event.sender)
    if (!window || typeof on !== 'boolean') return null
    window.setAlwaysOnTop(on)
    // What the window took, not what was asked, so the remembered choice never disagrees with it.
    const now = window.isAlwaysOnTop()
    const key = chatOnTopKeys.get(window)
    if (key) keepOnTop(key, now)
    return now
  })
  ipcMain.on(IPC.closeChatWindows, (_event, ids: unknown) => chatWindows.close(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : undefined))
  ipcMain.handle(IPC.chatWindows, () => chatWindows.ids())
  ipcMain.handle(IPC.chatWindowOf, (_event, sessionId: unknown, show: unknown, storedIds: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) return null
    const live = (window: BrowserWindow | undefined) => (window && !window.isDestroyed() ? window : undefined)
    const windows = BrowserWindow.getAllWindows()
      .filter(w => !w.isDestroyed() && w !== mainWindow && chatBrowserWindows.has(w))
      .map(w => ({ contentsId: w.webContents.id, window: w }))
    const found = chatWindowFor(
      sessionId,
      Array.isArray(storedIds) ? storedIds.filter((id): id is string => typeof id === 'string' && !!id) : [],
      eventRouter.openers(sessionId),
      windows,
      id => {
        const window = live(chatBrowserById.get(id))
        return window ? { contentsId: window.webContents.id, window } : undefined
      }
    )
    const window = found?.window.window
    if (!found || !window) return null
    const watching = window.isVisible() && !window.isMinimized() && window.isFocused()
    if (show === true && keepClosingCallWindow(window)) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
    // A window still opening its session doesn't notify for it yet: the main window does, unless it's in front.
    if (!found.opened) return watching ? 'watching' : 'opening'
    return watching ? 'watching' : 'open'
  })
  ipcMain.on(IPC.openScreenWindow, (_event, screen: unknown) => {
    const request = screen as { profile?: unknown; botName?: unknown; host?: unknown } | null
    if (!request || typeof request.profile !== 'string' || !request.profile) return
    // The dashboard on screen's bot, or another combined dashboard's while it's kept beside it.
    const host = typeof request.host === 'string' && request.host ? request.host : shownHost
    if (!host || !chatWindowDashboards().includes(host)) return
    screenWindows.show({ profile: request.profile, botName: typeof request.botName === 'string' && request.botName ? request.botName : request.profile, host })
  })
  ipcMain.handle(IPC.screenWindows, () => screenWindows.profiles())
  ipcMain.on(IPC.noteScreenViewer, (_event, profile: unknown, viewerId: unknown, holds: unknown) => {
    if (typeof profile === 'string' && profile && typeof viewerId === 'string' && viewerId) screenWindows.note(profile, viewerId, holds === true)
  })
  ipcMain.handle(IPC.takeLinkUrl, () => {
    const url = pendingLinkUrl
    pendingLinkUrl = null
    return url
  })
  ipcMain.on(IPC.hideQuickAsk, () => quickAsk.hide())
  // A picture's Copy (the viewer's button): the picture itself, as a PNG every app pastes.
  ipcMain.handle(IPC.copyImage, async (_event, bytes: unknown) => {
    if (!(bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes))) return false
    const data = bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const image = nativeImage.createFromBuffer(data)
    if (image.isEmpty()) return false
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
    return true
  })
  ipcMain.on(IPC.copyText, (_event, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text)
  })
  ipcMain.on(IPC.quickAskExpanded, (_event, expanded: unknown) => quickAsk.setExpanded(typeof expanded === 'number' ? expanded : expanded === true))
  const hotkeyName = (which: unknown): HotkeyName | null => (which === 'quickAsk' || which === 'liveCall' ? which : null)
  const hotkeyState = (keys: GlobalHotkey) => ({ accelerator: keys.accelerator, registered: keys.registered })
  ipcMain.handle(IPC.hotkey, (_event, which: unknown) => {
    const name = hotkeyName(which)
    if (!name) return { accelerator: null, registered: false }
    const keys = hotkeys[name]
    // Saved keys another app held are asked for again: it may have let go of them since (desktop#520).
    // Never mid-pick, when they are let go on purpose.
    if (!recordingIn && keys.accelerator && !keys.registered) {
      keys.resume()
      showHotkeys()
    }
    return hotkeyState(keys)
  })
  ipcMain.handle(IPC.setHotkey, (_event, which: unknown, accelerator: unknown) => {
    const name = hotkeyName(which)
    if (!name) return { accelerator: null, registered: false, changed: false }
    const keys = hotkeys[name]
    const next = accelerator === null ? null : validAccelerator(accelerator) ? accelerator : undefined
    // The other shortcut's keys are Conduit's own: the system would let them be held twice.
    const other = hotkeys[name === 'quickAsk' ? 'liveCall' : 'quickAsk']
    const clash = !!next && other.accelerator === next
    const changed = next !== undefined && !clash && keys.change(next)
    if (changed) chooseHotkeyAccelerator(name, next)
    // Also after a refusal: taking the keys before back may have just worked where it hadn't at launch.
    showHotkeys()
    return { ...hotkeyState(keys), changed, ...(clash ? { takenBy: other === hotkeys.quickAsk ? 'quickAsk' : 'liveCall' } : {}) }
  })
  // Settings is listening for new keys: the Mac's menu bar would take ⌘N and the rest first, and the keys held now would open Quick Ask or a call.
  let recordingIn: Electron.WebContents | null = null
  const endRecording = () => {
    if (!recordingIn) return
    if (!recordingIn.isDestroyed()) {
      recordingIn.off('destroyed', endRecording)
      recordingIn.off('did-navigate', endRecording)
    }
    recordingIn = null
    if (isMac) Menu.setApplicationMenu(macMenu())
    for (const keys of Object.values(hotkeys)) keys.resume()
    showHotkeys()
  }
  ipcMain.on(IPC.hotkeyRecording, (event, on: unknown) => {
    if (on !== true) {
      if (recordingIn === event.sender) endRecording()
      return
    }
    endRecording()
    recordingIn = event.sender
    // A window closed or reloaded mid-pick gives the menu and the keys back.
    recordingIn.once('destroyed', endRecording)
    recordingIn.once('did-navigate', endRecording)
    if (isMac) Menu.setApplicationMenu(null)
    for (const keys of Object.values(hotkeys)) keys.suspend()
  })
  // The Live call window's call, told to the main window: it keeps wake phrases quiet and asks before a switch
  // meanwhile, and a call it starts itself ends this one (it takes the microphone).
  let windowCallIn: Electron.WebContents | null = null
  /** A call window closed mid-call waits on its call ending (see openChatWindow). */
  let afterWindowCall: (() => void) | null = null
  const tellWindowCall = (calling: boolean) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.windowCall, calling)
  }
  const windowCallGone = () => {
    if (windowCallIn && !windowCallIn.isDestroyed()) {
      windowCallIn.off('destroyed', windowCallGone)
      windowCallIn.off('did-start-navigation', reloaded)
    }
    windowCallIn = null
    tellWindowCall(false)
    const after = afterWindowCall
    afterWindowCall = null
    after?.()
  }
  // A reload keeps the webContents, so `destroyed` doesn't fire: the old page's call ended with it.
  const reloaded = (navigation: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (replacesPage(navigation)) windowCallGone()
  }
  ipcMain.on(IPC.windowCall, (event, calling: unknown) => {
    if (calling === true) {
      if (windowCallIn !== event.sender) {
        if (windowCallIn && !windowCallIn.isDestroyed()) {
          windowCallIn.off('destroyed', windowCallGone)
          windowCallIn.off('did-start-navigation', reloaded)
        }
        windowCallIn = event.sender
        windowCallIn.once('destroyed', windowCallGone)
        windowCallIn.on('did-start-navigation', reloaded)
      }
      tellWindowCall(true)
    } else if (windowCallIn === event.sender) windowCallGone()
  })
  ipcMain.on(IPC.callWindowChat, (event, storedId: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (typeof storedId !== 'string' || !storedId || !window || window !== callBrowser) return
    const was = callWindowId
    if (!chatWindows.rename(was, storedId)) return
    callWindowId = storedId
    if (chatBrowserById.get(was) === window) chatBrowserById.delete(was)
    chatBrowserById.set(storedId, window)
  })
  ipcMain.on(IPC.endWindowCall, () => {
    if (windowCallIn && !windowCallIn.isDestroyed()) windowCallIn.send(IPC.menu, 'end-call')
  })
  ipcMain.handle(IPC.answerRequest, (event, id: string, result: Record<string, unknown>) => connectionOf(event.sender.id)?.answerRequest(id, result) ?? false)
  ipcMain.handle(IPC.dismissRequest, (event, id: string) => connectionOf(event.sender.id)?.dropRequest(id))
  ipcMain.handle(IPC.probe, (_event, url: string, headers?: Record<string, string>) => {
    const cleaned = cleanHeaders(headers)
    if (!cleaned.ok) return { ok: false, error: cleaned.error }
    return probeHost(url, globalThis.fetch.bind(globalThis), cleaned.headers)
  })
  ipcMain.handle(IPC.signIn, (_event, request: SignInRequest) => connection.signIn(request))
  ipcMain.handle(IPC.cancelSignIn, () => connection.cancelSignIn())
  ipcMain.handle(IPC.editHost, (_event, from: unknown, request: SignInRequest) =>
    typeof from === 'string' && request && typeof request.url === 'string' ? connection.editHost(from, request) : { ok: false, error: t('Bad request.') }
  )
  ipcMain.handle(IPC.signOut, () => connection.signOut())
  ipcMain.handle(IPC.pairStart, () => pairing.start())
  ipcMain.handle(IPC.pairConfirm, () => pairing.confirm())
  ipcMain.handle(IPC.pairCancel, () => pairing.cancel())
  ipcMain.handle(IPC.switchHost, (_e, url: unknown) => typeof url === 'string' && connection.switchHost(url, taken => keptHosts.take(taken)))
  ipcMain.handle(IPC.removeHost, (_e, url: unknown) => {
    if (typeof url === 'string') connection.removeHost(url)
  })
  ipcMain.handle(IPC.status, event => {
    const far = farHost(event.sender.id)
    if (!far) return connection.current()
    return keptHosts.connection(far)?.current() ?? ({ phase: 'connecting', url: far } satisfies ConnectionStatus)
  })
  // Install this server's certificate: read its root, then save it where the person picks.
  const checkedCertificates = new Map<string, { pem: string; name: string }>()
  ipcMain.handle(IPC.checkCertificate, async (_e, url: unknown) => {
    if (typeof url !== 'string') return { ok: false, reason: 'notHttps' }
    const check = await readServerCertificate(url)
    if (!check.ok) return check
    checkedCertificates.set(url, { pem: check.pem, name: check.name })
    return { ok: true, fingerprint: check.fingerprint, name: check.name }
  })
  ipcMain.handle(IPC.saveCertificate, async (event, url: unknown) => {
    const checked = typeof url === 'string' ? checkedCertificates.get(url) : undefined
    if (!checked) return false
    const owner = BrowserWindow.fromWebContents(event.sender)
    const file = `${checked.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'hermes'}.crt`
    const picked = owner ? await dialog.showSaveDialog(owner, { defaultPath: file }) : await dialog.showSaveDialog({ defaultPath: file })
    if (picked.canceled || !picked.filePath) return false
    await writeFile(picked.filePath, checked.pem)
    shell.showItemInFolder(picked.filePath)
    return true
  })
  // A project's folder from Finder or Explorer, only while the dashboard runs on this computer (desktop#605).
  ipcMain.handle(IPC.hostIsThisComputer, event => isThisComputer(connectionOf(event.sender.id)?.current().url))
  ipcMain.handle(IPC.pickLocalFolder, async (event): Promise<string[] | null> => {
    if (!isThisComputer(connectionOf(event.sender.id)?.current().url)) return null
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    const path = picked.canceled ? undefined : picked.filePaths[0]
    return path ? hostSpellings(path) : null
  })
  // Save a file on the Hermes host (a reply's picture, audio or file, a workspace file) where the person picks.
  ipcMain.handle(IPC.saveHostFile, async (event, path: unknown, profile: unknown): Promise<string> => {
    if (typeof path !== 'string' || !path) return t("Couldn't open this file")
    const owner = BrowserWindow.fromWebContents(event.sender)
    const name = hostFileName(path)
    const picked = owner ? await dialog.showSaveDialog(owner, { defaultPath: name }) : await dialog.showSaveDialog({ defaultPath: name })
    if (picked.canceled || !picked.filePath) return 'cancelled'
    const shownProfile = typeof profile === 'string' ? profile : undefined
    try {
      const stop = new AbortController()
      const through = connectionOf(event.sender.id)
      if (!through) throw new Error(t("Couldn't open this file"))
      const response = await through.download(hostFilePath('download', path, shownProfile), stop.signal)
      const html = /text\/html/i.test(response.headers.get('content-type') ?? '')
      // A dashboard answering an unknown route with its own page is not the file, even
      // when the path is a page: ask read-text first (issue 564 review).
      let read: PageRead = null
      if (html && isPagePath(path)) {
        const routes = copyRoutes(event.sender.id, path, profile)
        try {
          read = routes ? await routes.readText() : null
        } catch {
          read = null
        }
      }
      const decision = pageDownloadDecision(path, html, read)
      if (decision === 'data-url') throw Object.assign(new Error('no download route'), { code: 404 })
      if (decision === 'page') {
        const routes = copyRoutes(event.sender.id, path, profile)
        // The save dialog has no viewer ticket, so there is no cancel signal to pass.
        await copyDown(picked.filePath, async () => response, routes?.dataUrl ?? (async () => null), undefined, true)
        return 'saved'
      }
      if (!response.body) throw new Error(t("Couldn't open this file"))
      await streamToFile(response.body as import('node:stream/web').ReadableStream, picked.filePath, () => stop.abort())
      return 'saved'
    } catch (error) {
      // A Hermes without /api/fs/download: the data URL its files are read as, up to 16 MB.
      if ((error as { code?: unknown }).code !== 404 && (error as { code?: unknown }).code !== 405) return saveFailure(error)
    }
    try {
      const through = connectionOf(event.sender.id)
      if (!through) return t("Couldn't open this file")
      const answer = await through.http<{ dataUrl?: unknown; data_url?: unknown }>('GET', hostFilePath('read-data-url', path, shownProfile))
      const bytes = dataUrlBytes(answer?.dataUrl ?? answer?.data_url)
      if (!bytes) return t("Couldn't open this file")
      await writeFile(picked.filePath, bytes)
      return 'saved'
    } catch (error) {
      return saveFailure(error)
    }
  })
  // A chat's file card (desktop#554): a host file copied down for its viewer (its address), or a page opened in the browser.
  const copyRoutes = (sender: number, path: string, profile: unknown) => {
    const through = connectionOf(sender)
    if (!through) return null
    const shownProfile = typeof profile === 'string' ? profile : undefined
    return {
      download: (signal: AbortSignal) => through.download(hostFilePath('download', path, shownProfile), signal),
      dataUrl: async (signal?: AbortSignal) => {
        const answer = await through.http<{ dataUrl?: unknown; data_url?: unknown }>('GET', hostFilePath('read-data-url', path, shownProfile), undefined, 30_000, signal)
        return dataUrlBytes(answer?.dataUrl ?? answer?.data_url)
      },
      readText: async () => {
        const answer: unknown = await through.http('GET', hostFilePath('read-text', path, shownProfile))
        // A dashboard answering an unknown route with its own HTML page is not a file read as text.
        if (typeof answer === 'string') throw Object.assign(new Error('no readable page'), { code: 415 })
        const row = answer && typeof answer === 'object' ? answer as { text?: unknown; binary?: unknown; truncated?: unknown } : null
        if (row?.truncated === true || row?.binary === true) return { page: true as const }
        return typeof row?.text === 'string' ? row.text : null
      }
    }
  }
  // A viewer's copy still downloading, by the ticket its viewer passed: closing the viewer stops it.
  const viewCopies = new Map<string, AbortController>()
  ipcMain.on(IPC.cancelViewHostFile, (_event, ticket: unknown) => {
    if (typeof ticket === 'string') viewCopies.get(ticket)?.abort()
  })
  const openFailure = (error: unknown) => {
    const code = (error as { code?: unknown } | null)?.code
    return code === 404 || code === 410 ? t('This file is no longer on your Hermes host.') : t("Couldn't open this file")
  }
  ipcMain.handle(IPC.viewHostFile, async (event, path: unknown, profile: unknown, ticket: unknown): Promise<{ url: string } | { error: string }> => {
    const routes = typeof path === 'string' && path ? copyRoutes(event.sender.id, path, profile) : null
    if (!routes) return { error: t("Couldn't open this file") }
    const cancel = new AbortController()
    const key = typeof ticket === 'string' ? ticket : null
    if (key) viewCopies.set(key, cancel)
    try {
      const url = await viewHostFile(path as string, routes.download, routes.dataUrl, cancel.signal)
      return url ? { url } : { error: t("Couldn't open this file") }
    } catch (error) {
      return { error: openFailure(error) }
    } finally {
      if (key) viewCopies.delete(key)
    }
  })
  ipcMain.handle(IPC.viewStagedFile, async (_event, name: unknown, mime: unknown, base64: unknown): Promise<{ url: string } | { error: string }> => {
    if (typeof name !== 'string' || typeof mime !== 'string' || typeof base64 !== 'string') return { error: t("Couldn't open this file") }
    try {
      const url = await viewStagedFile(name, mime, base64)
      return url ? { url } : { error: t("Couldn't open this file") }
    } catch (error) {
      console.warn('Conduit: staged file preview failed', error)
      return { error: t("Couldn't open this file") }
    }
  })
  ipcMain.handle(IPC.openHostPageInBrowser, async (event, path: unknown, profile: unknown): Promise<string | null> => {
    const routes = typeof path === 'string' && path ? copyRoutes(event.sender.id, path, profile) : null
    if (!routes) return t("Couldn't open this file")
    try {
      return (await openPageInBrowser(path as string, routes.readText, routes.download, routes.dataUrl)) ? null : t("Couldn't open this file")
    } catch (error) {
      return openFailure(error)
    }
  })
  ipcMain.handle(IPC.saveBytes, async (event, name: unknown, bytes: unknown) => {
    if (typeof name !== 'string' || !(bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes))) return false
    const owner = BrowserWindow.fromWebContents(event.sender)
    const file = hostFileName(name)
    const picked = owner ? await dialog.showSaveDialog(owner, { defaultPath: file }) : await dialog.showSaveDialog({ defaultPath: file })
    if (picked.canceled || !picked.filePath) return false
    await writeFile(picked.filePath, bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from((bytes as ArrayBufferView).buffer))
    return true
  })
  // Save a Kanban task's attachment (the board's own download link) where the person picks.
  ipcMain.handle(IPC.saveKanbanAttachment, async (event, id: unknown, board: unknown, filename: unknown): Promise<string> => {
    if (typeof id !== 'string' || !id) return t("Couldn't open this file")
    const owner = BrowserWindow.fromWebContents(event.sender)
    const original = typeof filename === 'string' && filename ? filename : id
    const name = hostFileName(original)
    const picked = owner ? await dialog.showSaveDialog(owner, { defaultPath: name }) : await dialog.showSaveDialog({ defaultPath: name })
    if (picked.canceled || !picked.filePath) return 'cancelled'
    try {
      const stop = new AbortController()
      const through = connectionOf(event.sender.id)
      if (!through) throw new Error(t("Couldn't open this file"))
      const response = await through.download(kanbanAttachmentPath(id, typeof board === 'string' && board ? board : null), stop.signal)
      // A dashboard that serves its page for a route it doesn't know has no attachment route: never save that page as the file.
      if (isDashboardPage(response.headers.get('content-type'), original)) throw Object.assign(new Error('no attachment route'), { code: 404 })
      if (!response.body) throw new Error(t("Couldn't open this file"))
      await streamToFile(response.body as import('node:stream/web').ReadableStream, picked.filePath, () => stop.abort())
      return 'saved'
    } catch (error) {
      return saveFailure(error)
    }
  })
  ipcMain.handle(IPC.keptHosts, () => keptHosts.list())
  ipcMain.handle(IPC.renameHost, (_e, url: unknown, name: unknown) => {
    if (typeof url !== 'string' || typeof name !== 'string') return
    hostStore.rename?.(url, name)
    connection.hostsChanged()
  })
  ipcMain.handle(IPC.setCombined, (_e, url: unknown, on: unknown) => {
    if (typeof url !== 'string' || typeof on !== 'boolean') return
    hostStore.setCombined?.(url, on)
    connection.hostsChanged()
  })
  ipcMain.handle(IPC.keptRpc, async (_e, url: unknown, method: unknown, params: unknown): Promise<RpcOutcome> => {
    if (typeof url !== 'string' || typeof method !== 'string') return { ok: false, error: 'Bad request.' }
    try {
      const given = params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {}
      // A change comes only from the main window, as with keptHttp.
      if (keptRpcWritable(method, given) && _e.sender !== mainWindow?.webContents) return { ok: false, error: 'Only reads can go to another dashboard.' }
      return { ok: true, result: await keptHosts.rpc(url, method, given) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(IPC.keptHttp, async (event, url: unknown, path: unknown, method: unknown, body: unknown): Promise<RpcOutcome> => {
    if (typeof url !== 'string' || typeof path !== 'string' || !path.startsWith('/api/')) return { ok: false, error: 'Only dashboard API paths can be read.' }
    if (method !== undefined && typeof method !== 'string') return { ok: false, error: 'Bad request.' }
    // Only the main window's Tasks changes another dashboard; a docked chat or a chat window only reads.
    if (method !== undefined && method !== 'GET' && event.sender !== mainWindow?.webContents) return { ok: false, error: 'Only reads can go to another dashboard.' }
    try {
      return { ok: true, result: await keptHosts.http(url, path, method ?? 'GET', body) }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      return { ok: false, error: error instanceof Error ? error.message : String(error), ...(typeof code === 'number' ? { code } : {}) }
    }
  })
  ipcMain.handle(IPC.reconnect, event => connectionOf(event.sender.id)?.reconnectNow())
  ipcMain.handle(IPC.rpc, async (event, method: string, params?: Record<string, unknown>): Promise<RpcOutcome> => {
    try {
      const through = connectionOf(event.sender.id)
      if (!through) throw new Error('Not connected to that Hermes.')
      const result = await through.rpc(method, params ?? {})
      eventRouter.noteOpened(event.sender.id, method, params, result)
      return { ok: true, result }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      const reason = jsonRpcErrorReason(error)
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: typeof code === 'number' ? code : undefined,
        reason: typeof reason === 'string' ? reason : undefined
      }
    }
  })
  ipcMain.handle(IPC.http, async (event, method: string, path: string, body?: unknown, timeoutMs?: unknown): Promise<RpcOutcome> => {
    try {
      // A longer wait only for what asks for it (a recording's transcription), never past ten minutes.
      const timeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? Math.min(600_000, Math.max(1_000, timeoutMs)) : undefined
      const through = connectionOf(event.sender.id)
      if (!through) throw new Error('Not connected to that Hermes.')
      return { ok: true, result: await through.http(method, path, body, timeout) }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      return { ok: false, error: error instanceof Error ? error.message : String(error), code: typeof code === 'number' ? code : undefined }
    }
  })
  ipcMain.handle(IPC.pluginRelease, () => pluginRelease())
  // Live calls' sockets: opened here, where the sign-in and a proxy's headers are (Grok Live's relay),
  // or with a single-use token the host minted that never reaches the window (Gemini Live).
  const liveSockets = new Map<string, WebSocketLike>()
  /** Each live socket's way to end itself when it stops taking frames. */
  const liveStalls = new Map<string, () => void>()
  // The ws library hands over a Buffer, an ArrayBuffer or a list of Buffers.
  const binaryFrame = (data: unknown): Uint8Array =>
    Array.isArray(data)
      ? new Uint8Array(Buffer.concat(data as Buffer[]))
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array((data as Buffer).buffer, (data as Buffer).byteOffset, (data as Buffer).byteLength)
  let liveCount = 0
  /** Each live socket's page, so a page that goes (a closed window, a reload) ends the sockets it opened (desktop#254). */
  const liveOwners = new LiveOwners()
  const watchedPages = new Set<number>()
  const forgetLive = (id: string) => {
    liveSockets.delete(id)
    liveStalls.delete(id)
    liveOwners.remove(id)
  }
  /** Ends a socket whose page went: nothing more reaches that window from it. */
  const endLive = (id: string, close: LiveClose) => {
    const socket = liveSockets.get(id)
    forgetLive(id)
    if (socket) endSocket(socket, close)
  }
  /** Watches a page once for its webContents' life, however many sockets it opens, so listeners don't stack up. */
  const watchPage = (sender: Electron.WebContents) => {
    const owner = sender.id
    if (watchedPages.has(owner)) return
    watchedPages.add(owner)
    // A reload keeps the webContents, so `destroyed` doesn't fire: the old page's sockets end as the new page starts loading.
    sender.on('did-start-navigation', navigation => {
      if (replacesPage(navigation)) for (const id of liveOwners.take(owner)) endLive(id, PAGE_RELOADED)
    })
    // A window that goes away takes its call with it.
    sender.once('destroyed', () => {
      watchedPages.delete(owner)
      for (const id of liveOwners.take(owner)) endLive(id, PAGE_CLOSED)
    })
  }
  const keepLive = (sender: Electron.WebContents, socket: WebSocketLike, binary = false): string => {
    const id = `live-${++liveCount}`
    liveSockets.set(id, socket)
    liveOwners.add(sender.id, id)
    watchPage(sender)
    const report = (payload: LiveSocketEvent) => {
      if (!sender.isDestroyed()) sender.send(IPC.liveEvent, payload)
    }
    socket.onopen = () => report({ id, type: 'open' })
    socket.onmessage = message =>
      report(
        binary && typeof message.data !== 'string'
          ? { id, type: 'binary', data: binaryFrame(message.data) }
          : { id, type: 'message', data: typeof message.data === 'string' ? message.data : String(message.data) }
      )
    socket.onerror = error => report({ id, type: 'error', message: (error as { message?: string }).message ?? 'Socket error' })
    socket.onclose = close => {
      forgetLive(id)
      report({ id, type: 'close', code: close.code, reason: close.reason })
    }
    // A socket that stopped taking frames: the call hears it closed now, not when a closing handshake gives up.
    liveStalls.set(id, () => {
      socket.onclose = null
      forgetLive(id)
      socket.close(STALLED_CLOSE_CODE, STALLED_REASON)
      report({ id, type: 'close', code: STALLED_CLOSE_CODE, reason: STALLED_REASON })
    })
    return id
  }
  ipcMain.handle(IPC.liveOpen, async (event, path: unknown, query: unknown) => {
    if (typeof path !== 'string') return { ok: false, error: 'No socket path.' }
    const params: Record<string, string> = {}
    if (query && typeof query === 'object') for (const [name, value] of Object.entries(query)) if (typeof value === 'string') params[name] = value
    try {
      // A docked far chat's call opens its sockets on its own dashboard.
      const through = connectionOf(event.sender.id)
      if (!through) throw new Error('Not connected to that Hermes.')
      return { ok: true, id: keepLive(event.sender, await through.openSocket(path, params)) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(IPC.pageUrl, (_event, html: unknown) => pageUrl(html))
  ipcMain.handle(IPC.hostPageKey, () => (shownHost ? hostPageKey(shownHost) : null))
  ipcMain.handle(IPC.pageServed, (_event, url: unknown) => pageServed(url))
  // From the window that asks: a call's screenshot steps the main window aside, Quick ask's steps itself aside.
  ipcMain.handle(IPC.screenshot, event => captureScreen(BrowserWindow.fromWebContents(event.sender) ?? mainWindow))
  ipcMain.handle(IPC.liveOpenMinted, async (event, path: unknown) => {
    if (typeof path !== 'string' || !LIVE_TOKEN_PATHS.some(allowed => path === allowed || path.startsWith(`${allowed}?`)))
      return { ok: false, error: 'Not a live token route.' }
    try {
      const through = connectionOf(event.sender.id)
      if (!through) throw new Error('Not connected to that Hermes.')
      const minted = mintedSocket(await through.http('POST', path, {}, 20_000))
      if (!minted.ok) return minted
      const socket = new WebSocket(minted.url, { maxPayload: 16 * 1024 * 1024, headers: minted.headers }) as unknown as WebSocketLike
      return { ok: true, id: keepLive(event.sender, socket), model: minted.model, voice: minted.voice }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      return { ok: false, error: error instanceof Error ? error.message : String(error), code: typeof code === 'number' ? code : undefined }
    }
  })
  ipcMain.on(IPC.liveSend, (_event, id: unknown, data: unknown) => {
    const socket = typeof id === 'string' ? liveSockets.get(id) : undefined
    if (!socket || socket.readyState !== 1) return
    if (typeof data !== 'string' && !(data instanceof Uint8Array)) return
    // A socket that stopped taking frames: late audio is dropped, and anything else closes it (liveBacklog.ts).
    const decision = liveSendDecision(socket.bufferedAmount, data)
    if (decision === 'drop') return
    if (decision === 'stalled') return liveStalls.get(id as string)?.()
    if (typeof data === 'string') socket.send(data)
    else socket.send(Uint8Array.from(data))
  })
  // A bot's screen: its RFB stream, binary both ways.
  ipcMain.handle(IPC.screenOpen, async (event, path: unknown, ticket: unknown) => {
    if (path !== DISPLAY_SOCKET_PATH || typeof ticket !== 'string' || !ticket) return { ok: false, error: 'Not a screen stream.' }
    try {
      // A far bot's screen window streams from its own dashboard.
      const through = connectionOf(event.sender.id)
      if (!through) throw new Error('Not connected to that Hermes.')
      const socket = await through.openSocket(path, { display_ticket: ticket })
      socket.binaryType = 'arraybuffer'
      return { ok: true, id: keepLive(event.sender, socket, true) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.on(IPC.liveClose, (_event, id: unknown, code: unknown) => {
    const socket = typeof id === 'string' ? liveSockets.get(id) : undefined
    if (!socket) return
    forgetLive(id as string)
    try {
      socket.close(typeof code === 'number' ? code : 1000)
    } catch {
      socket.close()
    }
  })
  ipcMain.on(IPC.windowMinimize, event => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.on(IPC.windowToggleMaximize, event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on(IPC.windowClose, event => BrowserWindow.fromWebContents(event.sender)?.close())
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const url = linkUrlFromArgs(argv)
    if (url) openLinkUrl(url)
    else showWindow()
  })
  // The Mac hands a conduit:// link to the running app, before it's ready too.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const link = linkUrl(url)
    if (!link) return
    if (app.isReady()) openLinkUrl(link)
    else pendingLinkUrl = link
  })
  // Conduit opens conduit://link/ invites and conduit://new chats; a run from source names its script too.
  if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(LINK_SCHEME, process.execPath, [resolve(process.argv[1]!)])
  else app.setAsDefaultProtocolClient(LINK_SCHEME)
  // After every window has closed, so a move or maximize just before Quit is kept too.
  app.on('will-quit', () => saveWindowPlaces())
  app.on('before-quit', () => {
    quitting = true
    saveWindowPlaces()
    quickAsk.destroy()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.setAppUserModelId('dev.conduit.desktop')
  registerPageScheme(FILE_SCHEME_PRIVILEGES, HOST_PAGE_PRIVILEGES)
  // A root installed on this computer covers the dashboard's calls and sockets, as on the phone.
  trustSystemRoots()
  void app.whenReady().then(() => {
    servePages()
    serveViewedFiles()
    // The workbench's host pages go to the dashboard on screen, the one its chat is on.
    serveHostPages(() => (shownHost ? { url: shownHost, pageRequest: (path, method, headers, body, signal) => connection.pageRequest(path, method, headers, body, signal) } : null))
    setLanguage(resolvedLanguage())
    chooseTheme(themeChoice(), false)
    watchNewWindows()
    // Every window's text gets the right-click menu: the main window, chat windows, Quick Ask, Bot's Screen.
    app.on('web-contents-created', (_event, contents) => watchEditMenu(contents))
    registerIpc()
    watchDeviceReports(() => send(IPC.deviceReportsChanged, null))
    createWindow()
    applyAppIcon(appIconChoice())
    tray.create(appIconChoice())
    for (const name of ['quickAsk', 'liveCall'] as const) hotkeys[name].register(hotkeyAccelerator(name))
    showHotkeys()
    startUpdates(state => {
      send(IPC.updateStateChanged, state)
      tray.setUpdate(state.phase === 'ready' ? (state.version ?? null) : null)
    })
    void openSavedHosts()
    // The Dock icon brings the hidden window back.
    app.on('activate', () => showWindow())
  })
  // The window only hides, so this comes with Quit; Conduit otherwise lives on in the tray.
  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })
}

/**
 * The Mac's menu bar, after the phone's: Settings on ⌘,, File > New Chat
 * and Search, View with the chat's text size and ⌘1 to ⌘6 in the rail's order, Chat > Stop, and
 * Help > Keyboard Shortcuts on ⌘/. Windows has no menu bar (the title bar
 * is ours), so the window takes Ctrl and the same keys itself there.
 */
let currentRailSections: RailSection[] = [...DEFAULT_RAIL_SECTIONS]

function railSectionLabel(section: RailSection): string {
  switch (section) {
    case 'bots':
      return t('Bots')
    case 'chats':
      return t('Chats')
    case 'tasks':
      return t('Tasks')
    case 'pulse':
      return t('Pulse')
    case 'artifacts':
      return t('Artifacts')
    default:
      return t('Needs you')
  }
}

function macMenu(): Menu {
  const command = (action: MenuAction) => () => {
    showWindow()
    sendCommand(action)
  }
  // The chat's text size goes to the window in front when that is a chat's own window, which sets it for
  // every window; raising the main window over it would take the reader away from the chat (desktop#449).
  const textSize = (action: MenuAction) => () => {
    const front = BrowserWindow.getFocusedWindow()
    // Only a chat's window listens for it: Quick Ask and a Bot's Screen leave it to the main window.
    if (front && chatBrowserWindows.has(front) && !front.isDestroyed()) front.webContents.send(IPC.menu, action)
    else command(action)()
  }
  const go = currentRailSections.slice(0, 6).map((section, i) => ({
    label: railSectionLabel(section),
    accelerator: `Cmd+${i + 1}`,
    click: command(`go-${i + 1}` as MenuAction)
  }))
  const template: MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: t('Settings'), accelerator: 'Cmd+,', click: command('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: t('File'),
      submenu: [
        { label: t('New Chat'), accelerator: 'Cmd+N', click: command('new-chat') },
        { label: t('Search'), accelerator: 'Cmd+F', click: command('search') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: t('View'),
      submenu: [
        { label: t('Make Text Bigger'), accelerator: 'Cmd+Plus', click: textSize('text-bigger') },
        { label: t('Make Text Smaller'), accelerator: 'Cmd+-', click: textSize('text-smaller') },
        { label: t('Make Text Normal Size'), accelerator: 'Cmd+0', click: textSize('text-normal') },
        { type: 'separator' },
        { label: t('Show or Hide Sidebar'), accelerator: 'Cmd+\\', click: command('toggle-sidebar') },
        { label: t('Show or Hide Workbench'), accelerator: 'Cmd+B', click: command('toggle-workbench') },
        { type: 'separator' },
        ...go,
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: t('Chat'), submenu: [{ label: t('Stop'), accelerator: 'Cmd+.', click: command('stop') }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: t('Keyboard Shortcuts'), accelerator: 'Cmd+/', click: command('shortcuts') }] }
  ]
  return Menu.buildFromTemplate(template)
}

/**
 * The screen the asking window is on, for a call's screenshot or Quick ask's
 * (the phone's Ask Hermes About Screen): the window steps aside for the
 * capture, then comes back. Null when the system gives no picture (on a Mac,
 * until Screen Recording is allowed for Conduit).
 */
async function captureScreen(win: BrowserWindow | null): Promise<string | null> {
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) }
  const shown = !!win && win.isVisible() && !win.isMinimized()
  try {
    if (shown) {
      dockPresence?.hold()
      win!.hide()
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    const source = sources.find(s => s.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) return null
    return source.thumbnail.toDataURL()
  } catch {
    return null
  } finally {
    if (shown) {
      // A chat or screen window closed during the capture is gone; the hold goes back either way.
      if (!win!.isDestroyed()) {
        win!.show()
        win!.focus()
      }
      dockPresence?.release()
    }
  }
}
