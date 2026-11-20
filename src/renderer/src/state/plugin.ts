/**
 * The Conduit plugin on the dashboard's host, after the phone's
 * NotifierPluginStatus, NotifierPluginChangelog and NotifierPluginUpdate:
 * what the plugin reports, whether a newer one is on main, what an update
 * brings, and how a host-run update stands.
 */

export const STATUS_PATH = '/api/plugins/conduit_push/capabilities'
export const SELF_UPDATE_PATH = '/api/plugins/conduit_push/self/update'
export const SELF_UPDATE = 'self-update'
export const REPOSITORY = 'kaishi00/hermes-conduit-notifier'
/** How long Conduit follows an update the host runs, as the phone does. */
export const HOST_FOLLOW_LIMIT_MS = 900_000

export type PluginStatus =
  | { state: 'unknown' }
  /** The capabilities route isn't there: no plugin, or one too old to say. */
  | { state: 'missing' }
  | {
      state: 'reported'
      /** On disk. */
      version: string | null
      /** What the dashboard process imported. */
      loadedVersion: string | null
      restartNeeded: boolean
      capabilities: string[]
      /** Who keeps it up to date, when the host does: '' when it doesn't say. */
      managedBy: string | null
      degraded: string[]
    }

export function pluginStatus(body: unknown): PluginStatus {
  if (!body || typeof body !== 'object') return { state: 'unknown' }
  const json = body as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    state: 'reported',
    version: text(json.version),
    loadedVersion: text(json.loaded_version),
    restartNeeded: json.restart_needed === true,
    capabilities: list(json.capabilities),
    managedBy: typeof json.managed_by === 'string' ? json.managed_by.trim() : null,
    degraded: list(json.degraded)
  }
}

/**
 * One capabilities ask, told apart the way a caller that asks again needs:
 * the plugin's answer, `missing` when the route isn't there (a 404: no
 * plugin, or one too old to say), or null when it couldn't tell (a timeout,
 * a dropped connection, a 5xx while the plugin host restarts, a body that
 * isn't the plugin's), which is worth asking again.
 */
export async function askPluginStatus(get: () => Promise<unknown>): Promise<PluginStatus | null> {
  try {
    const status = pluginStatus(await get())
    return status.state === 'reported' ? status : null
  } catch (e) {
    return (e as { code?: unknown } | null)?.code === 404 ? { state: 'missing' } : null
  }
}

/** How long to wait before asking again after the nth ask (from 0) couldn't tell. */
export const askAgainMs = (attempt: number) => Math.min(30_000, 5_000 * 2 ** attempt)

export const runningVersion = (status: PluginStatus): string | null =>
  status.state === 'reported' ? (status.loadedVersion ?? (status.restartNeeded ? null : status.version)) : null

/** Dotted numeric versions part by part ("0.9.1" < "0.10.0"). An unreadable or missing version counts as older. */
export function isOlder(version: string | null | undefined, than: string): boolean {
  const parts = (v: string) => (/^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null)
  const lhs = version ? parts(version) : null
  const rhs = parts(than)
  if (!lhs || !rhs) return true
  for (let i = 0; i < Math.max(lhs.length, rhs.length); i++) {
    const a = lhs[i] ?? 0
    const b = rhs[i] ?? 0
    if (a !== b) return a < b
  }
  return false
}

/** A newer plugin is on main, and the host doesn't keep its own up to date. */
export function updateAvailable(status: PluginStatus, latest: string | null): boolean {
  if (status.state !== 'reported' || status.managedBy !== null || !latest) return false
  return isOlder(status.restartNeeded ? status.version : (runningVersion(status) ?? status.version), latest)
}

export const restartPending = (status: PluginStatus) => status.state === 'reported' && status.restartNeeded

/** The host runs the update itself (plugin 0.63+), so Conduit only follows it. */
export const canUpdateHere = (status: PluginStatus) => status.state === 'reported' && status.capabilities.includes(SELF_UPDATE)

export type ChangeKind = 'security' | 'fixes' | 'new'
export interface Change {
  version: string
  kind: ChangeKind
  text: string
}
export interface ChangelogEntry {
  version: string
  /** YYYY-MM-DD, the day it reached main. */
  released: string | null
  changes: Change[]
}

const KINDS: Record<string, ChangeKind> = { Security: 'security', Fixes: 'fixes', 'New and improved': 'new' }
export const KIND_ORDER: ChangeKind[] = ['security', 'fixes', 'new']

