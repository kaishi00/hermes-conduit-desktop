import { describe, expect, it } from 'vitest'
import { watchPulseCapabilities } from '../src/renderer/src/state/plugin'
import type { PluginStatus } from '../src/renderer/src/state/plugin'

const reported = (capabilities: string[]): PluginStatus => ({
  state: 'reported', version: null, loadedVersion: null, restartNeeded: false, capabilities, managedBy: null, degraded: []
})

describe('asking Pulse plugin capabilities (issue 550)', () => {
  it('retries only while the answer is unknown, then reports the capabilities', async () => {
    const answers: (PluginStatus | null)[] = [null, reported(['pulse_profile_exclusion_toggle'])]
    const waits: number[] = []
    let next = () => {}
    const seen: (readonly string[] | null)[] = []
    watchPulseCapabilities(
      async () => answers.shift() ?? null,
      caps => seen.push(caps),
      (ms, then) => { waits.push(ms); next = then; return () => undefined }
    )
    const settle = () => new Promise(resolve => setTimeout(resolve, 0))
    await settle(); next(); await settle()
    expect(waits).toEqual([5_000])
    expect(seen).toEqual([['pulse_profile_exclusion_toggle']])
  })

  it('treats a missing plugin as no capabilities and stops asking', async () => {
    const seen: unknown[] = []
    watchPulseCapabilities(async () => ({ state: 'missing' } as PluginStatus), caps => seen.push(caps))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toEqual([[]])
  })

  it('stops on unmount and takes no late answer', async () => {
    let answer = (_: PluginStatus | null) => {}
    const seen: unknown[] = []
    const stop = watchPulseCapabilities(() => new Promise(resolve => { answer = resolve }), caps => seen.push(caps))
    stop()
    answer(reported(['x']))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toEqual([])
  })
})
