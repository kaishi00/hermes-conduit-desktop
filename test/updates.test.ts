import { describe, expect, it } from 'vitest'
import { releaseUrl, updatesOff } from '../src/shared/updates'

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
})
