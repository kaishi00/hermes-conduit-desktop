import { describe, expect, it } from 'vitest'
import type { Fetch } from '../src/main/auth'
import { createHostList } from '../src/main/hosts'
import { KEPT_BACKOFF, KEPT_RPC_METHODS, KeptHosts, MAX_KEPT } from '../src/main/keptHosts'
import { Connection, type SavedConnection } from '../src/main/connection'
import type { ConnectionStatus, KeptHost } from '../src/shared/ipc'
import type { WebSocketLike } from '../src/vendor/hermes-shared/json-rpc-gateway'
import {
  badgeColor,
  BADGE_PALETTE,
  hostBadge,
  launchRows,
  openAfterSwitch,
  openBotAfterSwitch,
  openChatAfterSwitch,
  otherHostsChats,
  keptChatsPath,
  mergeKeptChats,
  combinedRooms,
  openRoomAfterSwitch,
  takeRoomAfterSwitch,
  ROOM_AFTER_SWITCH_MS,
  KEPT_CHATS_PER_PROFILE,
  otherHostsWaiting,
  profileNames,
  pulseChips,
  takeBotAfterSwitch,
  takeChatAfterSwitch,
  takeOpenAfterSwitch,
  type KeptWaitingRow,
  type OtherChatRow
} from '../src/renderer/src/state/keptHosts'
import type { WaitingRow } from '../src/renderer/src/state/needsYou'
import type { Room } from '../src/renderer/src/state/groups'
import type { RoomCopy } from '../src/renderer/src/state/roomCopies'

class FakeSocket extends EventTarget {
  readyState = 0
  constructor(readonly url: string) {
    super()
    setTimeout(() => {
      if (this.readyState === 3) return
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
    }, 0)
  }
  send() {}
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }))
  }
  serverSends(frame: unknown) {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(frame) }))
  }
  drop() {
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1006 }))
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) await tick()
}

const host = (url: string, extra: Partial<SavedConnection> = {}): SavedConnection => ({ url, method: 'token', token: 't', combined: true, ...extra })
const open = (url: string): ConnectionStatus => ({ phase: 'open', url })

function harness(hosts: SavedConnection[], opts: { refuse?: string[]; down?: string[] } = {}) {
  const written: SavedConnection[][] = []
  const store = createHostList(list => written.push(list), { hosts, active: hosts[0]?.url ?? null })
  const sockets: FakeSocket[] = []
  const changes: KeptHost[][] = []
  const timers: { fn: () => void; ms: number }[] = []
  const fetchImpl: Fetch = async input => {
    const url = new URL(String(input))
    const origin = url.origin
    if (opts.down?.includes(origin)) throw new TypeError('fetch failed')
    if (url.pathname === '/auth/password-login') {
      if (opts.refuse?.includes(origin)) return json({ detail: 'Bad password' }, 401)
      return json({ ok: true }, 200, { 'Set-Cookie': 'hermes_session=s1; Path=/' })
    }
    if (url.pathname === '/api/auth/ws-ticket') return opts.refuse?.includes(origin) ? json({ detail: 'Not authenticated' }, 401) : json({ ticket: 'T' })
    if (url.pathname === '/api/profiles') return json({ profiles: [{ name: 'default' }, { name: 'mira' }] })
    return json({ detail: 'Not Found' }, 404)
  }
  const kept = new KeptHosts({
    fetch: fetchImpl,
    store,
    createSocket: url => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket as unknown as WebSocketLike
    },
    onChange: list => changes.push(list),
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: () => undefined
  })
  const state = (url: string) => kept.list().find(h => h.url === url)?.state
  return { kept, store, sockets, changes, timers, written, state }
}

