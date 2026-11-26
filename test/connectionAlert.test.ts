// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandAlert, useAway, type Away } from '../src/renderer/src/state/connectionAlert'
import type { ConnectionPhase, KeptHost } from '../src/shared/ipc'

const hosts = [
  { url: 'https://a.example', method: 'password' as const },
  { url: 'https://b.example', method: 'password' as const }
]

function alert(phase: ConnectionPhase, away: Away, kept: KeptHost[] = [], extra: Partial<Parameters<typeof brandAlert>[0]> = {}) {
  return brandAlert({
    phase,
    away,
    currentUrl: hosts[0].url,
    hosts,
    kept,
    name: url => (url === hosts[1].url ? 'Furina' : 'Here'),
    onRetry: vi.fn(),
    onRepair: vi.fn(),
    onSignIn: vi.fn(),
    ...extra
  })
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('connection, only when something is wrong', () => {
  it('shows nothing while every Hermes is connected', () => {
    expect(alert('open', 'no', [{ url: hosts[1].url, state: 'live' }])).toBeNull()
    // A quick reconnect stays out of sight too.
    expect(alert('reconnecting', 'no')).toBeNull()
  })

  it('is a quiet ring while reconnecting, amber with the reason once it has been away a while', () => {
    const quiet = alert('reconnecting', 'shown', [], { error: 'Lost the connection.', retryInSeconds: 4 })!
    expect(quiet.tone).toBe('quiet')
    expect(quiet.text).toBe('Lost the connection. Trying again in 4s.')
    expect(quiet.here).toBe(quiet.text)
    expect(quiet.actions!.map((a: { label: string }) => a.label)).toEqual(['Try now', 'Repair Connection'])
    expect(alert('reconnecting', 'long')!.tone).toBe('warn')
    expect(alert('connecting', 'shown')!.actions).toEqual([])
  })

  it('asks for a sign-in a combined Hermes needs, and the list carries it out', () => {
    const onSignIn = vi.fn()
    const result = alert('open', 'no', [{ url: hosts[1].url, state: 'signIn' }], { onSignIn })!
    expect(result.tone).toBe('signIn')
    expect(result.actions!.map((a: { label: string }) => a.label)).toEqual(['Sign In to Furina…'])
    result.actions![0].run()
    expect(onSignIn).toHaveBeenCalledWith(hosts[1].url)
    // A sign-in outranks the Hermes you're on reconnecting, and both are offered.
    const both = alert('reconnecting', 'long', [{ url: hosts[1].url, state: 'signIn' }])!
    expect(both.tone).toBe('signIn')
    expect(both.actions!.map((a: { label: string }) => a.label)).toEqual(['Sign In to Furina…', 'Try now', 'Repair Connection'])
  })

  it('turns amber for a combined Hermes that cannot connect, and ignores hosts no longer saved', () => {
    expect(alert('open', 'no', [{ url: hosts[1].url, state: 'down' }])!.tone).toBe('warn')
    expect(alert('open', 'no', [{ url: hosts[1].url, state: 'connecting' }])).toBeNull()
    expect(alert('open', 'no', [{ url: 'https://gone.example', state: 'signIn' }])).toBeNull()
  })

  it('waits before showing a reconnect, and goes back to nothing once open', () => {
    vi.useFakeTimers()
    const seen: Away[] = []
    function Probe({ phase }: { phase: ConnectionPhase }) {
      seen.push(useAway(phase, 2000, 20000))
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(createElement(Probe, { phase: 'reconnecting' })))
    expect(seen.at(-1)).toBe('no')
    act(() => vi.advanceTimersByTime(2000))
    expect(seen.at(-1)).toBe('shown')
    act(() => vi.advanceTimersByTime(18000))
    expect(seen.at(-1)).toBe('long')
    act(() => root.render(createElement(Probe, { phase: 'open' })))
    expect(seen.at(-1)).toBe('no')
    act(() => root.unmount())
  })

  it('keeps no permanent connected dot in the rail, and the banner only for an update (App.tsx)', () => {
    const rail = readFileSync(join(__dirname, '../src/renderer/src/components/SectionRail.tsx'), 'utf8')
    expect(rail).not.toMatch(/Connected to \{host\}/)
    const app = readFileSync(join(__dirname, '../src/renderer/src/App.tsx'), 'utf8')
    expect(app).toMatch(/status\.phase !== 'open' && updateAway \? \(\s*<div className="banner"/)
  })
})
