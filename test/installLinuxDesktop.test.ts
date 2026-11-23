import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

const installer = join(process.cwd(), 'scripts/install-linux-desktop.mjs')
const temporary: string[] = []
const hasGio = spawnSync('gio', ['help'], { stdio: 'ignore' }).status === 0

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

function fixture(desktopName?: string) {
  const base = mkdtempSync(join(tmpdir(), 'conduit-launcher-'))
  temporary.push(base)
  const root = join(base, 'source with space " $ ` %')
  const data = join(base, 'data')
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'node_modules/electron/dist'), { recursive: true })
  mkdirSync(join(root, 'build'), { recursive: true })
  mkdirSync(join(root, 'out/main'), { recursive: true })
  copyFileSync(installer, join(root, 'scripts/install-linux-desktop.mjs'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'conduit-desktop', ...(desktopName ? { desktopName } : {}) }))
  const electron = join(root, 'node_modules/electron/dist/electron')
  writeFileSync(electron, '#!/bin/sh\nprintf "%s\\n" "$@" > "$CONDUIT_LAUNCH_RESULT"\n')
  chmodSync(electron, 0o755)
  writeFileSync(join(root, 'build/icon.png'), '')
  writeFileSync(join(root, 'out/main/index.js'), '')
  const install = (xdg = data) => spawnSync(process.execPath, [join(root, 'scripts/install-linux-desktop.mjs')], {
    encoding: 'utf8', env: { ...process.env, XDG_DATA_HOME: xdg, XDG_DATA_DIRS: join(base, 'system') }
  })
  const entry = join(data, 'applications', `${desktopName || 'conduit'}.desktop`)
  return { base, root, data, entry, install }
}

describe.skipIf(process.platform !== 'linux')('Linux source launcher', () => {
  it.skipIf(!hasGio)('launches the built checkout from an XDG desktop entry with reserved characters in its path', async () => {
    const f = fixture()
    const installed = f.install()
    expect(installed.status, installed.stderr).toBe(0)
    const result = join(f.base, 'launched')
    const launched = spawnSync('gio', ['launch', f.entry], { encoding: 'utf8', env: { ...process.env, CONDUIT_LAUNCH_RESULT: result } })
    expect(launched.status, launched.stderr).toBe(0)
    await vi.waitFor(() => expect(readFileSync(result, 'utf8')).toBe(`${f.root}\n`), { timeout: 3_000, interval: 20 })
  })

  it.skipIf(!hasGio)('passes a conduit link to the source application', async () => {
    const f = fixture()
    expect(f.install().status).toBe(0)
    const result = join(f.base, 'opened-link')
    const url = 'conduit://link/example'
    const launched = spawnSync('gio', ['launch', f.entry, url], { encoding: 'utf8', env: { ...process.env, CONDUIT_LAUNCH_RESULT: result } })
    expect(launched.status, launched.stderr).toBe(0)
    await vi.waitFor(() => expect(readFileSync(result, 'utf8')).toBe(`${f.root}\n${url}\n`), { timeout: 3_000, interval: 20 })
  })

  it('updates its own entry but refuses to overwrite an existing foreign launcher', () => {
    const f = fixture('dev.conduit')
    expect(f.install().status).toBe(0)
    expect(f.install().status).toBe(0)
    writeFileSync(f.entry, '[Desktop Entry]\nName=Another application\n')
    const refused = f.install()
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('already uses desktop id')
    expect(readFileSync(f.entry, 'utf8')).toBe('[Desktop Entry]\nName=Another application\n')
  })

  it('does not retarget another checkout’s source launcher', () => {
    const first = fixture()
    const second = fixture()
    expect(first.install().status).toBe(0)
    const before = readFileSync(first.entry, 'utf8')
    const refused = second.install(first.data)
    expect(refused.status).not.toBe(0)
    expect(readFileSync(first.entry, 'utf8')).toBe(before)
  })

  it('does not shadow a system entry with the same XDG desktop id', () => {
    const f = fixture('example-tool')
    const nested = join(f.base, 'system/applications/example')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'tool.desktop'), '[Desktop Entry]\nName=System app\n')
    const refused = f.install()
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('already uses desktop id')
    expect(existsSync(f.entry)).toBe(false)
  })

  it('does not leave duplicate source entries after the desktop id changes', () => {
    const f = fixture()
    expect(f.install().status).toBe(0)
    writeFileSync(join(f.root, 'package.json'), JSON.stringify({ name: 'conduit-desktop', desktopName: 'dev.conduit' }))
    const refused = f.install()
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('already has a source launcher')
    expect(existsSync(f.entry)).toBe(true)
    expect(existsSync(join(f.data, 'applications/dev.conduit.desktop'))).toBe(false)
  })

  it('does not install until the source build exists', () => {
    const f = fixture()
    rmSync(join(f.root, 'out/main/index.js'))
    const missing = f.install()
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toContain('pnpm build')
    expect(existsSync(f.entry)).toBe(false)
  })

  it('rejects a relative XDG data directory', () => {
    const f = fixture()
    const rejected = f.install('relative-data')
    expect(rejected.status).not.toBe(0)
    expect(rejected.stderr).toContain('absolute path')
    expect(existsSync(f.entry)).toBe(false)
  })
})