describe('combined dashboards in the main process', () => {
  it("connects the group's others once the one on screen has, and drops their events", async () => {
    const h = harness([host('https://a.example'), host('https://b.example'), host('https://c.example')])
    h.kept.sync({ phase: 'connecting', url: 'https://a.example' })
    expect(h.kept.list()).toEqual([])
    h.kept.sync(open('https://a.example'))
    expect(h.kept.list().map(k => k.url)).toEqual(['https://b.example', 'https://c.example'])
    await until(() => h.state('https://b.example') === 'live' && h.state('https://c.example') === 'live')
    expect(h.kept.list()).toEqual([
      { url: 'https://b.example', state: 'live' },
      { url: 'https://c.example', state: 'live' }
    ])
    expect(h.sockets.map(s => new URL(s.url).host)).toEqual(['b.example', 'c.example'])
    // Reads go through the kept connection.
    expect(await h.kept.http('https://b.example', '/api/profiles')).toEqual({ profiles: [{ name: 'default' }, { name: 'mira' }] })
    // Only reads go over a kept socket.
    await expect(h.kept.rpc('https://b.example', 'prompt.submit', {})).rejects.toThrow(/Only reads/)
    await expect(h.kept.rpc('https://b.example', 'profiles.set_asset', {})).rejects.toThrow(/Only reads/)
    // Its bots' pictures are a read, and so is its list of group chats.
    expect(KEPT_RPC_METHODS).toEqual(['profiles.list', 'profiles.get_asset', 'groups.list'])
    await expect(h.kept.rpc('https://d.example', 'profiles.list')).rejects.toThrow(/Not connected/)
  })

  it('needs two in the group, keeps at most three beside the one on screen, and connects beside one left out', async () => {
    const one = harness([host('https://a.example', { combined: undefined }), host('https://b.example')])
    one.kept.sync(open('https://a.example'))
    expect(one.kept.list()).toEqual([])

    const urls = ['a', 'b', 'c', 'd', 'e', 'f'].map(n => `https://${n}.example`)
    const many = harness([host('https://z.example', { combined: undefined }), ...urls.map(u => host(u))])
    many.kept.sync(open('https://z.example'))
    expect(many.kept.list().map(k => k.url)).toEqual(urls.slice(0, MAX_KEPT))
  })

  it('lets the switch target go and keeps the one left, once the new one has connected', async () => {
    const h = harness([host('https://a.example'), host('https://b.example')])
    h.kept.sync(open('https://a.example'))
    await until(() => h.state('https://b.example') === 'live')
    const socket = h.sockets[0]!
    h.kept.sync({ phase: 'connecting', url: 'https://b.example' })
    expect(h.kept.list()).toEqual([])
    expect(socket.readyState).toBe(3)
    h.kept.sync(open('https://b.example'))
    expect(h.kept.list().map(k => k.url)).toEqual(['https://a.example'])
  })

  it('lets everything go on sign-out, a lock, or the group dropping under two', async () => {
    const h = harness([host('https://a.example'), host('https://b.example')])
    h.kept.sync(open('https://a.example'))
    await until(() => h.state('https://b.example') === 'live')
    h.kept.sync({ phase: 'locked' })
    expect(h.kept.list()).toEqual([])
    h.kept.sync(open('https://a.example'))
    expect(h.kept.list()).toHaveLength(1)
    h.store.setCombined!('https://b.example', false)
    h.kept.sync(open('https://a.example'))
    expect(h.kept.list()).toEqual([])
    expect(h.changes.at(-1)).toEqual([])
  })

  it('says a refused sign-in needs a tap, and tries one that is down again on the long backoff', async () => {
    const h = harness([host('https://a.example'), host('https://b.example', { method: 'password', username: 'e', password: 'x', token: undefined }), host('https://c.example', { method: 'open', token: undefined })], {
      refuse: ['https://b.example'],
      down: ['https://c.example']
    })
    h.kept.sync(open('https://a.example'))
    await until(() => h.state('https://b.example') === 'signIn' && h.state('https://c.example') === 'down')
    expect(h.state('https://b.example')).toBe('signIn')
    expect(h.state('https://c.example')).toBe('down')
    // Only the one that's down waits on a retry, 30 s first.
    expect(h.timers.map(t => t.ms)).toEqual([KEPT_BACKOFF.baseDelayMs])
  })

  it('saves a kept host’s new cookies without opening it, and a sign-in again keeps it combined', () => {
    const h = harness([host('https://a.example'), host('https://b.example')])
    h.store.update!({ ...host('https://b.example'), combined: undefined, cookies: { s: '2' } })
    expect(h.store.load()!.url).toBe('https://a.example')
    expect(h.store.get!('https://b.example')).toMatchObject({ cookies: { s: '2' }, combined: true })
    h.store.save({ url: 'https://b.example', method: 'token', token: 'new' })
    expect(h.store.list!().find(x => x.url === 'https://b.example')).toMatchObject({ combined: true })
  })
})

