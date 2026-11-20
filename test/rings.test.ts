import { describe, expect, it } from 'vitest'
import { declineBody, freshRings, holdCallPresence, PRESENCE_CAPABILITY, PRESENCE_S, ringChanges, ringsFrom } from '../src/renderer/src/state/rings'
import { askPluginStatus, type PluginStatus } from '../src/renderer/src/state/plugin'

describe('calls from Hermes on this computer', () => {
  const body = {
    ok: true,
    now: 1000,
    rings: [
      { id: 'watch_old', kind: 'done', name: 'Atlas', heading: 'Atlas wants to talk', body: 'Old', session_ids: ['s0'], at: 900 },
      {
        id: 'watch_new',
        kind: 'done',
        name: 'Atlas',
        heading: 'Atlas wants to talk',
        body: 'It shipped.',
        reason: '',
        title: 'Deploy',
        session_ids: ['rt', 'st'],
        at: 990
      },
      { id: '', at: 999 },
      { id: 'watch_noat' }
    ]
  }

  it('reads the host’s rings and its clock', () => {
    const { rings, now } = ringsFrom(body, 'work')
    expect(now).toBe(1000)
    expect(rings.map(r => r.id)).toEqual(['watch_old', 'watch_new'])
    expect(rings[1]).toMatchObject({ profile: 'work', name: 'Atlas', body: 'It shipped.', sessionIds: ['rt', 'st'], title: 'Deploy' })
  })

  it('rings only for calls that just went out when it first asks', () => {
    const { rings, now } = ringsFrom(body)
    expect(freshRings(rings, now).map(r => r.id)).toEqual(['watch_new'])
    expect(freshRings(rings, null)).toEqual([])
  })

  it('stops a ring settled on another device and starts only new ringing ones', () => {
    const { rings } = ringsFrom({
      now: 1000,
      rings: [
        { id: 'watch_a', session_ids: ['s1'], at: 990, state: 'answered' },
        { id: 'watch_b', session_ids: ['s2'], at: 995, state: 'ringing' },
        { id: 'watch_c', session_ids: ['s3'], at: 996, state: 'declined' },
        { id: 'watch_d', session_ids: ['s4'], at: 997 }
      ]
    })
    expect(rings.map(r => r.state)).toEqual(['answered', 'ringing', 'declined', 'ringing'])
    expect(ringChanges(rings, new Set(['watch_d']))).toEqual({ added: [rings[1]], settled: ['watch_a', 'watch_c'] })
    expect(freshRings(rings, 1000).map(r => r.id)).toEqual(['watch_b', 'watch_d'])
  })

  it('declines as the iPhone reports a decline', () => {
    const [ring] = ringsFrom({ now: 1, rings: [{ id: 'watch_a', kind: 'done', title: 'Deploy', reason: 'Shipped', session_ids: ['s1'], at: 1 }] }).rings
    expect(declineBody(ring)).toEqual({
      call_id: 'watch_a',
      session_ids: ['s1'],
      outcome: 'declined',
      kind: 'done',
      title: 'Deploy',
      reason: 'Shipped',
      age_s: 0
    })
  })

  it('reports a miss itself only when no iPhone is paired', () => {
    const raw = [{ id: 'watch_a', session_ids: ['s1'], at: 1 }]
    const [alone] = ringsFrom({ now: 1, paired: false, rings: raw }).rings
    expect(alone.reportsMiss).toBe(true)
    expect(declineBody(alone, 'missed')).toMatchObject({ call_id: 'watch_a', outcome: 'missed' })
    expect(ringsFrom({ now: 1, paired: true, rings: raw }).rings[0].reportsMiss).toBe(false)
    // An older plugin says nothing: its calls rang an iPhone.
    expect(ringsFrom({ now: 1, rings: raw }).rings[0].reportsMiss).toBe(false)
  })
})

describe('call presence', () => {
  const reported = (capabilities: string[]): PluginStatus => ({
    state: 'reported',
    version: '0.187.0',
    loadedVersion: '0.187.0',
    restartNeeded: false,
    capabilities,
    managedBy: null,
    degraded: []
  })
  const clock = () => {
    let tick = () => {}
    return { every: (_ms: number, t: () => void) => ((tick = t), () => (tick = () => {})), tick: () => tick() }
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))

  it('asks again at the next renewal after an ask that couldn’t tell, then holds', async () => {
    const answers: (PluginStatus | null)[] = [null, reported([PRESENCE_CAPABILITY])]
    const holds: number[] = []
    const c = clock()
    const stop = holdCallPresence(async () => answers.shift() ?? null, async s => void holds.push(s), c.every)
    await settle()
    expect(holds).toEqual([])
    c.tick()
    await settle()
    expect(holds).toEqual([PRESENCE_S])
    c.tick()
    await settle()
    expect(holds).toEqual([PRESENCE_S, PRESENCE_S])
    stop()
    expect(holds).toEqual([PRESENCE_S, PRESENCE_S, 0])
  })

  it('holds nothing on a plugin that answers without presence, and stops asking', async () => {
    let asks = 0
    const holds: number[] = []
    const c = clock()
    const stop = holdCallPresence(async () => (asks++, reported(['call-rings'])), async s => void holds.push(s), c.every)
    await settle()
    c.tick()
    c.tick()
    await settle()
    stop()
    expect(asks).toBe(1)
    expect(holds).toEqual([])
  })

  it('a 404 counts as an answer, anything else is asked again', async () => {
    expect(await askPluginStatus(() => Promise.reject(Object.assign(new Error('nope'), { code: 404 })))).toEqual({ state: 'missing' })
    expect(await askPluginStatus(() => Promise.reject(Object.assign(new Error('busy'), { code: 503 })))).toBeNull()
    expect(await askPluginStatus(() => Promise.reject(new Error('timed out')))).toBeNull()
    expect(await askPluginStatus(() => Promise.resolve('<html>'))).toBeNull()
    expect(await askPluginStatus(() => Promise.resolve({ capabilities: ['x'] }))).toMatchObject({ state: 'reported', capabilities: ['x'] })
  })
})
