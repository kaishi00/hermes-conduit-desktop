import { describe, expect, it } from 'vitest'
import { countsAsCrash, endLine, fieldText, kept, offered, processName, reportBody, type DeviceReport } from '../src/shared/deviceReports'

const DAY = 86_400_000
const report = (over: Partial<DeviceReport> = {}): DeviceReport => ({
  id: 'r',
  kind: 'crash',
  at: 10 * DAY,
  process: 'window',
  reason: 'crashed',
  exitCode: 139,
  version: '0.1.0',
  os: 'macOS 15.1.0',
  device: 'Mac arm64',
  state: 'new',
  ...over
})

describe('device reports', () => {
  it('offers only new reports from the last 7 days, the newest 5', () => {
    const list = [
      report({ id: 'old', at: 2 * DAY }),
      report({ id: 'declined', state: 'declined' }),
      report({ id: 'sent', state: 'sent' }),
      ...[1, 2, 3, 4, 5, 6].map(n => report({ id: `n${n}`, at: 10 * DAY - n }))
    ]
    expect(offered(list, 10 * DAY).map(r => r.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])
    expect(kept(list, 41 * DAY)).toEqual([])
    expect(kept(list, 10 * DAY)).toHaveLength(9)
  })

  it('names the process and how it ended', () => {
    expect(processName('renderer')).toBe('window')
    expect(processName('GPU')).toBe('GPU')
    expect(processName('Utility', 'Network Service')).toBe('Network Service')
    expect(endLine(report())).toBe('window crashed, exit 139')
    expect(endLine(report({ kind: 'hang', reason: 'responding again', durationMs: 4200, exitCode: undefined }))).toBe(
      'window not responding for 4.2 s, responding again'
    )
    expect(fieldText('C:\\Users\\me/secret*?')).toBe('C: Users me secret')
  })

  it('posts the shape the relay takes from the phone, with no stacks', () => {
    const body = reportBody(report())
    expect(body).toMatchObject({ app_version: '0.1.0', build: 'desktop 0.1.0', os: 'macOS 15.1.0', device: 'Mac arm64', kind: 'crash' })
    expect(body.diagnostic.hangDiagnostics).toEqual([])
    expect(body.diagnostic.crashDiagnostics[0]!.diagnosticMetaData).toMatchObject({
      terminationReason: 'window crashed, exit 139',
      bundleIdentifier: 'dev.conduit.desktop'
    })
    const hang = reportBody(report({ kind: 'hang', reason: 'responding again', durationMs: 3000 }))
    expect(hang.diagnostic.crashDiagnostics).toEqual([])
    expect(hang.diagnostic.hangDiagnostics[0]!.diagnosticMetaData.hangDuration).toBe('3.0 sec')
    for (const field of [body.app_version, body.build, body.os, body.device]) expect(field).toMatch(/^[\p{L}\p{N} ()._,:+-]{1,64}$/u)
  })

  it('asks only about real crashes, not a quit, a GPU that never started or a SIGTERM', () => {
    expect(countsAsCrash({ type: 'renderer', reason: 'crashed', exitCode: 139 }, false)).toBe(true)
    expect(countsAsCrash({ type: 'GPU', reason: 'crashed', exitCode: 34 }, false)).toBe(true)
    expect(countsAsCrash({ type: 'renderer', reason: 'crashed', exitCode: 139 }, true)).toBe(false)
    expect(countsAsCrash({ type: 'GPU', reason: 'clean-exit', exitCode: 0 }, false)).toBe(false)
    expect(countsAsCrash({ type: 'GPU', reason: 'launch-failed', exitCode: 1002 }, false)).toBe(false)
    expect(countsAsCrash({ type: 'Utility', reason: 'killed', exitCode: 15 }, false)).toBe(false)
    expect(countsAsCrash({ type: 'Utility', reason: 'killed', exitCode: 9 }, false)).toBe(true)
    expect(countsAsCrash({ type: 'renderer', reason: 'killed', exitCode: 15 }, false)).toBe(true)
  })
})