/** CHANGELOG.md's fixed format: `## X.Y.Z (YYYY-MM-DD)`, `### Security|Fixes|New and improved`, `- ` lines, wrapped lines indented. */
export function parseChangelog(markdown: string | null): ChangelogEntry[] {
  if (!markdown) return []
  const entries: ChangelogEntry[] = []
  let kind: ChangeKind | null = null
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      kind = null
      const [version, rest] = line.slice(3).split(/ (.*)/s)
      if (!version || isOlder(version, '0')) continue
      const date = rest?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
      entries.push({ version, released: date, changes: [] })
    } else if (line.startsWith('### ')) {
      kind = KINDS[line.slice(4).trim()] ?? null
    } else if (line.startsWith('- ') && kind && entries.length) {
      const entry = entries[entries.length - 1]
      entry.changes.push({ version: entry.version, kind, text: line.slice(2).trim() })
    } else if (line.startsWith('  ') && kind && entries.length && entries[entries.length - 1].changes.length) {
      const changes = entries[entries.length - 1].changes
      changes[changes.length - 1].text += ' ' + line.trim()
    } else if (line.trim()) {
      kind = null
    }
  }
  return entries
}

export interface ReleaseNotes {
  version: string
  released: string | null
  /** Security fixes first, then fixes, then new things, each newest first. */
  changes: Change[]
  security: boolean
}

/** What an update from `installed` to `target` brings; null when the changelog says nothing about it. */
export function releaseNotes(entries: ChangelogEntry[], installed: string | null, target: string): ReleaseNotes | null {
  const brought = entries.filter(e => !isOlder(target, e.version) && (installed ? isOlder(installed, e.version) : true))
  const all = brought.flatMap(e => e.changes)
  const changes = KIND_ORDER.flatMap(kind => all.filter(c => c.kind === kind))
  const released = entries.find(e => e.version === target)?.released ?? null
  if (!released && !changes.length) return null
  return { version: target, released, changes, security: changes.some(c => c.kind === 'security') }
}

export type UpdateStep = 'downloading' | 'restartingGateway' | 'draining' | 'waitingForChats' | 'restartingDashboard'
export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'updating'; step: UpdateStep; chats?: number }
  | { phase: 'updated'; version: string | null }
  | { phase: 'needsDashboardRestart'; detail: string | null }
  | { phase: 'failed'; detail: string | null }
  | { phase: 'runningOnHost' }

/** "Step 2 of 4", as the phone counts them. */
export const STEP_COUNT = 4
export const stepNumber = (step: UpdateStep) => (step === 'downloading' ? 1 : step === 'restartingGateway' || step === 'draining' ? 2 : 3)

/** Where a host-run update job stands (its `job`), or null when it isn't one. */
export function jobState(job: unknown): UpdateState | null {
  if (!job || typeof job !== 'object') return null
  const j = job as Record<string, unknown>
  const detail = typeof j.detail === 'string' && j.detail ? j.detail : null
  switch (j.step) {
    case 'downloading':
      return { phase: 'updating', step: 'downloading' }
    case 'restarting_gateway':
      return { phase: 'updating', step: j.gateway_stage === 'waiting' || j.gateway_stage === 'draining' ? 'draining' : 'restartingGateway' }
    case 'waiting_for_chats':
      return { phase: 'updating', step: 'waitingForChats', chats: Math.max(1, typeof j.running_chats === 'number' ? j.running_chats : 1) }
    case 'restarting_dashboard':
      return { phase: 'updating', step: 'restartingDashboard' }
    case 'done':
      return { phase: 'updated', version: (j.loaded_version as string) ?? (j.version as string) ?? null }
    case 'failed':
      return j.code === 'restart_needed' ? { phase: 'needsDashboardRestart', detail } : { phase: 'failed', detail }
    default:
      // A step a newer plugin added: still running.
      return typeof j.step === 'string' ? { phase: 'updating', step: 'downloading' } : null
  }
}

/** The features Conduit uses from the plugin, by capability id, as Settings lists them on the phone. */
export const FEATURES: { id: string; capabilities: string[] }[] = [
  { id: 'chatTakeover', capabilities: ['session-takeover', 'desktop-views'] },
  { id: 'savedCalls', capabilities: ['voice-sessions', 'voice-tags', 'voice-summary'] },
  { id: 'liveVoiceContext', capabilities: ['memory', 'personality', 'web-search'] },
  { id: 'geminiLive', capabilities: ['gemini-live'] },
  { id: 'qwenLive', capabilities: ['qwen-live'] },
  { id: 'gptLive', capabilities: ['gpt-live'] },
  { id: 'grokLive', capabilities: ['grok-live'] },
  { id: 'encryptedNotifications', capabilities: ['e2e-notifications'] },
  { id: 'pairing', capabilities: ['pairing'] },
  { id: 'hermesCalls', capabilities: ['hermes-calls'] },
  { id: 'agentSettings', capabilities: ['conduit-settings'] },
  { id: 'healthSync', capabilities: ['health-sync'] },
  { id: 'updates', capabilities: ['self-restart'] }
]

export const serves = (status: PluginStatus, capabilities: string[]) => status.state === 'reported' && capabilities.every(c => status.capabilities.includes(c))