describe('switching to a kept combined host', () => {
  /** The window's connection beside the kept hosts, sharing their store and sockets, wired as index.ts wires them. */
  function windowHarness(hosts: SavedConnection[]) {
    const h = harness(hosts)
    const statuses: ConnectionStatus[] = []
    const events: string[] = []
    const requests: string[][] = []
    const connection = new Connection({
      fetch: async () => json({}),
      store: h.store,
      createSocket: url => {
        const socket = new FakeSocket(url)
        h.sockets.push(socket)
        return socket as unknown as WebSocketLike
      },
      onStatus: status => {
        statuses.push(status)
        h.kept.sync(status)
      },
      onEvent: event => events.push(event.type),
      onRequests: list => requests.push(list.map(r => r.id))
    })
    return { ...h, connection, statuses, events, requests }
  }

  it('takes up the kept socket rather than dialing again, and keeps the one left beside it', async () => {
    const h = windowHarness([host('https://a.example'), host('https://b.example')])
    await h.connection.restore()
    await until(() => h.connection.current().phase === 'open' && h.state('https://b.example') === 'live')
    const bSocket = h.sockets.find(s => new URL(s.url).host === 'b.example')!
    const aSocket = h.sockets.find(s => new URL(s.url).host === 'a.example')!
    // A question asked on B while it was kept comes along.
    bSocket.serverSends({ jsonrpc: '2.0', id: 'srq-b', method: 'approval', params: { session_id: 's1' } })
    const before = h.sockets.length
    expect(h.connection.switchHost('https://b.example', url => h.kept.take(url))).toBe(true)
    // Open at once, on B's own socket, with no dial for B.
    expect(h.connection.current()).toMatchObject({ phase: 'open', url: 'https://b.example' })
    expect(h.statuses.filter(s => s.url === 'https://b.example').map(s => s.phase)).toEqual(['open'])
    expect(h.sockets.slice(before).some(s => new URL(s.url).host === 'b.example')).toBe(false)
    expect(h.requests.at(-1)).toEqual(['srq-b'])
    expect(aSocket.readyState).toBe(3)
    // B's events now reach the window.
    bSocket.serverSends({ jsonrpc: '2.0', method: 'event', params: { type: 'message.delta', session_id: 's1', payload: {} } })
    expect(h.events).toContain('message.delta')
    // A is kept beside it now, on a socket of its own.
    await until(() => h.state('https://a.example') === 'live')
    expect(h.kept.list()).toEqual([{ url: 'https://a.example', state: 'live' }])
    // B dropping is the window's to redial.
    bSocket.drop()
    expect(h.connection.current()).toMatchObject({ phase: 'reconnecting', url: 'https://b.example' })
  })

  it('dials as usual when the kept host isn’t connected', async () => {
    const h = windowHarness([host('https://a.example'), host('https://b.example')])
    await h.connection.restore()
    await until(() => h.connection.current().phase === 'open')
    // B hasn't connected yet.
    expect(h.kept.take('https://b.example')).toBeNull()
    expect(h.connection.switchHost('https://b.example', url => h.kept.take(url))).toBe(true)
    expect(h.connection.current()).toMatchObject({ phase: 'connecting', url: 'https://b.example' })
    await until(() => h.connection.current().phase === 'open')
    expect(h.connection.current().url).toBe('https://b.example')
  })
})

