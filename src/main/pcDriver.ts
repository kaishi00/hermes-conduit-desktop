/**
 * The driver Control from Hermes runs actions with: trycua's cua-driver, the
 * one Hermes' own computer_use uses. It isn't shipped with Conduit (Eric
 * 2026-11-27: not everyone wants it): turning the feature on downloads the
 * pinned release from GitHub into Conduit's data folder, checked against the
 * SHA256 below, and turning it off can delete it. Conduit talks to it over
 * stdio MCP (`cua-driver mcp`), one process while the feature is on, with its
 * telemetry off.
 */
import { app, net } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const DRIVER_VERSION = '0.52.0'
const RELEASE = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${DRIVER_VERSION}/`

interface Artifact {
  file: string
  sha256: string
  /** The executable inside the archive. */
  binary: string
}

/** The same pins Hermes' package manager uses (hermes-agent pm/lock.json). */
export const ARTIFACTS: Record<string, Artifact> = {
  'win32-x64': {
    file: `cua-driver-rs-${DRIVER_VERSION}-windows-x86_64-binary.zip`,
    sha256: '788178cbdcce4de0121f6d04ef6cb5e9d512503371e60a70563aa6f69cdd50af',
    binary: 'cua-driver.exe'
  },
  'win32-arm64': {
    file: `cua-driver-rs-${DRIVER_VERSION}-windows-arm64-binary.zip`,
    sha256: '73e0a7daae34b81a15aa16d3827cb44b975254130906f99dfcd49ea4c518d40c',
    binary: 'cua-driver.exe'
  },
  'darwin-arm64': {
    file: `cua-driver-rs-${DRIVER_VERSION}-darwin-universal.tar.gz`,
    sha256: '19e5e652db83cc0324e7a3898ee875b87b265ad7e1c09fd862ef78869480f61d',
    binary: 'CuaDriver.app/Contents/MacOS/cua-driver'
  },
  'darwin-x64': {
    file: `cua-driver-rs-${DRIVER_VERSION}-darwin-universal.tar.gz`,
    sha256: '19e5e652db83cc0324e7a3898ee875b87b265ad7e1c09fd862ef78869480f61d',
    binary: 'CuaDriver.app/Contents/MacOS/cua-driver'
  }
}

export const artifactFor = (platform = process.platform, arch = process.arch): Artifact | null => ARTIFACTS[`${platform}-${arch}`] ?? null

const folder = () => join(app.getPath('userData'), 'cua-driver', DRIVER_VERSION)

export function driverPath(): string | null {
  const artifact = artifactFor()
  if (!artifact) return null
  const path = join(folder(), artifact.binary)
  return existsSync(path) ? path : null
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

let installing: Promise<string> | null = null

/** Downloads, checks and unpacks the driver; the path to its executable. */
export function installDriver(onProgress?: (fraction: number) => void): Promise<string> {
  const existing = driverPath()
  if (existing) return Promise.resolve(existing)
  installing ??= (async () => {
    const artifact = artifactFor()
    if (!artifact) throw new Error('unsupported')
    const response = await net.fetch(RELEASE + artifact.file)
    if (!response.ok || !response.body) throw new Error(`download ${response.status}`)
    const total = Number(response.headers.get('content-length')) || 0
    const chunks: Uint8Array[] = []
    let received = 0
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      if (total) onProgress?.(received / total)
    }
    const bytes = Buffer.concat(chunks)
    if (sha256(bytes) !== artifact.sha256) throw new Error('checksum')
    const target = folder()
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    const archive = join(target, artifact.file)
    writeFileSync(archive, bytes)
    // tar unpacks both: Windows 10 and later ship bsdtar, which reads zips.
    await run('tar', ['-xf', archive, '-C', target])
    rmSync(archive, { force: true })
    const path = driverPath()
    if (!path) throw new Error('unpack')
    return path
  })().finally(() => {
    installing = null
  })
  return installing
}

export function deleteDriver(): void {
  stopDriver()
  rmSync(join(app.getPath('userData'), 'cua-driver'), { recursive: true, force: true })
}

/** One tool result, as cua-driver answers over MCP. */
export interface ToolResult {
  isError?: boolean
  content?: { type: string; text?: string; data?: string; mimeType?: string }[]
  structuredContent?: Record<string, unknown>
}

/** A JSON-RPC client over the driver's stdio, newline-delimited. */
export class McpClient {
  private next = 1
  private buffer = ''
  private waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private closed = false

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (text: string) => this.read(text))
    child.on('exit', () => this.close(new Error('driver exited')))
    child.on('error', error => this.close(error))
    child.stderr.resume()
  }

  get alive() {
    return !this.closed
  }

  private read(text: string) {
    this.buffer += text
    let index: number
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let message: { id?: number; result?: unknown; error?: { message?: string } }
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const pending = typeof message.id === 'number' ? this.waiting.get(message.id) : undefined
      if (!pending) continue
      this.waiting.delete(message.id!)
      if (message.error) pending.reject(new Error(message.error.message ?? 'driver error'))
      else pending.resolve(message.result)
    }
  }

  private close(error: Error) {
    if (this.closed) return
    this.closed = true
    for (const pending of this.waiting.values()) pending.reject(error)
    this.waiting.clear()
  }

  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('driver exited'))
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error('driver timeout'))
      }, timeoutMs)
      this.waiting.set(id, {
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  notify(method: string, params: unknown) {
    if (!this.closed) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<ToolResult> {
    return this.request('tools/call', { name, arguments: args }, timeoutMs) as Promise<ToolResult>
  }

  kill() {
    this.close(new Error('driver stopped'))
    this.child.kill()
  }
}

let client: McpClient | null = null
let starting: Promise<McpClient> | null = null

/** The running driver, started (and the MCP handshake done) on first use. */
export function driver(): Promise<McpClient> {
  if (client?.alive) return Promise.resolve(client)
  starting ??= (async () => {
    const path = driverPath()
    if (!path) throw new Error('not installed')
    const child = spawn(path, ['mcp'], {
      env: { ...process.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const started = new McpClient(child)
    await started.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'conduit-desktop', version: app.getVersion() }
    })
    started.notify('notifications/initialized', {})
    client = started
    return started
  })().finally(() => {
    starting = null
  })
  return starting
}

export function stopDriver(): void {
  client?.kill()
  client = null
}
