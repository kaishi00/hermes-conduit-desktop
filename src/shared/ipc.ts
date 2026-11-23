/**
 * What the main process and the window say to each other. The window never
 * holds a password, cookie or token: it asks the main process, which owns the
 * connection to Hermes, to sign in and to make gateway calls for it.
 */
import type { Language } from './i18n'
import type { DeviceReport } from './deviceReports'
import type { UpdateState } from './updates'

/** How a dashboard lets us in, from its public sign-in discovery and status. */
export type SignInMethod = 'password' | 'token' | 'open' | 'oidc'

export type HostProbe =
  | {
      ok: true
      /** The address as we'll save it: scheme, host, port and any path prefix, no trailing slash. */
      url: string
      /** Sign-in methods the dashboard offers, best first. */
      methods: SignInMethod[]
      version?: string
    }
  | {
      ok: false
      error: string
      /** This computer doesn't trust the server's certificate: the address, for Install this server's certificate. */
      untrusted?: string
      /** Which troubleshooting page fits the failure: Network & reachability, HTTPS & certificates or Cloudflare Access. */
      help?: TroubleshootingTopic
    }

/** A language's offline speech model for the wake phrase, from Vosk's list. */
export interface WakeModelChoice {
  /** Vosk's language code: en-us, de, cn… */
  lang: string
  name: string
  /** Vosk's name for the language. */
  label: string
  bytes?: number
  md5?: string
}

/** The wake phrase's model: the languages offered, the one kept, and a download running. */
export interface WakeModelsState {
  /** Null until Vosk's list is read, or when it couldn't be. */
  choices: WakeModelChoice[] | null
  installed: { lang: string; name: string; label: string } | null
  downloading: { lang: string; received: number; total?: number } | null
  error?: string
  /** The listener as it last reported. */
  listener?: WakeListenerState
}

/** The listener: off, starting (the model loading), listening, or stopped by a problem. */
export type WakeListenerState = { state: 'off' | 'starting' | 'listening' } | { state: 'failed'; error: string }

/** The phone's troubleshooting topics a sign-in failure can point to. */
export type TroubleshootingTopic = 'network' | 'tls' | 'cloudflare'

/** The root certificate a server sends, read for the person to check and install. */
export type CertificateCheck = { ok: true; fingerprint: string; name: string } | { ok: false; reason: 'noRoot' | 'unreachable' | 'notHttps' }

export interface SignInRequest {
  url: string
  method: SignInMethod
  username?: string
  password?: string
  token?: string
  /** Headers for a proxy in front of the dashboard, sent over HTTPS only. */
  headers?: Record<string, string>
}

/** `locked`: the saved hosts wait for Touch ID or Windows Hello (Settings > Lock). */
export type ConnectionPhase = 'signed-out' | 'locked' | 'connecting' | 'open' | 'reconnecting' | 'failed'

/** The computer's own lock Conduit can ask for. */
export type AppLockKind = 'touch-id' | 'windows-hello'

export interface AppLockState {
  /** What this computer offers; null when neither Touch ID nor Windows Hello is set up. */
  kind: AppLockKind | null
  /** Whether Conduit asks for it when it opens. */
  on: boolean
}

export interface ConnectionStatus {
  phase: ConnectionPhase
  /** The saved dashboard address, once signed in. */
  url?: string
  /** A short name for the host (its hostname). */
  hostLabel?: string
  /** The user name we signed in with, for Settings. */
  username?: string
  method?: SignInMethod
  /** Shown under the title bar while not open. */
  error?: string
  /** The gateway's session authority answers (`gateway.ready`), which changes some request shapes. */
  sessionAuthority?: boolean
  /** Seconds until the next reconnect attempt, while reconnecting. */
  retryInSeconds?: number
  /** Every Hermes host signed in on this computer. */
  hosts?: HostSummary[]
  /** Signed out at launch with the hosts listed for a pick (Ask Which Dashboard at Launch). */
  choosing?: boolean
}

/** A host the phone sent while pairing, shown before signing in. */
export interface PairHost {
  url: string
  method: SignInMethod
  username?: string
  /** What the phone calls it. */
  name?: string
}

