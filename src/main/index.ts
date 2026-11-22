import {
  BrowserWindow,
  Menu,
  app,
  clipboard,
  dialog,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeTheme,
  screen,
  shell,
  webContents,
  type MenuItemConstructorOptions
} from 'electron'
import { registerWake } from './wake'
import { EventRouter } from './eventRouting'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { LINK_SCHEME, linkUrl, linkUrlFromArgs } from '../shared/linkUrls'
import {
  IPC,
  type GatewayEventMessage,
  type LanguageChoice,
  type MenuAction,
  type ChatWindowRequest,
  type ConnectionStatus,
  type OpenChatRequest,
  type RpcOutcome,
  type SignInRequest,
  type ThemeChoice,
  type AppIconChoice
} from '../shared/ipc'
import { probeHost } from './auth'
import { pageUrl, registerPageScheme, servePages } from './pages'
import { confineNavigation } from './navigation'
import { endSocket, LiveOwners, PAGE_CLOSED, PAGE_RELOADED, replacesPage, type LiveClose } from './liveOwners'
import { pluginRelease } from './pluginRelease'
import { cleanHeaders } from './proxyHeaders'
import { KeptHosts } from './keptHosts'
import { readServerCertificate } from './serverCertificate'
import { writeFile } from 'node:fs/promises'
import { hostFileName, hostFilePath, dataUrlBytes, streamToFile, isDashboardPage, kanbanAttachmentPath } from './hostFiles'
import { Connection, DISPLAY_SOCKET_PATH } from './connection'
import { Pairing } from './pairing'
import { createFileStore } from './store'
import { QUICK_ASK_ACCELERATOR, QuickAsk } from './quickAsk'
import { ChatWindowSet, chatWindowFor } from './chatWindowSet'
import { createChatWindow } from './chatWindows'
import { dockedFrameHost } from '../shared/chatWindows'
import { ScreenWindowSet } from './screenWindowSet'
import { createScreenWindow } from './screenWindows'
import { releaseScreen } from '../shared/screenWindows'
import { ConduitTray } from './tray'
import { applyAppIcon, watchNewWindows } from './appIcon'
import { watchEditMenu } from './editMenu'
import {
  appIconChoice,
  askHostAtLaunch,
  chooseAppIcon,
  chooseAskHost,
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

const isMac = process.platform === 'darwin'
let mainWindow: BrowserWindow | null = null
/** Set by Quit: until then, closing the window only hides it (Conduit stays in the tray). */
let quitting = false

function showWindow(): void {
  if (!mainWindow) createWindow()
  const window = mainWindow
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/** A Link invite opened from another app that the window hasn't taken yet. */
let pendingLinkUrl: string | null = linkUrlFromArgs(process.argv)

/** Shows the window and hands it the invite: now if it's loaded, else when it asks. */
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

const tray = new ConduitTray({
  quickAsk: () => quickAsk.toggle(),
  window: () => mainWindow,
  showWindow,
  command: sendCommand,
  quit: () => app.quit()
})

function send(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

const eventRouter = new EventRouter()
/** The wake-phrase listener's window, which runs no app and reads no gateway events. */
let isWakeListener: (window: BrowserWindow) => boolean = () => false

/**
 * The dashboard each chat window's chat is on, by its webContents id. A chat
 * window on another combined dashboard reads through that host's kept
 * connection whole (its calls, events, requests and status); every other
 * window reads through the one on screen.
 */
const chatWindowHosts = new Map<number, string>()
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
  const host = dockedChats.has(contentsId) ? dockedHost(contentsId) : chatWindowHosts.get(contentsId)
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
app.on('browser-window-created', (_event, window) => {
  const id = window.webContents.id
  // A reloaded page (a language change) opens its sessions again: until it does, it hasn't, so a notification
  // for one isn't left to a page that can't tell it's its own yet.
  window.webContents.on('did-start-navigation', navigation => {
    if (replacesPage(navigation)) eventRouter.forget(id)
  })
  window.on('closed', () => {
    eventRouter.forget(id)
    chatWindowHosts.delete(id)
  })
})

/** The chat windows' own BrowserWindows, so a notification can find the one that has its chat. */
const chatBrowserWindows = new WeakSet<BrowserWindow>()
// Asking again for a chat's window brings it back, out of the dock or the taskbar too.
/** Each chat window by its chat's stored id, so it's found before its session opens. */
const chatBrowserById = new Map<string, BrowserWindow>()
const chatWindows = new ChatWindowSet(
  (chat, onClosed) => {
    const window = createChatWindow(chat, onClosed)
    chatBrowserWindows.add(window)
    chatBrowserById.set(chat.id, window)
    window.on('closed', () => {
      if (chatBrowserById.get(chat.id) === window) chatBrowserById.delete(chat.id)
    })
    if (chat.host) chatWindowHosts.set(window.webContents.id, chat.host)
    return {
      focus: () => {
        if (window.isDestroyed()) return
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
const screenWindows = new ScreenWindowSet(
  createScreenWindow,
  profiles => send(IPC.screenWindowsChanged, profiles),
  (profile, viewerId, owed) => releaseScreen((method, params) => connection.rpc(method, params), profile, viewerId, owed)
)
/** The dashboards a chat window can be on: the one on screen and the combined ones kept beside it. */
function chatWindowDashboards(): string[] {
  return shownHost ? [shownHost, ...keptHosts.wanted(shownHost)] : []
}
/** Closes the chat windows on a dashboard no longer on screen or kept beside it. */
function closeStrandedChatWindows(): void {
  const open = chatWindowDashboards()
  chatWindows.closeWhere(chat => !open.includes(chat.host ?? ''))
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
const keptHosts = new KeptHosts({
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
  onRequests: (url, requests) => sendToFarWindows(url, IPC.requestsChanged, requests)
})

const connection = new Connection({
  fetch: globalThis.fetch.bind(globalThis),
  store: hostStore,
  createSocket,
  onStatus: status => {
    const before = shownHost
    shownHost = status.phase === 'signed-out' || status.phase === 'locked' ? null : (status.url ?? null)
    sendStatus(status)
    keptHosts.sync(status)
    if (shownHost !== before) {
      // A switch keeps the chat windows on the combined dashboards (the one left becomes a kept one); any other closes them.
      closeStrandedChatWindows()
      screenWindows.close(true)
      eventRouter.clear([...chatWindowHosts.keys()])
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

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
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
  watchWindowFreezes(window)
  watchDockedChats(window)
  window.on('ready-to-show', () => window.show())
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
  ipcMain.handle(IPC.requests, event => connectionOf(event.sender.id)?.requests() ?? [])
  ipcMain.on(IPC.setWaiting, (_event, count: number) => tray.setWaiting(Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0))
  ipcMain.on(IPC.windowShow, () => showWindow())
  ipcMain.on(IPC.language, event => {
    const choice = languageChoice()
    event.returnValue = { choice, resolved: resolvedLanguage(choice) }
  })
  ipcMain.on(IPC.setLanguage, (_event, choice: LanguageChoice) => {
    chooseLanguage(choice)
    if (isMac) Menu.setApplicationMenu(macMenu())
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
    return chatWindows.show({
      host,
      id: request.id,
      profile: typeof request.profile === 'string' ? request.profile : undefined,
      title: typeof request.title === 'string' ? request.title : undefined,
      author: typeof request.author === 'string' ? request.author : undefined,
      ...(request.botChat === true ? { botChat: true } : {})
    })
  })
  ipcMain.handle(IPC.pageWatched, event => {
    const owner = BrowserWindow.fromWebContents(event.sender.hostWebContents ?? event.sender)
    return !!owner && !owner.isDestroyed() && owner.isVisible() && !owner.isMinimized() && owner.isFocused()
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
    if (show === true) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
    // A window still opening its session doesn't notify for it yet: the main window does, unless it's in front.
    if (!found.opened) return watching ? 'watching' : 'opening'
    return watching ? 'watching' : 'open'
  })
  ipcMain.on(IPC.openScreenWindow, (_event, screen: unknown) => {
    const request = screen as { profile?: unknown; botName?: unknown } | null
    if (!request || typeof request.profile !== 'string' || !request.profile) return
    screenWindows.show({ profile: request.profile, botName: typeof request.botName === 'string' && request.botName ? request.botName : request.profile })
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
  ipcMain.on(IPC.copyText, (_event, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text)
  })
  ipcMain.on(IPC.quickAskExpanded, (_event, expanded: unknown) => quickAsk.setExpanded(typeof expanded === 'number' ? expanded : expanded === true))
  ipcMain.handle(IPC.quickAskShortcut, () => ({ accelerator: QUICK_ASK_ACCELERATOR, registered: quickAsk.registered }))
  ipcMain.handle(IPC.answerRequest, (event, id: string, result: Record<string, unknown>) => connectionOf(event.sender.id)?.answerRequest(id, result) ?? false)
  ipcMain.handle(IPC.dismissRequest, (event, id: string) => connectionOf(event.sender.id)?.dropRequest(id))
  ipcMain.handle(IPC.probe, (_event, url: string, headers?: Record<string, string>) => {
    const cleaned = cleanHeaders(headers)
    if (!cleaned.ok) return { ok: false, error: cleaned.error }
    return probeHost(url, globalThis.fetch.bind(globalThis), cleaned.headers)
  })
  ipcMain.handle(IPC.signIn, (_event, request: SignInRequest) => connection.signIn(request))
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
      // A dashboard that serves its page for a route it doesn't know has no download route.
      if (/text\/html/i.test(response.headers.get('content-type') ?? '')) throw Object.assign(new Error('no download route'), { code: 404 })
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
      return { ok: true, id: keepLive(event.sender, await connection.openSocket(path, params)) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(IPC.pageUrl, (_event, html: unknown) => pageUrl(html))
  // From the window that asks: a call's screenshot steps the main window aside, Quick ask's steps itself aside.
  ipcMain.handle(IPC.screenshot, event => captureScreen(BrowserWindow.fromWebContents(event.sender) ?? mainWindow))
  ipcMain.handle(IPC.liveOpenMinted, async (event, path: unknown) => {
    if (typeof path !== 'string' || !LIVE_TOKEN_PATHS.some(allowed => path === allowed || path.startsWith(`${allowed}?`)))
      return { ok: false, error: 'Not a live token route.' }
    try {
      const minted = mintedSocket(await connection.http('POST', path, {}, 20_000))
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
      const socket = await connection.openSocket(path, { display_ticket: ticket })
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
    const invite = linkUrl(url)
    if (!invite) return
    if (app.isReady()) openLinkUrl(invite)
    else pendingLinkUrl = invite
  })
  // Conduit opens conduit://link/ invites; a run from source names its script too.
  if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(LINK_SCHEME, process.execPath, [resolve(process.argv[1]!)])
  else app.setAsDefaultProtocolClient(LINK_SCHEME)
  app.on('before-quit', () => {
    quitting = true
    quickAsk.destroy()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.setAppUserModelId('dev.conduit.desktop')
  registerPageScheme()
  // A root installed on this computer covers the dashboard's calls and sockets, as on the phone.
  trustSystemRoots()
  void app.whenReady().then(() => {
    servePages()
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
    quickAsk.register()
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
 * and Search, View with the chat's text size and ⌘1 to ⌘5, Chat > Stop, and
 * Help > Keyboard Shortcuts on ⌘/. Windows has no menu bar (the title bar
 * is ours), so the window takes Ctrl and the same keys itself there.
 */
function macMenu(): Menu {
  const command = (action: MenuAction) => () => {
    showWindow()
    sendCommand(action)
  }
  const go = [t('Bots'), t('Chats'), t('Tasks'), t('Pulse'), t('Needs you')].map((label, i) => ({
    label,
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
        { label: t('Make Text Bigger'), accelerator: 'Cmd+Plus', click: command('text-bigger') },
        { label: t('Make Text Smaller'), accelerator: 'Cmd+-', click: command('text-smaller') },
        { label: t('Make Text Normal Size'), accelerator: 'Cmd+0', click: command('text-normal') },
        { type: 'separator' },
        { label: t('Show or Hide Sidebar'), accelerator: 'Cmd+\\', click: command('toggle-sidebar') },
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
      win!.show()
      win!.focus()
    }
  }
}
