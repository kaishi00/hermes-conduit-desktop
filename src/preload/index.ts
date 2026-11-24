import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type AppIconChoice,
  type ConduitApi,
  type ConnectionStatus,
  type GatewayEventMessage,
  type KeptHost,
  type LiveSocketEvent,
  type MenuAction,
  type OpenChatRequest,
  type PairEvent,
  type PendingRequest,
  type Platform,
  type RpcOutcome
} from '../shared/ipc'

/**
 * One ipcRenderer listener per channel, fanned out to every subscriber: many
 * screens stay mounted and each listens for gateway events, which would pass
 * EventEmitter's limit of 10 listeners and warn of a leak that isn't one.
 */
const fanouts = new Map<string, Set<(value: unknown) => void>>()

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  let subscribers = fanouts.get(channel)
  if (!subscribers) {
    const set = new Set<(value: unknown) => void>()
    subscribers = set
    fanouts.set(channel, set)
    ipcRenderer.on(channel, (_event: IpcRendererEvent, value: unknown) => {
      // A subscriber that unsubscribes (or throws) mid-dispatch leaves the rest unaffected.
      for (const subscriber of [...set]) {
        try {
          subscriber(value)
        } catch (e) {
          console.error(e)
        }
      }
    })
  }
  // Its own wrapper, so the same function subscribed twice is called twice and unsubscribed once each.
  const subscriber = (value: unknown) => listener(value as T)
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
  }
}

class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