describe('combined dashboards in the window', () => {
  const hosts = [
    { url: 'https://home.example', method: 'open' as const, combined: true },
    { url: 'https://alone.example', method: 'open' as const },
    { url: 'https://studio.example', method: 'open' as const, combined: true }
  ]
  const name = (url: string) => new URL(url).host

  it('badges only the group, by place in the saved order', () => {
    expect(hostBadge(hosts, 'https://home.example', name)).toEqual({ letter: 'H', color: BADGE_PALETTE[0], name: 'home.example' })
    expect(hostBadge(hosts, 'https://studio.example', name)).toMatchObject({ letter: 'S', color: BADGE_PALETTE[1] })
    expect(hostBadge(hosts, 'https://alone.example', name)).toBeNull()
    expect(hostBadge([hosts[0]!], 'https://home.example', name)).toBeNull()
  })

  it('gives a seventh member a hue of its own', () => {
    const seventh = badgeColor(6)
    expect(seventh).toMatch(/^hsl\(/)
    expect(badgeColor(7)).not.toBe(seventh)
  })

  it('reads profile names, adding default, and treats an empty list as no answer', () => {
    expect(profileNames({ profiles: [{ name: 'mira' }, 'kai'] })).toEqual(['default', 'mira', 'kai'])
    expect(profileNames({ profiles: [] })).toBeNull()
    expect(profileNames({ detail: 'x' })).toBeNull()
  })

  const row = (id: string, host?: string): WaitingRow & { host?: string } => ({ id, kind: 'question', sessionIds: ['s'], title: 'T', summary: '', questions: 1, at: 1, ...(host ? { host } : {}) })

  it('shows a wait once when two hosts are one Hermes, as this host’s', () => {
    const kept = [row('w1', 'https://studio.example'), row('w2', 'https://studio.example'), row('w2', 'https://other.example')] as KeptWaitingRow[]
    expect(otherHostsWaiting(kept, [row('w1')]).map(r => `${r.id}@${r.host}`)).toEqual(['w2@https://studio.example'])
  })

  it('hands a wait opened on another host to that host’s window after the switch', () => {
    openAfterSwitch(row('w9', 'https://studio.example') as KeptWaitingRow)
    expect(takeOpenAfterSwitch('https://home.example')).toBeNull()
    expect(takeOpenAfterSwitch('https://studio.example')).toEqual(row('w9'))
    expect(takeOpenAfterSwitch('https://studio.example')).toBeNull()
  })

  const chat = (id: string, host?: string) => ({ id, title: id, pinned: false, ...(host ? { host } : {}) })

  it('lists another host’s chat once, and not one this host lists too', () => {
    const other = [chat('c1', 'https://studio.example'), chat('c2', 'https://studio.example'), chat('c2', 'https://third.example')] as OtherChatRow[]
    expect(otherHostsChats(other, [chat('c1')]).map(r => `${r.id}@${r.host}`)).toEqual(['c2@https://studio.example'])
    expect(otherHostsChats(other, null)).toHaveLength(2)
  })

  it('reads 50 of each of another host’s profiles, newest first, each chat once', () => {
    expect(KEPT_CHATS_PER_PROFILE).toBe(50)
    const path = new URL(`https://x${keptChatsPath('mira bot')}`)
    expect(path.pathname).toBe('/api/profiles/sessions')
    expect(path.searchParams.get('limit')).toBe('50')
    expect(path.searchParams.get('profile')).toBe('mira bot')
    expect(path.searchParams.get('archived')).toBe('exclude')
    const page = (rows: [string, string, number][]) => ({ sessions: rows.map(([id, profile, at]) => ({ id, title: id, profile, last_active: at, message_count: 3 })) })
    const merged = mergeKeptChats('https://studio.example', [
      page([['d1', 'default', 300], ['d2', 'default', 100]]),
      // A Hermes that ignores `profile` answers every profile again.
      page([['m1', 'mira', 200], ['d1', 'default', 300]])
    ])
    expect(merged.map(r => `${r.id}@${r.host}`)).toEqual(['d1@https://studio.example', 'm1@https://studio.example', 'd2@https://studio.example'])
    expect(merged.every(r => !r.pinned)).toBe(true)
  })

  it('opens another host’s chat in that host’s window after the switch', () => {
    openChatAfterSwitch(chat('c3', 'https://studio.example') as OtherChatRow)
    expect(takeChatAfterSwitch('https://home.example')).toBeNull()
    expect(takeChatAfterSwitch('https://studio.example')).toEqual(chat('c3'))
    expect(takeChatAfterSwitch('https://studio.example')).toBeNull()
  })

  it('opens another host’s bot once that host’s bots are read', () => {
    const bot = { name: 'mira', title: 'Mira' } as never
    openBotAfterSwitch({ host: 'https://studio.example', bot })
    expect(takeBotAfterSwitch('https://studio.example', null)).toBeNull()
    expect(takeBotAfterSwitch('https://home.example', [bot])).toBeNull()
    expect(takeBotAfterSwitch('https://studio.example', [bot])).toBe(bot)
    expect(takeBotAfterSwitch('https://studio.example', [bot])).toBeNull()
  })

  it('gives Pulse a chip per combined host that answers, only when another has one', () => {
    const counts = new Map([['https://studio.example', 3]])
    const chips = pulseChips(hosts, 'https://home.example', 1, counts, name)
    expect(chips.map(c => [c.badge.letter, c.count, c.current])).toEqual([
      ['H', 1, true],
      ['S', 3, false]
    ])
    expect(pulseChips(hosts, 'https://home.example', 1, new Map(), name)).toEqual([])
    // A host left out of the group gets no chip, so one other host alone has none.
    expect(pulseChips(hosts, 'https://alone.example', 0, counts, name)).toEqual([])
  })

  it('lists the group as one row where its first member stands, opening the one used last', () => {
    const rows = launchRows(hosts, 'https://studio.example')
    expect(rows.map(r => (r.kind === 'group' ? `group:${r.members.length}>${r.opens}` : r.host.url))).toEqual(['group:2>https://studio.example', 'https://alone.example'])
    expect(launchRows(hosts, null)[0]).toMatchObject({ kind: 'group', opens: 'https://home.example' })
    expect(launchRows([hosts[0]!, hosts[1]!], null).every(r => r.kind === 'host')).toBe(true)
  })
})

describe('group chats in a combined group', () => {
  const member = (memberId: string) => ({ memberId, profile: memberId })
  const room = (roomId: string, members: string[], updatedAt = 1): Room => ({
    roomId,
    name: roomId,
    members: members.map(member),
    updatedAt,
    disbanded: false,
    linked: false
  })
  const copy = (roomId: string, members: string[]): RoomCopy => ({
    id: `lk-${roomId}/${roomId}`,
    roomId,
    name: roomId,
    link: `lk-${roomId}`,
    from: 'Sam',
    members: members.map(m => ({ memberId: m })),
    yours: [],
    justMe: false,
    status: 'started',
    reason: null,
    working: false,
    activity: [],
    lastSeq: 1,
    updatedAt: 1,
    out: {}
  })
  const mac = 'https://mac.example'
  const vps = 'https://vps.example'

  it('shows each room once, under the host you talk in it from (Eric, 2026-11-20)', () => {
    // Mac hosts "trip" (one of VPS' bots in it over the own Link) and
    // "plans", and has a copy of Sam's "zoo"; VPS, on screen, has copies of
    // "trip", "zoo" and "solo".
    const kept = new Map([[mac, { rooms: [room('trip', ['raiden', 'furina'], 2), room('plans', ['raiden'], 3)], copies: [copy('zoo', ['sam', 'nahida'])] }]])
    const here = [copy('trip', ['raiden', 'furina']), copy('zoo', ['sam', 'nahida']), copy('solo', ['sam'])]
    const shown = combinedRooms(vps, [mac, vps], [room('standup', ['furina'])], here, kept)
    expect(shown.copies.map(c => c.roomId)).toEqual(['solo'])
    expect(shown.others.map(o => `${o.kind}:${o.kind === 'room' ? o.room.roomId : o.copy.roomId}@${o.host}`)).toEqual([
      `room:plans@${mac}`,
      `room:trip@${mac}`,
      `copy:zoo@${mac}`
    ])
    // A room id another Hermes uses for another room (no member shared) isn't the same room.
    expect(combinedRooms(vps, [mac, vps], [], [copy('plans', ['sam'])], kept).copies.map(c => c.roomId)).toEqual(['plans'])
    // One Hermes saved at two addresses: a room both list shows once, as this host's.
    expect(combinedRooms(vps, [mac, vps], [room('plans', ['raiden'])], [], kept).others.some(o => o.kind === 'room' && o.room.roomId === 'plans')).toBe(false)
    // A copy an agent of yours waits in for your approval stays, since only its row answers it.
    expect(combinedRooms(vps, [mac, vps], [], here, kept, new Set([here[0].id])).copies.map(c => c.roomId)).toEqual(['trip', 'solo'])
    // Nothing kept: this host's copies as they are.
    expect(combinedRooms(vps, [mac, vps], [], here, new Map()).copies).toHaveLength(3)
  })

  it('opens another host\'s group chat once the new host has read it', () => {
    openRoomAfterSwitch({ host: mac, kind: 'room', room: room('trip', ['raiden']) })
    expect(takeRoomAfterSwitch(vps, [room('trip', ['raiden'])], [])).toBeNull()
    expect(takeRoomAfterSwitch(mac, null, null)).toBeNull()
    expect(takeRoomAfterSwitch(mac, [room('trip', ['raiden'])], null)).toEqual({ room: room('trip', ['raiden']) })
    expect(takeRoomAfterSwitch(mac, [room('trip', ['raiden'])], null)).toBeNull()
    // A copy waits through an early empty list (its plugin's routes not read yet) for one that holds it.
    openRoomAfterSwitch({ host: mac, kind: 'copy', copy: copy('zoo', ['sam']) }, 1_000)
    expect(takeRoomAfterSwitch(mac, [], null, 1_100)).toBeNull()
    expect(takeRoomAfterSwitch(mac, [], [], 1_200)).toBeNull()
    expect(takeRoomAfterSwitch(mac, [], [copy('zoo', ['sam'])], 1_300)).toEqual({ copy: copy('zoo', ['sam']) })
    expect(takeRoomAfterSwitch(mac, [], [copy('zoo', ['sam'])], 1_400)).toBeNull()
    // ...but not forever: one its host no longer lists is dropped.
    openRoomAfterSwitch({ host: mac, kind: 'copy', copy: copy('zoo', ['sam']) }, 1_000)
    expect(takeRoomAfterSwitch(mac, [], [], 1_000 + ROOM_AFTER_SWITCH_MS + 1)).toBeNull()
    expect(takeRoomAfterSwitch(mac, [], [copy('zoo', ['sam'])], 1_000 + ROOM_AFTER_SWITCH_MS + 2)).toBeNull()
  })
})

describe('New Bot on another combined dashboard', () => {
  it('carries the sheet over the switch to that host only, once', async () => {
    const { newBotAfterSwitch, takeNewBotAfterSwitch } = await import('../src/renderer/src/state/keptHosts')
    const bot = { name: 'Scout', description: 'Finds things', soul: '', face: 3, picture: null, shareAuth: true }
    newBotAfterSwitch('https://b.example', bot)
    expect(takeNewBotAfterSwitch('https://a.example')).toBeNull()
    expect(takeNewBotAfterSwitch('https://b.example')).toEqual(bot)
    expect(takeNewBotAfterSwitch('https://b.example')).toBeNull()
  })
})
