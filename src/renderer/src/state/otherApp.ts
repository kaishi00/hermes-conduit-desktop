/**
 * Conduit on iPhone, offered from here (feature map: Each app points to the
 * other). The plugin notes which Conduit apps reach a host (/link-status's
 * `clients`, plugin 0.207); this app offers the iPhone one once, in a card
 * under the chat list, only where no iPhone has used the host, after it has
 * been used on three days, and never again once the card is closed or used.
 * Settings › Conduit on iPhone has the same code at any time.
 */

export const APP_STORE_URL = 'https://apps.apple.com/us/app/hermes-conduit/id6790977764'
export const LINK_STATUS_PATH = '/api/plugins/conduit_push/link-status'
/** Days this app was used before the card shows: not on the first run. */
export const DAYS_BEFORE_OFFER = 3

const DAYS_KEY = 'conduit.otherApp.days'
const DISMISSED_KEY = 'conduit.otherApp.iphoneCardDone'

export interface HostClients {
  /** Whether Conduit on iPhone has reached this host (on any profile). */
  iphoneSeen: boolean
  /** Whether the host is paired with Conduit's push relay, which only the phone pairs. */
  pushPaired: boolean
}

/** /link-status's answer, or null when it can't say (an older plugin, a failed read). */
export function hostClients(body: unknown): HostClients | null {
  if (!body || typeof body !== 'object') return null
  const status = body as { clients?: unknown; push?: { state?: unknown } }
  const clients = status.clients as { ios?: { seen_at?: unknown; open_sockets?: unknown } } | undefined
  const ios = clients?.ios
  if (!ios || typeof ios !== 'object') return null
  const iphoneSeen = typeof ios.seen_at === 'number' || (typeof ios.open_sockets === 'number' && ios.open_sockets > 0)
  const pushState = status.push?.state
  return { iphoneSeen, pushPaired: typeof pushState === 'string' && pushState !== 'not_paired' }
}

/** The card shows only when nothing says this person already has Conduit on iPhone. */
export function offersIphone(clients: HostClients | null, daysUsed: number, done: boolean): boolean {
  if (done || !clients || daysUsed < DAYS_BEFORE_OFFER) return false
  return !clients.iphoneSeen && !clients.pushPaired
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Kept for this run only.
  }
}

function dayOf(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

/** Notes today as a day this app was used; returns how many days that makes (counting stops at the threshold). */
export function noteDayUsed(now = new Date()): number {
  let days: string[] = []
  try {
    const parsed = JSON.parse(read(DAYS_KEY) ?? '[]')
    if (Array.isArray(parsed)) days = parsed.filter((day): day is string => typeof day === 'string')
  } catch {
    days = []
  }
  const today = dayOf(now)
  if (!days.includes(today) && days.length < DAYS_BEFORE_OFFER) {
    days = [...days, today]
    write(DAYS_KEY, JSON.stringify(days))
  }
  return days.length
}

export function iphoneCardDone(): boolean {
  return read(DISMISSED_KEY) === '1'
}

/** Closing the card, or using it, retires it for good. */
export function retireIphoneCard(): void {
  write(DISMISSED_KEY, '1')
}
