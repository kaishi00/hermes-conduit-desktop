import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ dir: '', ready: false }))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: {
    // As on Windows: nothing decrypts until the app is ready.
    isEncryptionAvailable: () => state.ready,
    encryptString: (text: string) => Buffer.from(`enc:${text}`),
    decryptString: (data: Buffer) => {
      const text = data.toString()
      if (!state.ready || !text.startsWith('enc:')) throw new Error('not available')
      return text.slice(4)
    }
  }
}))

const { createFileStore } = await import('../src/main/store')
const { writeFileAtomic } = await import('../src/main/atomicWrite')
const secrets = (value: object) => Buffer.from(`enc:${JSON.stringify(value)}`).toString('base64')

describe('the saved hosts file', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'conduit-store-'))
    state.ready = false
  })

  it('made before the app is ready, still opens the sign-in an earlier build saved', () => {
    writeFileSync(join(state.dir, 'connection.json'), JSON.stringify({ version: 1, url: 'http://h:9119', method: 'password', username: 'admin', secrets: secrets({ password: 'pw' }) }))
    const store = createFileStore()
    state.ready = true
    expect(store.load()).toMatchObject({ url: 'http://h:9119', method: 'password', username: 'admin', password: 'pw' })
    expect(store.list!()).toEqual([{ url: 'http://h:9119', method: 'password', username: 'admin', name: 'h:9119' }])
  })

  it('writes a list of hosts and reads it back', () => {
    state.ready = true
    const store = createFileStore()
    store.save({ url: 'http://one', method: 'token', token: 'a' })
    store.save({ url: 'http://two', method: 'open' })
    store.activate!('http://one')
    const file = JSON.parse(readFileSync(join(state.dir, 'connection.json'), 'utf8'))
    expect(file).toMatchObject({ version: 2, active: 'http://one', hosts: [{ url: 'http://one', method: 'token' }, { url: 'http://two', method: 'open' }] })
    expect(JSON.stringify(file)).not.toContain('"a"')
    const again = createFileStore()
    expect(again.load()).toMatchObject({ url: 'http://one', token: 'a' })
    expect(again.list!().map(h => h.url)).toEqual(['http://one', 'http://two'])
  })

  it('keeps a name the person gave and one its Hermes gave through a sign-in again and a restart', () => {
    state.ready = true
    const store = createFileStore()
    store.save({ url: 'http://192.168.1.5:9119', method: 'token', token: 'a' })
    store.save({ url: 'https://furina.milim.dev', method: 'open' })
    expect(store.list!().map(h => h.name)).toEqual(['192.168.1.5:9119', 'furina.milim.dev'])
    expect(store.setHermesName!('http://192.168.1.5:9119', 'Studio')).toBe(true)
    expect(store.setHermesName!('http://192.168.1.5:9119', 'Studio')).toBe(false)
    expect(store.setHermesName!('https://furina.milim.dev', 'Raiden')).toBe(true)
    // An address that names nothing takes its Hermes' name; a DNS name keeps its own.
    expect(store.list!().map(h => h.name)).toEqual(['Studio', 'furina.milim.dev'])
    store.rename!('https://furina.milim.dev', '  Furina  ')
    store.save({ url: 'https://furina.milim.dev', method: 'open' })
    store.update!({ url: 'http://192.168.1.5:9119', method: 'token', token: 'b' })
    const again = createFileStore()
    expect(again.list!()).toMatchObject([{ name: 'Studio' }, { name: 'Furina', named: true }])
    again.rename!('https://furina.milim.dev', '')
    expect(again.list!()[1]).toMatchObject({ name: 'furina.milim.dev' })
    expect(again.list!()[1]!.named).toBeUndefined()
    // A connection's older copy of the host, written back with new cookies, keeps the rename.
    again.rename!('http://192.168.1.5:9119', 'Desk')
    const loaded = again.get!('http://192.168.1.5:9119')!
    again.rename!('http://192.168.1.5:9119', 'Bench')
    again.setHermesName!('http://192.168.1.5:9119', 'Atelier')
    again.update!({ ...loaded, token: 'c' })
    expect(again.list!()[0]).toMatchObject({ name: 'Bench', named: true })
    again.rename!('http://192.168.1.5:9119', '')
    expect(again.list!()[0]).toMatchObject({ name: 'Atelier' })
    // Edit Connection moves a host to a new address with its name.
    again.rename!('http://192.168.1.5:9119', 'Lab')
    again.replace!('http://192.168.1.5:9119', { url: 'http://192.168.1.9:9119', method: 'open' })
    expect(again.list!()[0]).toMatchObject({ url: 'http://192.168.1.9:9119', name: 'Lab' })
  })
})

describe('saving the hosts file safely (desktop#297)', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'conduit-store-'))
    state.ready = true
  })

  it('replaces the file whole and leaves no temporary file behind', () => {
    const store = createFileStore()
    store.save({ url: 'http://one', method: 'open' })
    store.save({ url: 'http://two', method: 'open' })
    expect(readdirSync(state.dir)).toEqual(['connection.json'])
  })

  it('keeps an unreadable file beside it before the next save replaces it', () => {
    const path = join(state.dir, 'connection.json')
    writeFileSync(path, '{"version":2,"active":"http://one","hosts":[{"url":"http://o')
    const store = createFileStore()
    expect(store.list!()).toEqual([])
    store.save({ url: 'http://two', method: 'open' })
    expect(readFileSync(`${path}.corrupt`, 'utf8')).toContain('"http://o')
    expect(JSON.parse(readFileSync(path, 'utf8')).hosts).toMatchObject([{ url: 'http://two' }])
  })

  it('removes its temporary file when the rename fails', () => {
    const blocked = join(state.dir, 'connection.json')
    mkdirSync(blocked)
    writeFileSync(join(blocked, 'inside'), 'x')
    expect(() => writeFileAtomic(blocked, 'new')).toThrow()
    expect(readdirSync(state.dir)).toEqual(['connection.json'])
    expect(readdirSync(blocked)).toEqual(['inside'])
  })
})
