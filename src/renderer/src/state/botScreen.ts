/**
 * A bot's screen, after the phone's BotScreen.swift: Hermes' Bot Screen, the
 * desktop on the Hermes host (Linux only) that the bot's `computer_use` and
 * headed browser act on, one per bot (profile). Conduit watches it, takes
 * over for a sign-in or a CAPTCHA and hands back, through Hermes' `display.*`
 * methods and the screen's RFB stream on `/api/display/ws`.
 */

export interface ScreenLease {
  /** "agent" (the bot has control) or "human" (a person took over). */
  holder: string
  /** The first 12 hex characters of sha256 of the holder's viewer id. */
  viewerHash?: string
  epoch: number
}

export interface ScreenStatus {
  profile: string
  supported: boolean
  installed: boolean
  missing: string[]
  running: boolean
  geometry: string
  installCommand?: string
  /** Why a start would be refused now (low memory). */
  blocker?: string
  imageSwitch?: { current: string; target: string }
  lease: ScreenLease
  /** Hermes' key for the profile's home, which its events carry. */
  profileKey: string
}

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export function parseLease(raw: unknown): ScreenLease {
  const r = (raw ?? {}) as Row
  return { holder: str(r.holder) ?? 'agent', viewerHash: str(r.viewer_hash), epoch: typeof r.epoch === 'number' ? r.epoch : 0 }
}

/** A `display.status` answer (or one carrying it); null when it isn't one. */
export function parseStatus(raw: unknown): ScreenStatus | null {
  const r = (raw ?? {}) as Row
  if (typeof r.supported !== 'boolean') return null
  const image = (r.image_switch ?? null) as Row | null
  return {
    profile: str(r.profile) ?? '',
    supported: r.supported,
    installed: r.installed === true,
    missing: Array.isArray(r.missing) ? r.missing.filter((m): m is string => typeof m === 'string') : [],
    running: r.running === true,
    geometry: str(r.geometry) ?? '',
    installCommand: str(r.install_command),
    blocker: str(r.blocker),
    imageSwitch: image && str(image.target_image) ? { current: str(image.current_image) ?? '', target: str(image.target_image)! } : undefined,
    lease: parseLease(r.lease),
    profileKey: str(r.profile_key) ?? ''
  }
}

/** The screen's width over its height, for the frame; 16:10 when unknown. */
export function aspect(geometry: string): number {
  const [w, h] = geometry.toLowerCase().split('x').map(Number)
  return w > 0 && h > 0 ? w / h : 1.6
}

/** `viewer_hash` as Hermes writes it for a viewer id. */
export async function viewerHash(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
}

export const holds = (lease: ScreenLease, hash: string | null) => lease.holder === 'human' && !!hash && lease.viewerHash === hash

/** A late answer never undoes a newer change another device made; across a stop or start the lease starts over. */
export const newerLease = (current: ScreenLease, next: ScreenLease) => next.epoch >= current.epoch

/** Close code when someone took over from another viewer: watch again on a fresh ticket. */
export const CONTROL_TAKEN = 4000
export const MAX_RAPID_EVICTIONS = 3
export const MAX_LOG_LINES = 400

/** An install's end: what to say, if anything (code 0 is done, -2 is a host with no sudo). */
export function installEnding(code: number): 'done' | 'noSudo' | 'failed' {
  return code === 0 ? 'done' : code === -2 ? 'noSudo' : 'failed'
}

/** The log kept to its last lines. */
export const withLine = (log: string[], line: string) => [...log, line].slice(-MAX_LOG_LINES)

/**
 * The keysyms for text typed on the screen, as the phone's type bar sends
 * them: Latin-1 as itself, the rest as Unicode keysyms, a line break as
 * Return, so it lands as typed whatever the host's keyboard layout.
 */
export function keysyms(text: string): number[] {
  return Array.from(text.replace(/\r\n/g, '\n'), ch => {
    if (ch === '\n' || ch === '\r') return 0xff0d
    if (ch === '\t') return 0xff09
    const code = ch.codePointAt(0)!
    return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? code : 0x01000000 + code
  })
}