/** How pairing from the phone is going. */
export interface PairEvent {
  phase: 'received' | 'signing-in' | 'done' | 'failed' | 'expired'
  /** The four words both screens show. */
  words?: string[]
  hosts?: PairHost[]
  error?: string
}

/** A signed-in Hermes host, without its secrets. */
export interface HostSummary {
  url: string
  method: SignInMethod
  username?: string
  /** In the combined group (Combine Dashboards). */
  combined?: boolean
  /** What it's called everywhere (shared/hostNames.ts). */
  name?: string
  /** The person named it, so Rename starts from that name. */
  named?: boolean
}

/** How a combined host beside the open one is doing, in the phone's words. */
export type KeptHostState = 'live' | 'connecting' | 'down' | 'signIn'

export interface KeptHost {
  url: string
  state: KeptHostState
}

/** One gateway `event` notification, as the window receives it. */
export interface GatewayEventMessage {
  type: string
  session_id?: string
  payload?: unknown
  seq?: number
  replayed?: boolean
  /** On the Webapp's listener, the queued message a turn's `message.start` runs. */
  admission_id?: string
}

/** A value only the user may give, typed on the chat's card and sent straight to the tool that asked (never into the chat): a sudo password, a secret, a password manager's master password, a website's login or one-time code. */
export type InputPromptMethod = 'sudo' | 'secret' | 'vault.unlock_prompt' | 'vault.save_login' | 'vault.code'

export const INPUT_PROMPT_METHODS: readonly InputPromptMethod[] = ['sudo', 'secret', 'vault.unlock_prompt', 'vault.save_login', 'vault.code']

export const isInputPrompt = (request: { method: string }): boolean => (INPUT_PROMPT_METHODS as readonly string[]).includes(request.method)

/** Server→client requests the window answers: Needs you's, and a bot's screen install asking for the host's sudo password. */
export type AnsweredRequestMethod = 'approval' | 'clarify' | 'display.install.sudo' | InputPromptMethod

export const ANSWERED_REQUEST_METHODS: readonly AnsweredRequestMethod[] = ['approval', 'clarify', 'display.install.sudo', ...INPUT_PROMPT_METHODS]

/** Needs you's: the rest are answered where they're asked (the screen's install). */
export const isNeedsYouRequest = (request: { method: string }) => request.method === 'approval' || request.method === 'clarify' || isInputPrompt(request)

/** A question Hermes is waiting on: a command to approve, or questions to answer. */
export interface PendingRequest {
  id: string
  method: AnsweredRequestMethod
  /** The live session blocked on the answer. */
  sessionId: string
  params: Record<string, unknown>
  receivedAt: number
}

/** A failure carries Hermes' code and, for a gateway refusal, its machine-readable `data.reason` (SESSION_NOT_OWNED, say). */
export type RpcOutcome<T = unknown> = { ok: true; result: T } | { ok: false; error: string; code?: number; reason?: string }

/** What main of hermes-conduit-notifier holds: nulls when GitHub didn't answer. */
export interface PluginRelease {
  version: string | null
  changelog: string | null
}

export type Platform = 'win32' | 'darwin' | 'linux'

/** "system" follows the computer's language. */
export type LanguageChoice = 'system' | Language
/** "system" follows the computer's light or dark mode. */
export type ThemeChoice = 'system' | 'dark' | 'light'
/** The app icon, as on the phone: dark (the default) or light. */
export type AppIconChoice = 'dark' | 'light'

