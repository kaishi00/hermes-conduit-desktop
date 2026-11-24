import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
  // Every reserved character the installer escapes, and '=' which /usr/bin/env would read as an
  // assignment. A literal backslash cannot live in the checkout: node refuses an ESM entry whose
  // path holds one (ERR_INVALID_MODULE_SPECIFIER), so the round-trip test below covers its math.
  const root = join(base, 'source with space " $ ` % =')
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
  const install = (xdg = data, extraEnv: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [join(root, 'scripts/install-linux-desktop.mjs')], {
    encoding: 'utf8', env: { ...process.env, XDG_DATA_HOME: xdg, XDG_DATA_DIRS: join(base, 'system'), ...extraEnv }
  })
  const run = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, [join(root, 'scripts/install-linux-desktop.mjs')], {
    encoding: 'utf8', env: { ...process.env, XDG_DATA_DIRS: join(base, 'system'), ...env }
  })
  const entry = join(data, 'applications', `${desktopName || 'conduit'}.desktop`)
  return { base, root, data, entry, install, run }
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

  it('escapes every reserved character so the two unescapes restore the paths', () => {
    const f = fixture()
    expect(f.install().status).toBe(0)
    const entry = readFileSync(f.entry, 'utf8')
    const field = (key: string) => entry.split('\n').find(line => line.startsWith(`${key}=`))!.slice(key.length + 1)
    // The desktop entry unescapes its value once, then Exec splits quoted arguments and unescapes
    // each: both halves are undone here in that order, as a launcher does them, and what comes out
    // has to be the path that went in.
    // The entry spec's escapes, as a launcher undoes them: \s, \n, \t, \r and \\.
    const escapes: Record<string, string> = { s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' }
    const entryUnescape = (text: string) =>
      text.replace(/\\([sntr\\])/g, (_match, char: string) => escapes[char] ?? char)
    const execArgs = (value: string) => {
      const text = entryUnescape(value)
      const args: string[] = []
      let current = ''
      let quoted = false
      let started = false
      for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (char === '"') quoted = !quoted
        else if (char === '\\' && i + 1 < text.length) current += text[++i]
        else if (char === '%' && text[i + 1] === '%') {
          current += '%'
          i++
        }
        else if (char === ' ' && !quoted) {
          if (started) args.push(current)
          current = ''
          started = false
          continue
        } else current += char
        started = true
      }
      if (started) args.push(current)
      return args
    }
    expect(execArgs(field('Exec'))).toEqual([
      '/bin/sh',
      '-c',
      'exec "$0" "$@"',
      join(f.root, 'node_modules/electron/dist/electron'),
      f.root,
      '%u'
    ])
    expect(entryUnescape(field('Path'))).toBe(f.root)
    expect(entryUnescape(field('Icon'))).toBe(join(f.root, 'build/icon.png'))
  })

  it('names the checkout apart from the packaged app', () => {
    const f = fixture()
    expect(f.install().status).toBe(0)
    const entry = readFileSync(f.entry, 'utf8')
    expect(entry).toContain('Name=Conduit (source)')
    // Neither env (it reads a '=' in the path as an assignment) nor the bare electron path
    // (GLib refuses a '%' in the program position) can carry every legal checkout.
    expect(entry).not.toContain('Exec=/usr/bin/env')
    expect(entry).toContain('Exec="/bin/sh" "-c"')
  })

  it('refuses a dangling symlink at its id with the friendly message, not a raw ENOENT', () => {
    const f = fixture()
    mkdirSync(join(f.data, 'applications'), { recursive: true })
    symlinkSync(join(f.data, 'missing-entry.desktop'), f.entry)
    const refused = f.install()
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('already uses desktop id')
    expect(refused.stderr).not.toContain('ENOENT')
  })

  it.each(['', '   '])('treats an empty or blank XDG_DATA_HOME (%j) as unset and falls back to the home directory', blank => {
    const f = fixture()
    const home = join(f.base, 'home')
    const installed = f.run({ HOME: home, XDG_DATA_HOME: blank })
    expect(installed.status, installed.stderr).toBe(0)
    expect(existsSync(join(home, '.local/share/applications/conduit.desktop'))).toBe(true)
  })

  it('finds its own earlier entry through a symlinked directory, as GLib does', () => {
    const f = fixture()
    expect(f.install().status).toBe(0)
    // The entry moves into a real directory that only a symlink under applications/ reaches.
    const real = join(f.base, 'elsewhere')
    mkdirSync(real, { recursive: true })
    renameSync(f.entry, join(real, 'older.desktop'))
    symlinkSync(real, join(f.data, 'applications/nested'))
    const refused = f.install()
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('already has a source launcher')
    expect(existsSync(join(real, 'older.desktop'))).toBe(true)
  })

  // Root reads a file whatever its mode, so the entry can't be made unreadable to it.
  it.skipIf(process.getuid?.() === 0)('refuses to install beside an entry it cannot read', () => {
    const f = fixture()
    mkdirSync(join(f.data, 'applications'), { recursive: true })
    const locked = join(f.data, 'applications/old-source.desktop')
    writeFileSync(locked, '[Desktop Entry]\nName=Old\n')
    chmodSync(locked, 0o000)
    const refused = f.install()
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('Could not read')
    expect(refused.stderr).toContain('old-source.desktop')
    expect(existsSync(f.entry)).toBe(false)
  })

  it('scans a symlinked alias of the applications directory only once', () => {
    const f = fixture()
    expect(f.install().status).toBe(0)
    // `alias -> .` reaches the same physical directory; under the old walk its own entry came back
    // as alias-conduit.desktop and a valid reinstall was refused as a second source launcher.
    symlinkSync('.', join(f.data, 'applications/alias'))
    const second = f.install()
    expect(second.status, second.stderr).toBe(0)
    expect(second.stderr).not.toContain('already has a source launcher')
    expect(existsSync(f.entry)).toBe(true)
  })

  // Root can read a mode-000 directory, so this refusal can only be checked as a normal user.
  it.skipIf(process.getuid?.() === 0)('names a nested applications directory it cannot scan', () => {
    const f = fixture()
    const nested = join(f.data, 'applications/private')
    mkdirSync(nested, { recursive: true })
    chmodSync(nested, 0o000)
    try {
      const refused = f.install()
      expect(refused.status).not.toBe(0)
      expect(refused.stderr).toContain('Could not scan')
      expect(refused.stderr).toContain('private')
      expect(existsSync(f.entry)).toBe(false)
    } finally {
      chmodSync(nested, 0o755)
    }
  })

  it('warns when the desktop database refresh is killed by a signal', () => {
    const f = fixture()
    const bin = join(f.base, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'update-desktop-database'), '#!/bin/sh\nkill -TERM $$\n')
    chmodSync(join(bin, 'update-desktop-database'), 0o755)
    const installed = f.install(undefined, { PATH: `${bin}:${process.env.PATH}` })
    expect(installed.status, installed.stderr).toBe(0)
    expect(installed.stdout).toContain(`Installed ${f.entry}`)
    expect(installed.stderr).toContain('terminated by a signal')
    expect(installed.stderr).toContain('SIGTERM')
    expect(existsSync(f.entry)).toBe(true)
  })

  it('uses a real XDG_DATA_HOME path with whitespace as written', () => {
    const f = fixture()
    const trailing = `${f.data} `
    mkdirSync(trailing, { recursive: true })
    const installed = f.run({ XDG_DATA_HOME: trailing })
    expect(installed.status, installed.stderr).toBe(0)
    expect(existsSync(join(trailing, 'applications/conduit.desktop'))).toBe(true)
    expect(existsSync(join(f.data, 'applications/conduit.desktop'))).toBe(false)

    // A leading space makes the path relative by Node's rules, so run from the fixture's own
    // directory: the literal path must still be honoured without leaving a tree in the repo.
    const leading = ` ${f.data}`
    const fromTemp = spawnSync(process.execPath, [join(f.root, 'scripts/install-linux-desktop.mjs')], {
      encoding: 'utf8', cwd: f.base,
      env: { ...process.env, XDG_DATA_HOME: leading, XDG_DATA_DIRS: join(f.base, 'system') }
    })
    expect(fromTemp.status, fromTemp.stderr).toBe(0)
    expect(existsSync(resolve(f.base, leading, 'applications/conduit.desktop'))).toBe(true)
  })

  it('reports the install even when refreshing the desktop database fails', () => {
    const f = fixture()
    const bin = join(f.base, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'update-desktop-database'), '#!/bin/sh\necho "database is locked" >&2\nexit 1\n')
    chmodSync(join(bin, 'update-desktop-database'), 0o755)
    const installed = f.install(undefined, { PATH: `${bin}:${process.env.PATH}` })
    expect(installed.status, installed.stderr).toBe(0)
    expect(installed.stdout).toContain(`Installed ${f.entry}`)
    expect(installed.stderr).toContain('database is locked')
    expect(existsSync(f.entry)).toBe(true)
  })
})
