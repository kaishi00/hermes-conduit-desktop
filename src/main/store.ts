/**
 * Keeps the signed-in Hermes hosts between launches, in the app's data
 * folder, and which one is open. The passwords, tokens and cookies are
 * encrypted with the system keychain (Keychain on the Mac, DPAPI on Windows)
 * through Electron's safeStorage. Where that isn't available they're kept for
 * this launch only.
 */
import { app, safeStorage } from 'electron'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConnectionStore, SavedConnection } from './connection'
import { createHostList } from './hosts'

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
      const secrets = { password: connection.password, token: connection.token, cookies: connection.cookies, headers: connection.headers }
      stored.secrets = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64')
    }
    return stored
  }

  const read = (): { hosts: SavedConnection[]; active: string | null } => {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as StoredFile | StoredFileV1
      if (raw.version === 1) {
        const one = decode(raw)
        return one ? { hosts: [one], active: one.url } : { hosts: [], active: null }
      }
      if (raw.version === 2 && Array.isArray(raw.hosts)) {
        return { hosts: raw.hosts.map(decode).filter((h): h is SavedConnection => h !== null), active: raw.active }
      }
    } catch {
      // Nothing saved yet.
    }
    return { hosts: [], active: null }
  }

  const persist = (hosts: SavedConnection[], active: string | null) => {
    if (!hosts.length) {
      rmSync(path, { force: true })
      return
    }
    const file: StoredFile = { version: 2, active, hosts: hosts.map(encode).filter((h): h is StoredHost => h !== null) }
    writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 })
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
    replace: (from, connection) => hosts().replace!(from, connection)
  }
}
