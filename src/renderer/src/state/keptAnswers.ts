/**
 * Hermes' last answers for the settings pages, kept on this computer per
 * dashboard, as the phone keeps them in its saved chats' store ("Screens that
 * open on their last answer", Eric 2026-10-30, issue 1533): a page draws what
 * it showed last time at once, then reads Hermes again. The route names the
 * profile (`?profile=`), so one store serves every profile. What a
 * credential-shaped key holds (a count or a switch aside) and a URL's user,
 * password and credential-named query are left out before anything is kept.
 * The key ends with the address, so Edit Connection moves it (hostData.ts),
 * and a dashboard signed out takes its answers with it.
 */
const PREFIX = 'conduit.keptAnswers.v1.'
/** The newest answers only, and none bigger than this, so a write stays cheap. */
export const KEPT_ROUTES = 60
export const KEPT_ANSWER_BYTES = 200_000

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
type Entry = { at: number; value: unknown }

let host = ''
let memory: Record<string, Entry> | null = null

/** The dashboard whose answers pages read and keep; another one's are never shown. */
export function setKeptAnswersHost(next: string): void {
  if (next === host) return
  host = next
  memory = null
}

const read = (storage: Storage): Record<string, Entry> => {
  if (memory) return memory
  let parsed: unknown = null
  try {
    parsed = host ? JSON.parse(storage.getItem(PREFIX + host) ?? 'null') : null
  } catch {
    parsed = null
  }
  memory = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, Entry>) : {}
  return memory
}

/** A name a credential goes under: …key(s), …token(s), …secret(s), cookie(s), auth…, password, credential. */
export function isCredentialName(name: string): boolean {
  const n = name.toLowerCase()
  if (/(key|keys|token|tokens|secret|secrets|cookie|cookies|auth|authorization)$/.test(n)) return true
  if (/(^|[^a-z])auth([^a-z]|$)/.test(n) || /^auth[_-]/.test(n)) return true
  return /password|passwd|passphrase|credential/.test(n)
}

const cleanUrl = (text: string): string => {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text
  try {
    const url = new URL(text)
    let changed = false
    if (url.username || url.password) {
      url.username = ''
      url.password = ''
      changed = true
    }
    for (const name of [...url.searchParams.keys()]) {
      if (isCredentialName(name)) {
        url.searchParams.delete(name)
        changed = true
      }
    }
    return changed ? url.toString() : text
  } catch {
    return text
  }
}

/** The answer without anything shaped like a credential, at any depth. */
export function withoutCredentials(value: unknown): unknown {
  if (typeof value === 'string') return cleanUrl(value)
  if (Array.isArray(value)) return value.map(withoutCredentials)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  // A {name: "Authorization", value: …} pair keeps its name only.
  const pairName = typeof record.name === 'string' ? record.name : typeof record.key === 'string' ? record.key : null
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(record)) {
    // A count or a switch under such a name (input_tokens, has_key) is no secret.
    const plain = typeof inner === 'number' || typeof inner === 'boolean' || inner === null
    if (isCredentialName(key) && !plain) continue
    if (pairName && isCredentialName(pairName) && key === 'value' && !plain) continue
    out[key] = withoutCredentials(inner)
  }
  return out
}

/** What Hermes answered on `path` last time on this dashboard, or undefined. */
export function keptAnswer(path: string, storage: Storage = localStorage): unknown {
  return read(storage)[path]?.value
}

/** When that answer was kept, in ms since the epoch, or null when none is. */
export function keptAt(path: string, storage: Storage = localStorage): number | null {
  const entry = read(storage)[path]
  return entry ? entry.at : null
}

/**
 * A function that keeps an answer on `path`, for the dashboard open now: an
 * answer that lands after a switch to another dashboard is dropped.
 */
export function answerKeeper(path: string, storage: Storage = localStorage): (value: unknown) => void {
  const asked = host
  return value => {
    if (!asked || asked !== host) return
    const clean = withoutCredentials(value)
    let text: string
    try {
      text = JSON.stringify(clean)
    } catch {
      return
    }
    if (text === undefined || text.length > KEPT_ANSWER_BYTES) return
    const all = read(storage)
    all[path] = { at: Date.now(), value: clean }
    const paths = Object.keys(all)
    if (paths.length > KEPT_ROUTES) {
      for (const old of paths.sort((a, b) => all[a]!.at - all[b]!.at).slice(0, paths.length - KEPT_ROUTES)) delete all[old]
    }
    try {
      storage.setItem(PREFIX + host, JSON.stringify(all))
    } catch {
      // Storage full: kept for this run only.
    }
  }
}

/** Forgets the answers of every dashboard not in `hosts` (signed out or removed). */
export function forgetKeptAnswers(hosts: string[], storage: Storage = localStorage): void {
  try {
    const stale: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(PREFIX) && !hosts.includes(key.slice(PREFIX.length))) stale.push(key)
    }
    for (const key of stale) storage.removeItem(key)
    if (!hosts.includes(host)) memory = null
  } catch {
    // Tried again on the next change of hosts.
  }
}
