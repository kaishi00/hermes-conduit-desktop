#!/usr/bin/env node
/** Install a user-local launcher for this checkout, without replacing another app. */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const marker = `X-Conduit-Source=${Buffer.from(root).toString('base64url')}`

// Desktop Entry strings are unescaped once before Exec's quoted arguments are parsed.
function value(text) {
  if (/[\r\n\0]/.test(text)) throw new Error('Paths containing a newline or NUL cannot be written to a desktop entry.')
  return text.replaceAll('\\', '\\\\')
}
function argument(text) {
  return `"${value(text).replaceAll('\\', '\\\\').replaceAll('"', '\\\\"').replaceAll('$', '\\\\$').replaceAll('`', '\\\\`').replaceAll('%', '%%')}"`
}

function directoryKey(path) {
  try {
    const info = statSync(path)
    return `${info.dev}:${info.ino}`
  } catch {
    return null
  }
}

/** Each desktop entry under a directory, nested ones under their XDG id (a dash per separator).
 *  Directories reached through a symlink count, as they do for GLib's own scan, but each physical
 *  directory is scanned once: `alias -> .` must not make the same entry look like a second id. */
function desktopEntries(directory, prefix = '', visited = new Set()) {
  if (!existsSync(directory)) return []
  const here = directoryKey(directory)
  if (here) visited.add(here)
  let contents
  try {
    contents = readdirSync(directory, { withFileTypes: true })
  } catch {
    throw new Error(`Could not scan ${directory}; make it readable or remove it before installing a source launcher.`)
  }
  const entries = []
  for (const entry of contents) {
    const path = join(directory, entry.name)
    const id = `${prefix}${entry.name}`
    if (isDirectory(path, entry)) {
      const key = directoryKey(path)
      if (key && !visited.has(key)) {
        visited.add(key)
        entries.push(...desktopEntries(path, `${id}-`, visited))
      }
    } else if (entry.isFile() || entry.isSymbolicLink()) entries.push({ path, id })
  }
  return entries
}
function isDirectory(path, entry) {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function findDesktopId(directory, id) {
  return desktopEntries(directory).find(entry => entry.id === id)?.path ?? null
}

/** The entry's lines, or why they can't be read: a dangling symlink is an entry we can't own,
 *  an unreadable one we can't judge, and the two must not be treated alike. */
function readEntry(path) {
  try {
    return { lines: readFileSync(path, 'utf8').split(/\r?\n/) }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    // ENOENT (a dangling symlink) and ELOOP are entries that hold nothing: not ours.
    return code === 'ENOENT' || code === 'ELOOP' ? { lines: null } : { error }
  }
}
function isOwnSource(path) {
  const read = readEntry(path)
  if (read.error) {
    throw new Error(`Could not read ${path}; make it readable or remove it before installing a source launcher.`)
  }
  return read.lines?.includes(marker) ?? false
}

try {
  if (process.platform !== 'linux') throw new Error('This installer is for Linux.')
  const electron = join(root, 'node_modules', 'electron', 'dist', 'electron')
  const icon = join(root, 'build', 'icon.png')
  for (const file of [electron, icon, join(root, 'out', 'main', 'index.js')]) {
    if (!existsSync(file)) throw new Error(`Missing ${file}. Run pnpm install and pnpm build first.`)
  }
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch {
    throw new Error('Could not read package.json. Run pnpm install first.')
  }
  const desktopName = typeof pkg.desktopName === 'string' && /^[A-Za-z0-9._-]+$/.test(pkg.desktopName) ? pkg.desktopName : 'conduit'
  // Only a blank XDG_DATA_HOME is unset. A real path keeps its exact bytes, even when it has
  // leading or trailing whitespace: trimming it would silently install into a different directory.
  const configuredData = process.env.XDG_DATA_HOME || ''
  const data = configuredData.trim() ? configuredData : join(homedir(), '.local', 'share')
  // Validate the trimmed spelling but keep the original bytes for the path itself: a real path
  // that happens to start or end with whitespace must land where the user asked it to land.
  if (!isAbsolute(data.trim())) throw new Error('XDG_DATA_HOME must be an absolute path.')
  const applications = join(data, 'applications')
  const destination = join(applications, `${desktopName}.desktop`)
  const id = `${desktopName}.desktop`
  for (const entry of desktopEntries(applications)) {
    if (entry.id === id || !entry.id.endsWith('.desktop')) continue
    if (isOwnSource(entry.path)) {
      throw new Error(`This checkout already has a source launcher at ${entry.path}. Remove the old entry and update its URI handler before installing ${id}.`)
    }
  }
  const dataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(isAbsolute)
  for (const directory of [applications, ...dataDirs.map(dir => join(dir, 'applications'))]) {
    const found = findDesktopId(directory, id)
    if (!found) continue
    if (found !== destination || !isOwnSource(found)) {
      throw new Error(`${found} already uses desktop id ${id}; it was not changed or shadowed.`)
    }
  }
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    // The packaged app is called Conduit: a checkout beside it says so in the menu.
    'Name=Conduit (source)',
    'GenericName=Hermes Conduit Desktop',
    'Comment=Connect to Hermes Agent',
    // Neither /usr/bin/env nor the bare electron path can carry every legal checkout: env reads a
    // path holding '=' as an assignment (and prints the environment), while GLib refuses a desktop
    // entry whose program carries a '%' at all. /bin/sh as the program and the paths as arguments
    // avoid both, and `exec "$0" "$@"` passes root and the URI through untouched.
    `Exec=${['/bin/sh', '-c', 'exec "$0" "$@"', electron, root].map(argument).join(' ')} %u`,
    `Path=${value(root)}`,
    `Icon=${value(icon)}`,
    'Terminal=false',
    'Categories=Utility;',
    'Keywords=Hermes;Agent;AI;',
    `StartupWMClass=${desktopName}`,
    'MimeType=x-scheme-handler/conduit;',
    marker,
    ''
  ].join('\n')
  mkdirSync(applications, { recursive: true })
  writeFileSync(destination, entry, { mode: 0o644 })
  // The entry is written: a failed refresh is a warning, never a failed install.
  console.log(`Installed ${destination}`)
  const refresh = spawnSync('update-desktop-database', [applications], { encoding: 'utf8' })
  if (refresh.error?.code === 'ENOENT') {
    console.log('update-desktop-database is not installed; refresh the desktop database when it becomes available.')
  } else if (refresh.error) {
    console.warn(`The entry is installed, but the desktop database was not refreshed: ${refresh.error.message}`)
  } else if (refresh.status === null) {
    const signal = refresh.signal ? ` (${refresh.signal})` : ''
    console.warn(`The entry is installed, but the desktop database was not refreshed: update-desktop-database was terminated by a signal${signal}.`)
  } else if (refresh.status !== 0) {
    const detail = (refresh.stderr || '').trim() || `update-desktop-database exited with ${refresh.status}`
    console.warn(`The entry is installed, but the desktop database was not refreshed: ${detail}`)
  }
  console.log('Rebuild with pnpm build after changing source. To make this the conduit:// handler, run:')
  console.log(`  xdg-mime default ${desktopName}.desktop x-scheme-handler/conduit`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
