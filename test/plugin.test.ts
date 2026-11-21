import { describe, expect, it } from 'vitest'
import { isOlder, jobState, parseChangelog, selfUpdatePath, pluginStatus, releaseNotes, runningVersion, serves, updateAvailable } from '../src/renderer/src/state/plugin'
import { versionFromManifest } from '../src/main/pluginRelease'

const CHANGELOG = `# Conduit plugin changelog

Intro text.

- \`## <version> (<YYYY-MM-DD>)\`: not an entry.

## 0.177.30 (2026-11-18)

### Security

- Sealed pushes stay sealed.

### Fixes

- A long line that wraps
  onto the next one.

## 0.177.29 (2026-11-17)

### New and improved

- Local Live is faster.

## 0.177.28 (2026-11-16)

### Fixes

- Old fix.
`

describe('plugin status', () => {
  it('reads the capabilities answer', () => {
    const status = pluginStatus({
      version: '0.177.30',
      loaded_version: '0.177.28',
      restart_needed: true,
      capabilities: ['pairing', 3],
      degraded: ['workspace-files']
    })
    expect(status).toMatchObject({
      state: 'reported',
      version: '0.177.30',
      loadedVersion: '0.177.28',
      restartNeeded: true,
      capabilities: ['pairing'],
      managedBy: null
    })
    expect(runningVersion(status)).toBe('0.177.28')
    expect(runningVersion(pluginStatus({ version: '1.0', restart_needed: true }))).toBeNull()
    expect(pluginStatus(null).state).toBe('unknown')
    expect(serves(status, ['pairing'])).toBe(true)
    expect(serves(status, ['pairing', 'gpt-live'])).toBe(false)
  })

  it('compares dotted versions, an unreadable one older', () => {
    expect(isOlder('0.9.1', '0.10.0')).toBe(true)
    expect(isOlder('0.10.0', '0.10')).toBe(false)
    expect(isOlder(null, '0.1')).toBe(true)
    expect(isOlder('abc', '0')).toBe(true)
  })

  it('offers an update when main is newer, never on a managed host', () => {
    expect(updateAvailable(pluginStatus({ version: '0.177.28', loaded_version: '0.177.28' }), '0.177.30')).toBe(true)
    expect(updateAvailable(pluginStatus({ version: '0.177.30', loaded_version: '0.177.30' }), '0.177.30')).toBe(false)
    expect(updateAvailable(pluginStatus({ version: '0.177.30', loaded_version: '0.177.28', restart_needed: true }), '0.177.30')).toBe(false)
    expect(updateAvailable(pluginStatus({ version: '0.1', managed_by: 'Hermes Hub' }), '0.177.30')).toBe(false)
    expect(updateAvailable(pluginStatus({ version: '0.1' }), null)).toBe(false)
  })
})

describe('plugin changelog', () => {
  it('reads entries, kinds and wrapped lines', () => {
    const entries = parseChangelog(CHANGELOG)
    expect(entries.map(e => e.version)).toEqual(['0.177.30', '0.177.29', '0.177.28'])
    expect(entries[0].released).toBe('2026-11-18')
    expect(entries[0].changes[1]).toEqual({ version: '0.177.30', kind: 'fixes', text: 'A long line that wraps onto the next one.' })
  })

  it('lists what an update brings, security first', () => {
    const notes = releaseNotes(parseChangelog(CHANGELOG), '0.177.28', '0.177.30')!
    expect(notes.security).toBe(true)
    expect(notes.released).toBe('2026-11-18')
    expect(notes.changes.map(c => c.kind)).toEqual(['security', 'fixes', 'new'])
    expect(releaseNotes([], '0.1', '0.2')).toBeNull()
  })

  it('reads the version from plugin.yaml', () => {
    expect(versionFromManifest('name: conduit_push\nversion: 0.177.29\n')).toBe('0.177.29')
    expect(versionFromManifest("version: '1.2.3'")).toBe('1.2.3')
    expect(versionFromManifest(null)).toBeNull()
  })
})

describe('host update job', () => {
  it('reads each step and how it ended', () => {
    expect(jobState({ step: 'downloading' })).toEqual({ phase: 'updating', step: 'downloading' })
    expect(jobState({ step: 'restarting_gateway', gateway_stage: 'draining' })).toEqual({ phase: 'updating', step: 'draining' })
    expect(jobState({ step: 'waiting_for_chats', running_chats: 3 })).toEqual({ phase: 'updating', step: 'waitingForChats', chats: 3 })
    expect(jobState({ step: 'done', loaded_version: '0.2' })).toEqual({ phase: 'updated', version: '0.2' })
    expect(jobState({ step: 'failed', code: 'restart_needed', detail: 'x' })).toEqual({ phase: 'needsDashboardRestart', detail: 'x' })
    // A caution scan can be accepted (Update Anyway); a dangerous one stays a failure.
    const held = {
      step: 'failed',
      code: 'scan_blocked',
      scan_verdict: 'caution',
      scan_finding_count: 9,
      detail: 'BLOCKED',
      scan_findings: [{ severity: 'high', category: 'exec', file: 'tests/x.py', line: 7, description: 'subprocess' }, { severity: 'low' }]
    }
    expect(jobState(held)).toEqual({ phase: 'scanHeld', findings: ['high · exec · tests/x.py:7: subprocess', 'low'], count: 9, detail: 'BLOCKED' })
    expect(jobState({ ...held, scan_verdict: 'dangerous' })).toEqual({ phase: 'failed', detail: 'BLOCKED' })
    expect(selfUpdatePath(true)).toBe('/api/plugins/conduit_push/self/update?force=true')
    expect(selfUpdatePath()).toBe('/api/plugins/conduit_push/self/update')
    expect(jobState({ step: 'failed', detail: '' })).toEqual({ phase: 'failed', detail: null })
    expect(jobState({ step: 'something_new' })).toEqual({ phase: 'updating', step: 'downloading' })
    expect(jobState(null)).toBeNull()
  })
})
