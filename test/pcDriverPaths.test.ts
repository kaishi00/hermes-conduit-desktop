import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ARTIFACTS, driverCandidates } from '../src/main/pcDriver'

describe('the driver executable after unpacking', () => {
  it('finds a Mac binary inside the archive’s top-level folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'conduit-driver-'))
    const nested = join(root, 'cua-driver-rs-0.52.0-darwin-universal', ARTIFACTS['darwin-arm64']!.binary)
    mkdirSync(dirname(nested), { recursive: true })
    writeFileSync(nested, '')
    expect(driverCandidates(ARTIFACTS['darwin-arm64']!, root)).toEqual([
      join(root, 'CuaDriver.app/Contents/MacOS/cua-driver'),
      nested
    ])
    expect(driverCandidates(ARTIFACTS['darwin-arm64']!, root).includes(nested)).toBe(true)
  })

  it('keeps the Windows zip layout at the target root', () => {
    const candidate = driverCandidates(ARTIFACTS['win32-x64']!, '/driver')
    expect(candidate).toEqual(['/driver/cua-driver.exe'])
  })
})