export interface ConduitApi {
  platform: Platform
  /** What the user picked in Settings, and the language that gives. */
  language: { choice: LanguageChoice; resolved: Language }
  /** Saves a new choice; every window reloads in it. */
  setLanguage(choice: LanguageChoice): void
  /** Light or dark, as picked in Settings > Appearance when the window opened. */
  theme: ThemeChoice
  /** Saves a new choice; the window follows it at once. */
  setTheme(choice: ThemeChoice): void
  /** Settings > Appearance > App icon, as picked when the window opened. */
  appIcon: AppIconChoice
  /** Saves a new choice: the windows, taskbar or Dock, tray and title bar show it at once. */
  setAppIcon(choice: AppIconChoice): void
  /** Another window changed the app icon. */
  onAppIcon(listener: (choice: AppIconChoice) => void): () => void
  /** Settings > Lock: whether this computer can lock the saved sign-ins, and whether it does. */
  appLock(): Promise<AppLockState>
  /** Turns the lock on or off, after Touch ID or Windows Hello; false when that was cancelled. */
  setAppLock(on: boolean): Promise<boolean>
  askHostAtLaunch(): Promise<boolean>
  setAskHostAtLaunch(on: boolean): Promise<boolean>
  /** Asks for Touch ID or Windows Hello and, once given, opens the saved hosts. */
  unlock(): Promise<boolean>
  /** Crash and freeze reports kept on this computer, and those Conduit still asks about. */
  /** The wake phrase: its offline model and the listener (hidden window, on this computer only). */
  wake: {
    models(): Promise<WakeModelsState>
    download(lang: string): Promise<void>
    cancelDownload(): void
    remove(): Promise<void>
    onModels(listener: (state: WakeModelsState) => void): () => void
    /** The phrases to listen for, or null to stop (the microphone closes). */
    listen(phrases: string[] | null): void
    onHeard(listener: (index: number) => void): () => void
    onListener(listener: (state: WakeListenerState) => void): () => void
  }
  deviceReports(): Promise<{ reports: DeviceReport[]; offered: DeviceReport[] }>
  /** Posts the reports to Conduit's relay; true when it kept every one. */
  sendDeviceReports(ids: string[]): Promise<boolean>
  /** Not now: Conduit doesn't ask about them again. */
  declineDeviceReports(ids: string[]): Promise<void>
  onDeviceReports(listener: () => void): () => void
  /** Conduit's own updates (shared/updates.ts). */
  updates: {
    state(): Promise<UpdateState>
    check(): Promise<UpdateState>
    download(): Promise<void>
    /** Restart to Update: quits, installs and opens Conduit again. */
    install(): void
    setAuto(on: boolean): Promise<UpdateState>
    onState(listener: (state: UpdateState) => void): () => void
  }
  /** `headers` are for a proxy in front of the dashboard (Cloudflare Access and the like). */
  probe(url: string, headers?: Record<string, string>): Promise<HostProbe>
  /** Reads the root certificate the server at `url` sends, trusting it for nothing. */
  checkCertificate(url: string): Promise<CertificateCheck>
  /** Saves the root certificate last read for `url` where the person picks; false when they didn't. */
  saveCertificate(url: string): Promise<boolean>
  /**
   * Saves a file on the Hermes host where the person picks: streamed from the
   * dashboard's /api/fs/download, else read as a data URL. 'saved', 'cancelled',
   * or what went wrong.
   */
  saveHostFile(path: string, profile?: string): Promise<string>
  /** Saves bytes already on hand (a picture's data) where the person picks; false when they didn't. */
  saveBytes(name: string, bytes: ArrayBuffer): Promise<boolean>
  /**
   * Saves a Kanban task's attachment where the person picks, streamed from
   * the board's /attachments/{id}. 'saved', 'cancelled', or what went wrong.
   */
  saveKanbanAttachment(id: string, board: string | null, filename: string): Promise<string>
  signIn(request: SignInRequest): Promise<{ ok: true } | { ok: false; error: string }>
  cancelSignIn(): Promise<void>
  /** Edit Connection: the open host signs in again at a new address or with a new sign-in, in its place. */
  editHost(from: string, request: SignInRequest): Promise<{ ok: true; url: string } | { ok: false; error: string; savedAs?: string }>
  signOut(): Promise<void>
  /** Opens another signed-in host in place of this one. */
  switchHost(url: string): Promise<boolean>
  /** Forgets a signed-in host (the open one signs out). */
  removeHost(url: string): Promise<void>
  status(): Promise<ConnectionStatus>
  /** Combine Dashboards: the group's hosts kept beside the open one, and how each is doing. */
  keptHosts(): Promise<KeptHost[]>
  onKeptHosts(listener: (hosts: KeptHost[]) => void): () => void
  /** A kept host's own `sessions.changed`: a chat made, renamed or deleted there. */
  onKeptChatsChanged(listener: (url: string) => void): () => void
  setCombined(url: string, on: boolean): Promise<void>
  /** Settings' Rename for a saved host: '' goes back to the automatic name. */
  renameHost(url: string, name: string): Promise<void>
  /** A GET through a kept host's connection, or a change to its scheduled jobs or task board (KEPT_WRITE_PATHS). */
  keptHttp<T = unknown>(url: string, path: string, method?: string, body?: unknown): Promise<RpcOutcome<T>>
  /** A read over a kept host's socket (its bots: `profiles.list`). */
  keptRpc<T = unknown>(url: string, method: string, params?: Record<string, unknown>): Promise<RpcOutcome<T>>
  /** Pairing from the phone: the QR code's link, then events as the phone answers. */
  pairStart(): Promise<{ ok: true; link: string; expires: number } | { ok: false; error: string }>
  pairConfirm(): Promise<void>
  pairCancel(): Promise<void>
  onPair(listener: (event: PairEvent) => void): () => void
  /** Retry now, while reconnecting or failed. */
  reconnect(): Promise<void>
  rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /**
   * The same calls, answering with the outcome rather than throwing: an error
   * thrown across the context bridge keeps only its message, and the window
   * needs the code too (a 404, a revision conflict). Use the renderer's
   * `gateway`, which throws with both.
   */
  rpcOutcome<T = unknown>(method: string, params?: Record<string, unknown>): Promise<RpcOutcome<T>>
  httpOutcome<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs?: number): Promise<RpcOutcome<T>>
  /** A dashboard REST call; `path` starts with `/api/`. */
  http<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T>
  /** The Conduit plugin's newest version and changelog on its main branch, read by the main process (the window can't reach GitHub). */
  pluginRelease(): Promise<PluginRelease>
  /**
   * A live call's socket to a plugin route (`/api/plugins/...`), opened by the
   * main process with this sign-in's credential; its events come on `onLive`.
   */
  liveOpen(path: string, query?: Record<string, string>): Promise<{ ok: true; id: string } | { ok: false; error: string }>
  /** A live call's socket opened with a single-use token the host mints at `path` (Gemini Live); the token stays in the main process. */
  /** A page Hermes drew, served on its own scheme for a sandboxed frame; null when it's too large. */
  pageUrl(html: string): Promise<string | null>
  /** The screen Conduit's window is on, as a PNG data URL, with the window out of the way; null when it can't be captured (no permission). */
  screenshot(): Promise<string | null>
  liveOpenMinted(path: string): Promise<{ ok: true; id: string; model: string | null; voice: string | null } | { ok: false; error: string; code?: number }>
  liveSend(id: string, data: string | Uint8Array): void
  /** A bot's screen stream (`/api/display/ws`) on this sign-in, admitted by its `display.observe` ticket; its frames come binary on `onLive`. */
  screenOpen(path: string, ticket: string): Promise<{ ok: true; id: string } | { ok: false; error: string }>
  liveClose(id: string, code?: number): void
  onLive(listener: (event: LiveSocketEvent) => void): () => void
  onStatus(listener: (status: ConnectionStatus) => void): () => void
  onEvent(listener: (event: GatewayEventMessage) => void): () => void
  /** The questions Hermes is waiting on, now and whenever they change. */
  requests(): Promise<PendingRequest[]>
  onRequests(listener: (requests: PendingRequest[]) => void): () => void
  /** Answers a request with its result; false when it's already gone. */
  answerRequest(id: string, result: Record<string, unknown>): Promise<boolean>
  /** Drops a request the gateway settled some other way (a batch's last `clarify.lock`). */
  dismissRequest(id: string): Promise<void>
  /** Shows a chat in the main window (quick ask's Open in Conduit). */
  openChat(chat: OpenChatRequest): void
  onOpenChat(listener: (chat: OpenChatRequest) => void): () => void
  /** Moves a chat to a window of its own, or brings its window to the front; false when the limit is open. */
  openChatWindow(chat: ChatWindowRequest): Promise<boolean>
  /**
   * The chat window that opened this session: 'watching' when it's in front
   * (a notification would only repeat it), 'open' when it's behind; with
   * `show`, it comes to the front. null when no chat window has it.
   * `storedIds` (the ids the chat goes by) find a window that hasn't opened its session yet: 'opening', which
   * doesn't notify for it yet, so the asking window does.
   */
  chatWindowOf(sessionId: string, show?: boolean, storedIds?: readonly string[]): Promise<'watching' | 'open' | 'opening' | null>
  /** Whether the window this page is drawn in is in front: a docked chat's main window, else its own. */
  pageWatched(): Promise<boolean>
  /**
   * A docked page tells the main window's pane, straight through its frame: 'moved' when its chat opened in
   * a window of its own, 'closed' when its room copy was deleted (either closes the pane), 'ask' for whether
   * Chats is on screen, 'calling' and 'call-ended' as a call starts and ends in its chat.
   */
  dockedToPane(message: 'moved' | 'closed' | 'ask' | 'calling' | 'call-ended'): void
  /** Closes these chats' windows, or every chat window. */
  closeChatWindows(ids?: string[]): void
  /** The chats that have a window of their own, now and whenever that changes. */
  chatWindows(): Promise<string[]>
  onChatWindows(listener: (ids: string[]) => void): () => void
  /** A docked chat's page hears whether its pane is on screen (the main window's Chats), from the main window's frame. */
  onDockedShown(listener: (shown: boolean) => void): () => void
  /** Opens a bot's screen in a window of its own, or focuses the one it has; `host` is its dashboard, the one on screen when left out. */
  openScreenWindow(screen: { profile: string; botName: string; host?: string }): void
  /** The bots whose screen has a window open (their screen keys, shared/screenWindows.ts), now and whenever that changes. */
  screenWindows(): Promise<string[]>
  onScreenWindows(listener: (profiles: string[]) => void): () => void
  /** A screen window's viewer id and whether it holds the screen, so closing the window hands back for it. */
  noteScreenViewer(key: string, viewerId: string, holds: boolean): void
  /** The quick ask window was just shown: focus its field. */
  onQuickAskShown(listener: () => void): () => void
  /** Sizes the quick ask window: true for a reply, false for the field alone, or the px the field and its staged files need. */
  setQuickAskExpanded(expanded: boolean | number): void
  /** Puts text on the system clipboard (a message's Copy). */
  copyText(text: string): void
  /** Hides the quick ask window. */
  hideQuickAsk(): void
  /** The quick ask shortcut, and whether the system let Conduit have it. */
  quickAskShortcut(): Promise<{ accelerator: string; registered: boolean }>
  /** How many things wait on the user, for the tray and the Dock's badge. */
  setWaiting(count: number): void
  /** A menu bar command (the Mac's File > New Chat). */
  onMenu(listener: (action: MenuAction) => void): () => void
  /** A Link invite opened from another app before the window could take it, taken once. */
  takeLinkUrl(): Promise<string | null>
  /** A Link invite opened from another app while Conduit runs. */
  onLinkUrl(listener: (url: string) => void): () => void
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    /** Brings the window back from the tray and focuses it (a notification's click). */
    show(): void
  }
}

