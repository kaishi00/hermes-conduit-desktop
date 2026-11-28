import { describe, expect, it } from 'vitest'
import { mayCheck, mayDownload, nextUpdateState, releaseUrl, replacesWaiting, updatesOff, type UpdateEvent, type UpdateState } from '../src/shared/updates'

describe('updates', () => {
  const copy = { packaged: true, platform: 'darwin', windowsStore: false, appImage: false }

  it('updates a packaged Mac or Windows copy itself', () => {
    expect(updatesOff(copy)).toBeNull()
    expect(updatesOff({ ...copy, platform: 'win32' })).toBeNull()
  })

  it('leaves a run from source, the Store and Linux packages alone', () => {
    expect(updatesOff({ ...copy, packaged: false })).toBe('development')
    expect(updatesOff({ ...copy, platform: 'win32', windowsStore: true })).toBe('store')
    expect(updatesOff({ ...copy, platform: 'linux' })).toBe('linux-package')
    expect(updatesOff({ ...copy, platform: 'linux', appImage: true })).toBeNull()
  })

  it('links the release by its tag', () => {
    expect(releaseUrl('1.0.1')).toBe('https://github.com/kaishi00/hermes-conduit-desktop/releases/tag/v1.0.1')
  })

  const start: UpdateState = { current: '1.0.0', off: null, auto: true, phase: 'idle' }
  const run = (state: UpdateState, ...events: UpdateEvent[]) => events.reduce((s, e) => nextUpdateState(s, e, 5), state)

  it('downloads a found update by itself when installs are automatic', () => {
    const state = run(start, { kind: 'checking' }, { kind: 'found', version: '1.0.1' }, { kind: 'progress', percent: 42.4 })
    expect(state).toMatchObject({ phase: 'downloading', version: '1.0.1', percent: 42, checkedAt: 5 })
    expect(run(state, { kind: 'downloaded', version: '1.0.1' })).toMatchObject({ phase: 'ready', percent: 100 })
  })

  // Issue 761: 1.1.2 downloaded, 1.1.3 came out before the restart, and the restart installed 1.1.2.
  it('checks past a downloaded update, and a newer release replaces it', () => {
    const ready = run(start, { kind: 'checking' }, { kind: 'found', version: '1.0.1' }, { kind: 'downloaded', version: '1.0.1' })
    expect(mayCheck(ready)).toBe(true)
    const rechecking = run(ready, { kind: 'checking' })
    expect(rechecking).toMatchObject({ phase: 'ready', version: '1.0.1', rechecking: true })
    expect(mayCheck(rechecking)).toBe(false)
    const newer = run(rechecking, { kind: 'found', version: '1.0.2' })
    expect(newer).toMatchObject({ phase: 'downloading', version: '1.0.2', percent: 0, rechecking: undefined })
    expect(replacesWaiting(rechecking, newer)).toBe(true)
    expect(run(newer, { kind: 'downloaded', version: '1.0.2' })).toMatchObject({ phase: 'ready', version: '1.0.2' })
  })

  it('replaces a waiting download with a newer one even when installs are not automatic', () => {
    const ready = run({ ...start, auto: false }, { kind: 'checking' }, { kind: 'found', version: '1.0.1' }, { kind: 'download' }, { kind: 'downloaded', version: '1.0.1' })
    const rechecking = run(ready, { kind: 'checking' })
    const newer = run(rechecking, { kind: 'found', version: '1.0.2' })
    expect(newer).toMatchObject({ phase: 'downloading', version: '1.0.2' })
    expect(replacesWaiting(rechecking, newer)).toBe(true)
    // A first find with installs not automatic still waits for Download.
    const first = run({ ...start, auto: false }, { kind: 'checking' })
    expect(replacesWaiting(first, run(first, { kind: 'found', version: '1.0.1' }))).toBe(false)
  })

  it('keeps Restart to Update through a check that finds the same version, nothing, or fails', () => {
    const ready = run(start, { kind: 'checking' }, { kind: 'found', version: '1.0.1' }, { kind: 'downloaded', version: '1.0.1' })
    for (const end of [{ kind: 'found', version: '1.0.1' }, { kind: 'none' }, { kind: 'failed' }] as UpdateEvent[]) {
      const after = run(ready, { kind: 'checking' }, end)
      expect(after).toMatchObject({ phase: 'ready', version: '1.0.1', rechecking: undefined, checkedAt: 5 })
      expect(mayCheck(after)).toBe(true)
    }
    // An updater error with no check under way is still an error.
    expect(run(ready, { kind: 'failed' }).phase).toBe('error')
  })

  it('waits for Download when installs are not automatic, and keeps the version when that download fails', () => {
    const found = run({ ...start, auto: false }, { kind: 'checking' }, { kind: 'found', version: '1.0.1' })
    expect(found.phase).toBe('available')
    expect(mayDownload(found)).toBe(true)
    const failed = run(found, { kind: 'download' }, { kind: 'progress', percent: 10 }, { kind: 'failed' })
    expect(failed).toMatchObject({ phase: 'download-failed', version: '1.0.1' })
    expect(mayDownload(failed)).toBe(true)
    expect(mayCheck(failed)).toBe(true)
    // The next scheduled check fails too (offline): Try Again and the version stay.
    expect(run(failed, { kind: 'checking' }, { kind: 'failed' })).toMatchObject({ phase: 'download-failed', version: '1.0.1' })
    expect(run(found, { kind: 'checking' }, { kind: 'failed' })).toMatchObject({ phase: 'available', version: '1.0.1' })
  })

  it('calls a failed check an error, and an empty one up to date', () => {
    expect(run(start, { kind: 'checking' }, { kind: 'failed' }).phase).toBe('error')
    expect(run(start, { kind: 'checking' }, { kind: 'none' })).toMatchObject({ phase: 'none', version: undefined })
    expect(mayCheck(run(start, { kind: 'checking' }))).toBe(false)
  })

  it('never checks or downloads in a copy that does not update itself', () => {
    const store = { ...start, off: 'store' as const, phase: 'available' as const }
    expect(mayCheck(store)).toBe(false)
    expect(mayDownload(store)).toBe(false)
  })
})
