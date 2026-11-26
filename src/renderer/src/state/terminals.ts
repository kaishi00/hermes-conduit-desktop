/**
 * The workbench's terminals (issue 450): shells on the Hermes host, started
 * in the chat's folder, through the Conduit plugin's `/terminals` routes and
 * socket (capability `terminals`). A terminal keeps running while nothing
 * shows it; a view that comes back asks for what it missed from the last
 * byte it drew. The routes act on the dashboard's own process (it holds the
 * shells), so a profile goes as ?conduit_profile= where the plugin reads it.
 */
import { dashboardProfilePath, dashboardProfileQuery } from './dashboardProfile'

export const TERMINALS = '/api/plugins/conduit_push/terminals'
export const TERMINALS_SOCKET = `${TERMINALS}/socket`
export const TERMINALS_CAPABILITY = 'terminals'

export interface TerminalRow {
  id: string
  root: string
  title: string
  exited: boolean
  exitCode: number | null
  /** Bytes the terminal has written. */
  end: number
}

export interface TerminalList {
  available: boolean
  /** Why there are none here: turned off, a hosted Hermes, an SSH profile, a Windows host. */
  reason: string | null
  enabled: boolean
  terminals: TerminalRow[]
}

export const listPath = (root: string, profile?: string | null) => dashboardProfilePath(`${TERMINALS}?root=${encodeURIComponent(root)}`, profile)
export const createPath = (profile?: string | null) => dashboardProfilePath(TERMINALS, profile)
export const closePath = (id: string, profile?: string | null) => dashboardProfilePath(`${TERMINALS}?id=${encodeURIComponent(id)}`, profile)
export const renamePath = (profile?: string | null) => dashboardProfilePath(`${TERMINALS}/rename`, profile)
export const settingsPath = `${TERMINALS}/settings`
export const socketQuery = (id: string, since: number, profile?: string | null): Record<string, string> => ({
  id,
  since: String(since),
  ...dashboardProfileQuery(profile)
})

export function parseRow(raw: unknown): TerminalRow | null {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id) return null
  return {
    id: row.id,
    root: typeof row.root === 'string' ? row.root : '',
    title: typeof row.title === 'string' && row.title ? row.title : 'Terminal',
    exited: row.exited === true,
    exitCode: typeof row.exitCode === 'number' ? row.exitCode : null,
    end: typeof row.end === 'number' ? row.end : 0
  }
}

export function parseList(raw: unknown): TerminalList {
  const json = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    available: json.available === true,
    reason: typeof json.reason === 'string' && json.reason ? json.reason : null,
    enabled: json.enabled !== false,
    terminals: (Array.isArray(json.terminals) ? json.terminals : []).map(parseRow).filter((row): row is TerminalRow => row !== null)
  }
}

/** What the socket says, decoded. */
export type TerminalFrame =
  | { type: 'hello'; row: TerminalRow | null; start: number; end: number }
  | { type: 'output'; bytes: Uint8Array; end: number }
  | { type: 'exit'; code: number | null; end: number }

function bytesOf(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function parseFrame(data: string): TerminalFrame | null {
  let json: Record<string, unknown>
  try {
    const parsed = JSON.parse(data) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    json = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const end = typeof json.end === 'number' ? json.end : 0
  if (json.type === 'hello') return { type: 'hello', row: parseRow(json.terminal), start: typeof json.start === 'number' ? json.start : 0, end }
  if (json.type === 'output' && typeof json.b64 === 'string') {
    try {
      return { type: 'output', bytes: bytesOf(json.b64), end }
    } catch {
      return null
    }
  }
  if (json.type === 'exit') return { type: 'exit', code: typeof json.code === 'number' ? json.code : null, end }
  return null
}

export const inputFrame = (data: string) => JSON.stringify({ type: 'input', data })
export const resizeFrame = (cols: number, rows: number) => JSON.stringify({ type: 'resize', cols, rows })

/** The plugin's close codes: the terminal is gone, or refused, and reconnecting won't help. */
export const CLOSE_GONE = 4404
export const CLOSE_REFUSED = 4403
export const CLOSE_UNAUTHORIZED = 4401
/** It fell behind: reconnect from the last byte drawn. */
export const CLOSE_SLOW = 4408

/** Whether a closed socket is worth opening again (from the last byte drawn). */
export const reconnects = (code: number | undefined, exited: boolean) =>
  !exited && code !== CLOSE_GONE && code !== CLOSE_REFUSED && code !== CLOSE_UNAUTHORIZED && code !== 1000

/** How long to wait before the nth reconnect (from 0). */
export const reconnectDelayMs = (attempt: number) => Math.min(10_000, 500 * 2 ** attempt)

/**
 * What a view has drawn, so a reconnect asks for only what it missed: the
 * end it reached. A frame that ends at or before it (a replay overlapping
 * what's drawn) is cut to the new part.
 */
export class Drawn {
  end = 0
  /** The part of `bytes` (ending at `end`) not yet drawn, or null for none. */
  fresh(bytes: Uint8Array, end: number): Uint8Array | null {
    const start = end - bytes.length
    if (end <= this.end) return null
    const skip = Math.max(0, this.end - start)
    this.end = end
    return skip ? bytes.subarray(skip) : bytes
  }
}