/** Commands the menu bar sends the window. */
export type MenuAction =
  | 'new-chat'
  | 'needs-you'
  | 'search'
  | 'stop'
  | 'settings'
  | 'text-bigger'
  | 'text-smaller'
  | 'text-normal'
  | 'shortcuts'
  | 'toggle-sidebar'
  | 'go-1'
  | 'go-2'
  | 'go-3'
  | 'go-4'
  | 'go-5'

export interface OpenChatRequest {
  storedId: string
  profile?: string
  title?: string
  /** A bot's Bot Chat, coming back from a window of its own. */
  botChat?: boolean
  /** Another combined dashboard's chat, coming back from a window of its own (or a docked chat's notification): it docks in the chat pane, with no switch. */
  host?: string
  /** Words the message box starts with (a docked Pulse card's Do it). */
  draft?: string
  /** A new chat in its profile, for a docked Pulse card from no chat; `storedId` is left empty. */
  fresh?: boolean
  /** From the chat's own window (its Open in Main Window), which closes once the main window has it; any other open focuses a chat's window when it has one. */
  fromWindow?: boolean
}

/** A bot's screen for a window of its own; the viewer id it had before, if it did. */
export interface ScreenWindowRequest {
  profile: string
  botName: string
  viewerId?: string
  /** The bot's dashboard: the one on screen, or another combined one, whose screen is watched through its kept connection. */
  host?: string
}

