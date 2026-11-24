/**
 * Keeps the signed-in Hermes hosts between launches, in the app's data
 * folder, and which one is open. The passwords, tokens and cookies are
 * encrypted with the system keychain (Keychain on the Mac, DPAPI on Windows)
 * through Electron's safeStorage. Where that isn't available they're kept for
 * this launch only.
 */
import { app, safeStorage } from 'electron'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { keepUnreadable, writeFileAtomic } from './atomicWrite'
import type { ConnectionStore, PendingSignOut, SavedConnection } from './connection'
import { createHostList } from './hosts'
import { storedGrant } from './oidc'

interface StoredHost {
  url: string
  method: SavedConnection['method']
  username?: string
  combined?: boolean
  name?: string
  hermesName?: string
  /** base64 of safeStorage-encrypted JSON `{ password?, token?, cookies? }`. */
  secrets?: string
}

interface StoredFileV1 extends StoredHost {
  version: 1
}

interface StoredFile {
  version: 2
  active: string | null
  hosts: StoredHost[]
}

/** Failed sign-outs, encrypted on their own: they outlive the host entry they came from. */
const pendingPath = join(app.getPath('userData'), 'pending-signouts.json')

function readPending(): PendingSignOut[] {
  try {
    if (!safeStorage.isEncryptionAvailable()) return []
    const raw = JSON.parse(safeStorage.decryptString(Buffer.from(readFileSync(pendingPath, 'utf8'), 'base64'))) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is PendingSignOut =>
      !!item && typeof item === 'object' && typeof (item as PendingSignOut).url === 'string' &&
      typeof (item as PendingSignOut).refreshToken === 'string' && typeof (item as PendingSignOut).expiresAt === 'number'
    ).slice(-20)
  } catch {
    return []
  }
}

function writePending(list: PendingSignOut[]): void {
  if (!safeStorage.isEncryptionAvailable()) return
  writeFileAtomic(pendingPath, safeStorage.encryptString(JSON.stringify(list.slice(-20))).toString('base64'), 0o600)
}

/** A host's own name and its Hermes' name (shared/hostNames.ts), where it has them. */
const names = (host: { name?: unknown; hermesName?: unknown }): { name?: string; hermesName?: string } => ({
  ...(typeof host.name === 'string' && host.name ? { name: host.name } : {}),
  ...(typeof host.hermesName === 'string' && host.hermesName ? { hermesName: host.hermesName } : {})
})

export function createFileStore(): ConnectionStore {
  const path = join(app.getPath('userData'), 'connection.json')

  const decode = (stored: StoredHost): SavedConnection | null => {
    if (typeof stored.url !== 'string') return null
    const saved: SavedConnection = { url: stored.url, method: stored.method, username: stored.username, ...(stored.combined ? { combined: true } : {}), ...names(stored) }
    if (stored.secrets && safeStorage.isEncryptionAvailable()) {
      try {
        const secrets = JSON.parse(safeStorage.decryptString(Buffer.from(stored.secrets, 'base64'))) as Partial<SavedConnection>
        saved.password = secrets.password
        saved.token = secrets.token
        saved.cookies = secrets.cookies
        // A grant that no longer reads as one is dropped here, so the host asks to sign in again at once.
        saved.oidc = secrets.oidc === undefined ? undefined : storedGrant(secrets.oidc)
        saved.headers = secrets.headers
      } catch {
        // Encrypted by another user or machine: sign in again.
        return null
      }
    } else if (stored.method !== 'open') {
      return null
    }
    return saved
  }

  const encode = (connection: SavedConnection): StoredHost | null => {
    const stored: StoredHost = { url: connection.url, method: connection.method, username: connection.username, ...(connection.combined ? { combined: true } : {}), ...names(connection) }
    if (connection.method !== 'open' || connection.headers) {
      // Without the keychain the secrets stay in memory for this launch only.
      if (!safeStorage.isEncryptionAvailable()) return null
      const secrets = { password: connection.password, token: connection.token, cookies: connection.cookies, headers: connection.headers, oidc: connection.oidc }
      stored.secrets = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64')
    }
    return stored
  }

  const read = (): { hosts: SavedConnection[]; active: string | null } => {
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch (e) {
      // Nothing saved yet, or there but not readable (kept beside it before a save replaces it).
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') keepUnreadable(path)
      return { hosts: [], active: null }
    }
    try {
      const raw = JSON.parse(text) as StoredFile | StoredFileV1
      if (raw.version === 1) {
        const one = decode(raw)
        return one ? { hosts: [one], active: one.url } : { hosts: [], active: null }
      }
      if (raw.version === 2 && Array.isArray(raw.hosts)) {
        return { hosts: raw.hosts.map(decode).filter((h): h is SavedConnection => h !== null), active: raw.active }
      }
    } catch {
      // Unreadable: kept below.
    }
    // There but not a hosts file this build reads (torn, or from a newer build): kept beside it before a save replaces it.
    keepUnreadable(path)
    return { hosts: [], active: null }
  }

  const persist = (hosts: SavedConnection[], active: string | null) => {
    if (!hosts.length) {
      rmSync(path, { force: true })
      return
    }
    const file: StoredFile = { version: 2, active, hosts: hosts.map(encode).filter((h): h is StoredHost => h !== null) }
    writeFileAtomic(path, JSON.stringify(file, null, 2), 0o600)
  }

  // Read on first use, not here: this runs before the app is ready, and until
  // then the keychain can't decrypt (Windows says encryption isn't available),
  // which would drop every saved host.
  let list: ConnectionStore | null = null
  const hosts = (): ConnectionStore => (list ??= createHostList(persist, read()))
  return {
    load: () => hosts().load(),
    save: connection => hosts().save(connection),
    clear: () => hosts().clear(),
    list: () => hosts().list!(),
    activate: url => hosts().activate!(url),
    remove: url => hosts().remove!(url),
    get: url => hosts().get!(url),
    update: connection => hosts().update!(connection),
    setCombined: (url, on) => hosts().setCombined!(url, on),
    rename: (url, name) => hosts().rename!(url, name),
    setHermesName: (url, name) => hosts().setHermesName!(url, name),
    replace: (from, connection) => hosts().replace!(from, connection),
    pendingSignOuts: () => readPending(),
    savePendingSignOut: entry => {
      const list = readPending().filter(p => !(p.url === entry.url && p.refreshToken === entry.refreshToken))
      writePending([...list, entry])
    },
    clearPendingSignOut: (url, refreshToken) =>
      writePending(readPending().filter(p => !(p.url === url && p.refreshToken === refreshToken)))
  }
}
