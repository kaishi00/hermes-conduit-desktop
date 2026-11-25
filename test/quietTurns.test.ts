import { describe, expect, it } from 'vitest'
import { keptQuiet, parseQuietTurn, quietTurnsPath, QUIET_RETRY_MS } from '../src/renderer/src/state/quietTurns'

const answers = (...bodies: unknown[]) => {
  const asked: string[] = []
  const http = async (_method: 'GET' | 'PUT', path: string) => {
    asked.push(path)
    const body = bodies.length > 1 ? bodies.shift() : bodies[0]
    if (body instanceof Error) throw body
    return body
  }
  return { http, asked }
}
const turn = (quiet: boolean, age_s: number) => ({ ok: true, turn: { session_id: 's', quiet, age_s } })
const noWait = async () => {}

describe('quiet turns', () => {
  it('asks under every id of the chat, and its profile unless the default', () => {
    expect(quietTurnsPath(['a', 'b c'])).toBe('/api/plugins/conduit_push/notifications/quiet-turns?session_id=a&session_id=b%20c')
    expect(quietTurnsPath(['a'], 'work')).toMatch(/session_id=a&profile=work$/)
    expect(quietTurnsPath(['a'], 'default')).not.toMatch(/profile/)
  })

  it('reads only a well-formed answer', () => {
    expect(parseQuietTurn(turn(true, 1))).toEqual({ quiet: true, ageS: 1 })
    expect(parseQuietTurn({ turn: null })).toBeNull()
    expect(parseQuietTurn({ turn: { quiet: 'yes', age_s: 1 } })).toBeNull()
  })

  it("keeps quiet a turn the plugin sent no push for, and notifies one it did", async () => {
    const now = () => 10_000
    expect(await keptQuiet(answers(turn(true, 2)).http, ['s'], [undefined], 5_000, now, noWait)).toBe(true)
    expect(await keptQuiet(answers(turn(false, 2)).http, ['s'], [undefined], 5_000, now, noWait)).toBe(false)
  })

  it("never takes an earlier turn's decision as this one's: it asks once more, then notifies", async () => {
    const now = () => 10_000
    const waits: number[] = []
    const wait = async (ms: number) => void waits.push(ms)
    // Started 5 s ago; the kept decision is 60 s old, from the turn before.
    const stale = answers(turn(true, 60))
    expect(await keptQuiet(stale.http, ['s'], [undefined], 5_000, now, wait)).toBe(false)
    expect(stale.asked).toHaveLength(2)
    expect(waits).toEqual([QUIET_RETRY_MS])
    // This turn's decision landed by the second ask.
    expect(await keptQuiet(answers({ turn: null }, turn(true, 1)).http, ['s'], [undefined], 5_000, now, noWait)).toBe(true)
  })

  it('lets the notification through when the plugin is older or the chat unknown, with no wait', async () => {
    const old = answers(new Error('404'))
    expect(await keptQuiet(old.http, ['s'], [undefined], 5_000, Date.now, noWait)).toBe(false)
    expect(old.asked).toHaveLength(1)
    expect(await keptQuiet(answers(turn(true, 1)).http, [], [undefined], 5_000, Date.now, noWait)).toBe(false)
  })

  it('asks each profile a chat might be under, and any quiet one holds it', async () => {
    const http = async (_m: 'GET' | 'PUT', path: string) => (path.includes('profile=work') ? turn(true, 1) : { turn: null })
    expect(await keptQuiet(http, ['s'], ['default', 'work'], null, Date.now, noWait)).toBe(true)
  })
})