/** A chat for a window of its own. */
export interface ChatWindowRequest {
  id: string
  profile?: string
  title?: string
  /** The bot's name for the message box, until the window reads the roster. */
  author?: string
  /** The bot's one Bot Chat, which never resets: `/new` compacts it. */
  botChat?: boolean
  /** The dashboard the chat is on: the one on screen, or another combined one. */
  host?: string
  /** Shown in the main window's chat pane rather than a window of its own: another combined dashboard's chat, opened in place. */
  docked?: boolean
  /** Words the message box starts with (a Pulse card's Do it). */
  draft?: string
  /** A new chat in its profile (a Pulse card from no chat): `id` only names the pane. */
  fresh?: boolean
}

export const IPC = {
  menu: 'conduit:menu',
  takeLinkUrl: 'conduit:take-link-url',
  linkUrl: 'conduit:link-url',
  requests: 'conduit:requests',
  requestsChanged: 'conduit:requests-changed',
  answerRequest: 'conduit:answer-request',
  dismissRequest: 'conduit:dismiss-request',
  setWaiting: 'conduit:set-waiting',
  openChat: 'conduit:open-chat',
  openChatWindow: 'conduit:open-chat-window',
  closeChatWindows: 'conduit:close-chat-windows',
  chatWindows: 'conduit:chat-windows',
  chatWindowOf: 'conduit:chat-window-of',
  pageWatched: 'conduit:page-watched',
  dockedShown: 'conduit:docked-shown',
  dockedToPane: 'conduit:docked-to-pane',
  chatWindowsChanged: 'conduit:chat-windows-changed',
  openScreenWindow: 'conduit:open-screen-window',
  screenWindows: 'conduit:screen-windows',
  screenWindowsChanged: 'conduit:screen-windows-changed',
  noteScreenViewer: 'conduit:note-screen-viewer',
  hideQuickAsk: 'conduit:hide-quick-ask',
  copyText: 'conduit:copy-text',
  quickAskShown: 'conduit:quick-ask-shown',
  quickAskExpanded: 'conduit:quick-ask-expanded',
  quickAskShortcut: 'conduit:quick-ask-shortcut',
  windowShow: 'conduit:window-show',
  probe: 'conduit:probe',
  signIn: 'conduit:sign-in',
  cancelSignIn: 'conduit:cancel-sign-in',
  editHost: 'conduit:edit-host',
  signOut: 'conduit:sign-out',
  switchHost: 'conduit:switch-host',
  pairStart: 'conduit:pair-start',
  pairConfirm: 'conduit:pair-confirm',
  pairCancel: 'conduit:pair-cancel',
  pairEvent: 'conduit:pair-event',
  removeHost: 'conduit:remove-host',
  status: 'conduit:status',
  keptHosts: 'conduit:kept-hosts',
  keptHostsChanged: 'conduit:kept-hosts-changed',
  keptChatsChanged: 'conduit:kept-chats-changed',
  setCombined: 'conduit:set-combined',
  renameHost: 'conduit:rename-host',
  keptHttp: 'conduit:kept-http',
  checkCertificate: 'conduit:check-certificate',
  saveCertificate: 'conduit:save-certificate',
  saveHostFile: 'conduit:save-host-file',
  saveBytes: 'conduit:save-bytes',
  saveKanbanAttachment: 'conduit:save-kanban-attachment',
  keptRpc: 'conduit:kept-rpc',
  reconnect: 'conduit:reconnect',
  rpc: 'conduit:rpc',
  http: 'conduit:http',
  statusChanged: 'conduit:status-changed',
  event: 'conduit:event',
  windowMinimize: 'conduit:window-minimize',
  windowToggleMaximize: 'conduit:window-toggle-maximize',
  windowClose: 'conduit:window-close',
  language: 'conduit:language',
  setLanguage: 'conduit:set-language',
  theme: 'conduit:theme',
  setTheme: 'conduit:set-theme',
  appIcon: 'conduit:app-icon',
  setAppIcon: 'conduit:set-app-icon',
  appLock: 'conduit:app-lock',
  setAppLock: 'conduit:set-app-lock',
  askHost: 'conduit:ask-host',
  setAskHost: 'conduit:set-ask-host',
  unlock: 'conduit:unlock',
  wakeModels: 'conduit:wake-models',
  wakeDownload: 'conduit:wake-download',
  wakeCancel: 'conduit:wake-cancel',
  wakeRemove: 'conduit:wake-remove',
  wakeModelsChanged: 'conduit:wake-models-changed',
  wakeListen: 'conduit:wake-listen',
  wakeHeard: 'conduit:wake-heard',
  wakeListener: 'conduit:wake-listener',
  /** The listener window's own: its model, its phrases, and what it hears. */
  wakeModelBytes: 'conduit:wake-model-bytes',
  wakePhrases: 'conduit:wake-phrases',
  wakeReport: 'conduit:wake-report',
  deviceReports: 'conduit:device-reports',
  sendDeviceReports: 'conduit:send-device-reports',
  declineDeviceReports: 'conduit:decline-device-reports',
  deviceReportsChanged: 'conduit:device-reports-changed',
  updateState: 'conduit:update-state',
  checkForUpdates: 'conduit:check-for-updates',
  downloadUpdate: 'conduit:download-update',
  installUpdate: 'conduit:install-update',
  setAutoUpdate: 'conduit:set-auto-update',
  updateStateChanged: 'conduit:update-state-changed',
  pluginRelease: 'conduit:plugin-release',
  liveOpen: 'conduit:live-open',
  liveOpenMinted: 'conduit:live-open-minted',
  pageUrl: 'conduit:page-url',
  screenshot: 'conduit:screenshot',
  liveSend: 'conduit:live-send',
  screenOpen: 'conduit:screen-open',
  liveClose: 'conduit:live-close',
  liveEvent: 'conduit:live-event'
} as const

