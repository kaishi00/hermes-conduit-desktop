#!/usr/bin/env node
/** Install a user-local launcher for this checkout, without replacing another app. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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

/** XDG gives nested desktop files an id with each directory separator replaced by a dash. */
function findDesktopId(directory, id, prefix = '') {
  if (!existsSync(directory)) return null
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const name = `${prefix}${entry.name}`
    if (entry.isDirectory()) {
      const found = findDesktopId(path, id, `${name}-`)
      if (found) return found
    } else if ((entry.isFile() || entry.isSymbolicLink()) && name === id) return path
  }
  return null
}

try {
  if (process.platform !== 'linux') throw new Error('This installer is for Linux.')
  const electron = join(root, 'node_modules', 'electron', 'dist', 'electron')
  const icon = join(root, 'build', 'icon.png')
  for (const file of [electron, icon, join(root, 'out', 'main', 'index.js')]) {
    if (!existsSync(file)) throw new Error(`Missing ${file}. Run pnpm install and pnpm build first.`)
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const desktopName = typeof pkg.desktopName === 'string' && /^[A-Za-z0-9._-]+$/.test(pkg.desktopName) ? pkg.desktopName : 'conduit'
  const data = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  if (!isAbsolute(data)) throw new Error('XDG_DATA_HOME must be an absolute path.')
  const applications = join(data, 'applications')
  const destination = join(applications, `${desktopName}.desktop`)
  const id = `${desktopName}.desktop`
  const previous = existsSync(applications)
    ? readdirSync(applications, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.desktop') && entry.name !== id)
    : []
  for (const entry of previous) {
    const name = entry.name
    const path = join(applications, name)
    if (readFileSync(path, 'utf8').split(/\r?\n/).includes(marker)) {
      throw new Error(`This checkout already has a source launcher at ${path}. Remove the old entry and update its URI handler before installing ${id}.`)
    }
  }
  const dataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(isAbsolute)
  for (const directory of [applications, ...dataDirs.map(dir => join(dir, 'applications'))]) {
    const found = findDesktopId(directory, id)
    if (!found) continue
    if (found !== destination || !readFileSync(found, 'utf8').split(/\r?\n/).includes(marker)) {
      throw new Error(`${found} already uses desktop id ${id}; it was not changed or shadowed.`)
    }
  }
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Conduit',
    'GenericName=Hermes Conduit Desktop',
    'Comment=Connect to Hermes Agent',
    `Exec=/usr/bin/env ${argument(electron)} ${argument(root)} %u`,
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
  const refresh = spawnSync('update-desktop-database', [applications], { encoding: 'utf8' })
  if (refresh.error && refresh.error.code !== 'ENOENT') throw refresh.error
  if (refresh.status !== null && refresh.status !== 0) throw new Error(`Could not refresh the desktop database: ${refresh.stderr.trim()}`)
  console.log(`Installed ${destination}`)
  if (refresh.error?.code === 'ENOENT') console.log('update-desktop-database is not installed; refresh the desktop database when it becomes available.')
  console.log('Rebuild with pnpm build after changing source. To make this the conduit:// handler, run:')
  console.log(`  xdg-mime default ${desktopName}.desktop x-scheme-handler/conduit`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