const api: ConduitApi = {
  platform: process.platform as Platform,
  language: ipcRenderer.sendSync(IPC.language) as ConduitApi['language'],
  setLanguage: choice => ipcRenderer.send(IPC.setLanguage, choice),
  theme: ipcRenderer.sendSync(IPC.theme) as ConduitApi['theme'],
  setTheme: choice => ipcRenderer.send(IPC.setTheme, choice),
  appIcon: ipcRenderer.sendSync(IPC.appIcon) as ConduitApi['appIcon'],
  setAppIcon: choice => ipcRenderer.send(IPC.setAppIcon, choice),
  onAppIcon: listener => listen<AppIconChoice>(IPC.setAppIcon, listener),
  appLock: () => ipcRenderer.invoke(IPC.appLock),
  setAppLock: on => ipcRenderer.invoke(IPC.setAppLock, on),
  askHostAtLaunch: () => ipcRenderer.invoke(IPC.askHost),
  setAskHostAtLaunch: on => ipcRenderer.invoke(IPC.setAskHost, on),
  wake: {
    models: () => ipcRenderer.invoke(IPC.wakeModels),
    download: lang => ipcRenderer.invoke(IPC.wakeDownload, lang),
    cancelDownload: () => ipcRenderer.send(IPC.wakeCancel),
    remove: () => ipcRenderer.invoke(IPC.wakeRemove),
    onModels: listener => listen(IPC.wakeModelsChanged, listener),
    listen: phrases => ipcRenderer.send(IPC.wakeListen, phrases),
    onHeard: listener => listen(IPC.wakeHeard, listener),
    onListener: listener => listen(IPC.wakeListener, listener)
  },
  deviceReports: () => ipcRenderer.invoke(IPC.deviceReports),
  sendDeviceReports: ids => ipcRenderer.invoke(IPC.sendDeviceReports, ids),
  declineDeviceReports: ids => ipcRenderer.invoke(IPC.declineDeviceReports, ids),
  onDeviceReports: listener => listen<void>(IPC.deviceReportsChanged, () => listener()),
  updates: {
    state: () => ipcRenderer.invoke(IPC.updateState),
    check: () => ipcRenderer.invoke(IPC.checkForUpdates),
    download: () => ipcRenderer.invoke(IPC.downloadUpdate),
    install: () => ipcRenderer.send(IPC.installUpdate),
    setAuto: on => ipcRenderer.invoke(IPC.setAutoUpdate, on),
    onState: listener => listen(IPC.updateStateChanged, listener)
  },
  unlock: () => ipcRenderer.invoke(IPC.unlock),
  probe: (url, headers) => ipcRenderer.invoke(IPC.probe, url, headers),
  checkCertificate: url => ipcRenderer.invoke(IPC.checkCertificate, url),
  saveCertificate: url => ipcRenderer.invoke(IPC.saveCertificate, url),
  saveHostFile: (path, profile) => ipcRenderer.invoke(IPC.saveHostFile, path, profile),
  saveBytes: (name, bytes) => ipcRenderer.invoke(IPC.saveBytes, name, bytes),
  saveKanbanAttachment: (id, board, filename) => ipcRenderer.invoke(IPC.saveKanbanAttachment, id, board, filename),
  signIn: request => ipcRenderer.invoke(IPC.signIn, request),
  cancelSignIn: () => ipcRenderer.invoke(IPC.cancelSignIn),
  editHost: (from, request) => ipcRenderer.invoke(IPC.editHost, from, request),
  signOut: () => ipcRenderer.invoke(IPC.signOut),
  switchHost: (url: string) => ipcRenderer.invoke(IPC.switchHost, url),
  removeHost: (url: string) => ipcRenderer.invoke(IPC.removeHost, url),
  status: () => ipcRenderer.invoke(IPC.status),
  keptHosts: () => ipcRenderer.invoke(IPC.keptHosts),
  onKeptHosts: listener => listen<KeptHost[]>(IPC.keptHostsChanged, listener),
  onKeptChatsChanged: listener => listen<string>(IPC.keptChatsChanged, listener),
  setCombined: (url, on) => ipcRenderer.invoke(IPC.setCombined, url, on),
  renameHost: (url, name) => ipcRenderer.invoke(IPC.renameHost, url, name),
  keptHttp: (url, path, method, body) => ipcRenderer.invoke(IPC.keptHttp, url, path, method, body),
  keptRpc: (url, method, params) => ipcRenderer.invoke(IPC.keptRpc, url, method, params),
  reconnect: () => ipcRenderer.invoke(IPC.reconnect),
  async rpc<T>(method: string, params?: Record<string, unknown>) {
    const outcome = (await ipcRenderer.invoke(IPC.rpc, method, params)) as RpcOutcome<T>
    if (!outcome.ok) throw new RpcError(outcome.error, outcome.code)
    return outcome.result
  },
  async http<T>(method: string, path: string, body?: unknown) {
    const outcome = (await ipcRenderer.invoke(IPC.http, method, path, body)) as RpcOutcome<T>
    if (!outcome.ok) throw new RpcError(outcome.error, outcome.code)
    return outcome.result
  },
  rpcOutcome: (method, params) => ipcRenderer.invoke(IPC.rpc, method, params),
  httpOutcome: (method, path, body, timeoutMs) => ipcRenderer.invoke(IPC.http, method, path, body, timeoutMs),
  pluginRelease: () => ipcRenderer.invoke(IPC.pluginRelease),
  liveOpen: (path, query) => ipcRenderer.invoke(IPC.liveOpen, path, query),
  liveOpenMinted: path => ipcRenderer.invoke(IPC.liveOpenMinted, path),
  pageUrl: html => ipcRenderer.invoke(IPC.pageUrl, html),
  screenshot: () => ipcRenderer.invoke(IPC.screenshot),
  liveSend: (id, data) => ipcRenderer.send(IPC.liveSend, id, data),
  screenOpen: (path, ticket) => ipcRenderer.invoke(IPC.screenOpen, path, ticket),
  liveClose: (id, code) => ipcRenderer.send(IPC.liveClose, id, code),
  onLive: listener => listen<LiveSocketEvent>(IPC.liveEvent, listener),
  pairStart: () => ipcRenderer.invoke(IPC.pairStart),
  pairConfirm: () => ipcRenderer.invoke(IPC.pairConfirm),
  pairCancel: () => ipcRenderer.invoke(IPC.pairCancel),
  onPair: listener => listen<PairEvent>(IPC.pairEvent, listener),
  onStatus: listener => listen<ConnectionStatus>(IPC.statusChanged, listener),
  onEvent: listener => listen<GatewayEventMessage>(IPC.event, listener),
  requests: () => ipcRenderer.invoke(IPC.requests),
  onRequests: listener => listen<PendingRequest[]>(IPC.requestsChanged, listener),
  answerRequest: (id, result) => ipcRenderer.invoke(IPC.answerRequest, id, result),
  dismissRequest: id => ipcRenderer.invoke(IPC.dismissRequest, id),
  setWaiting: count => ipcRenderer.send(IPC.setWaiting, count),
  openChat: chat => ipcRenderer.send(IPC.openChat, chat),
  onOpenChat: listener => listen<OpenChatRequest>(IPC.openChat, listener),
  openChatWindow: chat => ipcRenderer.invoke(IPC.openChatWindow, chat),
  pageWatched: () => ipcRenderer.invoke(IPC.pageWatched),
  dockedToPane: message => ipcRenderer.sendToHost(IPC.dockedToPane, message),
  onDockedShown: listener => listen<boolean>(IPC.dockedShown, listener),
  closeChatWindows: ids => ipcRenderer.send(IPC.closeChatWindows, ids),
  chatWindows: () => ipcRenderer.invoke(IPC.chatWindows),
  chatWindowOf: (sessionId, show, storedIds) => ipcRenderer.invoke(IPC.chatWindowOf, sessionId, show === true, storedIds ? [...storedIds] : []),
  onChatWindows: listener => listen<string[]>(IPC.chatWindowsChanged, listener),
  openScreenWindow: screen => ipcRenderer.send(IPC.openScreenWindow, screen),
  screenWindows: () => ipcRenderer.invoke(IPC.screenWindows),
  onScreenWindows: listener => listen<string[]>(IPC.screenWindowsChanged, listener),
  noteScreenViewer: (profile, viewerId, holds) => ipcRenderer.send(IPC.noteScreenViewer, profile, viewerId, holds),
  hideQuickAsk: () => ipcRenderer.send(IPC.hideQuickAsk),
  copyText: text => ipcRenderer.send(IPC.copyText, text),
  setQuickAskExpanded: expanded => ipcRenderer.send(IPC.quickAskExpanded, expanded),
  onQuickAskShown: listener => listen<void>(IPC.quickAskShown, () => listener()),
  quickAskShortcut: () => ipcRenderer.invoke(IPC.quickAskShortcut),
  setQuickAskShortcut: accelerator => ipcRenderer.invoke(IPC.setQuickAskShortcut, accelerator),
  setQuickAskRecording: on => ipcRenderer.send(IPC.quickAskRecording, on),
  onMenu: listener => listen<MenuAction>(IPC.menu, listener),
  takeLinkUrl: () => ipcRenderer.invoke(IPC.takeLinkUrl),
  onLinkUrl: listener => listen<string>(IPC.linkUrl, listener),
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    show: () => ipcRenderer.send(IPC.windowShow)
  }
}

contextBridge.exposeInMainWorld('conduit', api)