/** What a live call's socket (opened by the main process) reports. */
export type LiveSocketEvent =
  | { id: string; type: 'open' }
  | { id: string; type: 'message'; data: string }
  /** A binary socket's frame (a bot's screen stream). */
  | { id: string; type: 'binary'; data: Uint8Array }
  | { id: string; type: 'close'; code: number; reason: string }
  | { id: string; type: 'error'; message: string }

/** The token routes whose minted socket the main process opens (Gemini Live's). */
export const LIVE_TOKEN_PATHS = ['/api/plugins/conduit_push/gemini-live/token', '/api/plugins/conduit_push/qwen-live/token']

/** Alibaba Cloud's realtime hosts, the only ones a Qwen Live credential is sent to (the phone's QwenLiveSocket.request). */
const QWEN_HOSTS = ['.cn-beijing.maas.aliyuncs.com', '.ap-southeast-1.maas.aliyuncs.com']

export type MintedSocket =
  | { ok: true; url: string; headers?: Record<string, string>; model: string | null; voice: string | null }
  | { ok: false; error: string }

/**
 * A minted credential's socket, after the phone's GeminiLiveToken: Gemini's
 * `websocket_url` (wss only) with the single-use token as `access_token`;
 * Qwen's on Alibaba Cloud's realtime path, with the temporary key (`st-…`)
 * in the upgrade's Authorization header.
 */
export function mintedSocket(response: unknown): MintedSocket {
  const r = (response ?? {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null)
  if (r.ok !== true) return { ok: false, error: text(r.reason) ?? text(r.error) ?? 'unavailable' }
  const token = text(r.token)
  let url: URL | null = null
  try {
    url = new URL(text(r.websocket_url) ?? '')
  } catch {
    url = null
  }
  if (!token || !url || url.protocol !== 'wss:') return { ok: false, error: 'malformed' }
  if (r.provider === 'qwen') {
    const host = url.hostname.toLowerCase()
    if (!token.startsWith('st-') || !QWEN_HOSTS.some(suffix => host.endsWith(suffix)) || url.pathname !== '/api-ws/v1/realtime')
      return { ok: false, error: 'Invalid Qwen Live credential.' }
    return { ok: true, url: url.toString(), headers: { Authorization: `Bearer ${token}` }, model: text(r.model), voice: text(r.voice) }
  }
  if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', token)
  return { ok: true, url: url.toString(), model: text(r.model), voice: text(r.voice) }
}
