/**
 * Runs one Control from Hermes action with the driver (pcDriver.ts). The
 * plugin sends computer_use's actions (capture, click, type, ...); this maps
 * each to cua-driver's tools, against the window the chat's last capture
 * picked, and shapes the answer the plugin turns into the bot's tool result.
 *
 * Element numbers are the driver's own rows (`[N]` in its tree), so a click
 * on element N goes back as the token `<snapshot>:<N>` of that capture: a
 * number from an older capture is refused by the driver as stale rather than
 * landing on the wrong control. Coordinates are in the screenshot's pixels,
 * which the driver maps back itself.
 */
import type { ToolResult } from './pcDriver'

export interface DriverClient {
  callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<ToolResult>
}

/** What the plugin asked for (pc_control_tool.py's args). */
export interface PcAction {
  action: string
  args: Record<string, unknown>
}

export interface PcResult {
  ok: boolean
  code?: string
  message?: string
  image?: string
  mime?: string
  width?: number
  height?: number
  app?: string
  window_title?: string
  elements?: { index: number; role: string; label: string }[]
  windows?: { app: string; title: string }[]
  apps?: string[]
}

/** The window a chat's last capture picked, and that capture's snapshot. */
export interface Target {
  pid: number
  windowId: number
  app: string
  snapshot: string | null
  /** The whole screen was captured: coordinates are screen-absolute. */
  screen?: boolean
}

export const MAX_IMAGE = 1456
/** Windows the bot never targets by default: Conduit's own control bar. */
export const OWN_TITLES = ['Conduit control']

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const xy = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number') ? [v[0] as number, v[1] as number] : null

export function textOf(result: ToolResult): string {
  return (result.content ?? [])
    .filter(part => part.type === 'text' && part.text)
    .map(part => part.text)
    .join('\n')
}

export function imageOf(result: ToolResult): { image: string; mime: string } | null {
  const part = (result.content ?? []).find(item => item.type === 'image' && item.data)
  return part ? { image: part.data!, mime: part.mimeType || 'image/png' } : null
}

/** The tree's numbered rows: `- [12] Button "Close" [...]`. */
export function elementsOf(markdown: string): { index: number; role: string; label: string }[] {
  const rows: { index: number; role: string; label: string }[] = []
  for (const line of markdown.split('\n')) {
    const match = /^\s*-\s*\[(\d+)\]\s+(\S+)(?:\s+"((?:[^"\\]|\\.)*)")?/.exec(line)
    if (match) rows.push({ index: Number(match[1]), role: match[2]!, label: match[3] ?? '' })
  }
  return rows
}

interface Window {
  app: string
  title: string
  pid: number
  windowId: number
  z: number
  minimized: boolean
}

export function windowsOf(result: ToolResult): Window[] {
  const raw = (result.structuredContent?.windows ?? []) as Record<string, unknown>[]
  return raw
    .flatMap(w => {
      const pid = num(w.pid)
      const windowId = num(w.window_id)
      if (pid === null || windowId === null) return []
      return [{ app: str(w.app_name), title: str(w.title), pid, windowId, z: num(w.z_index) ?? 0, minimized: w.minimized === true }]
    })
    .sort((a, b) => b.z - a.z)
}

/** Which window a capture means: one app's (by name, exact first), else the front one. */
export function pickWindow(windows: Window[], app: string): Window | null {
  const own = (w: Window) => OWN_TITLES.includes(w.title)
  const pool = windows.filter(w => !own(w) && !w.minimized)
  const wanted = app.trim().toLowerCase().replace(/\.exe$/, '')
  if (!wanted) return pool[0] ?? null
  const name = (w: Window) => w.app.toLowerCase().replace(/\.exe$/, '')
  return pool.find(w => name(w) === wanted) ?? pool.find(w => name(w).includes(wanted)) ?? pool.find(w => w.title.toLowerCase().includes(wanted)) ?? null
}

const KEY_ALIASES: Record<string, string> = { enter: 'return', esc: 'escape', del: 'delete', pgup: 'pageup', pgdn: 'pagedown' }
const MODIFIERS = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'cmd', 'command', 'win', 'windows', 'super', 'meta'])

export function parseKeys(keys: string): { key: string; modifiers: string[] } {
  const parts = keys.toLowerCase().split('+').map(p => p.trim()).filter(Boolean)
  const modifiers = parts.filter(p => MODIFIERS.has(p)).map(p => (p === 'control' ? 'ctrl' : p === 'command' ? 'cmd' : p === 'windows' || p === 'super' || p === 'meta' ? 'win' : p))
  const key = parts.filter(p => !MODIFIERS.has(p)).pop() ?? ''
  return { key: KEY_ALIASES[key] ?? key, modifiers }
}

const fail = (message: string, code?: string): PcResult => ({ ok: false, message, ...(code ? { code } : {}) })

function done(result: ToolResult, fallback: string): PcResult {
  const text = textOf(result)
  return result.isError ? fail(text || 'The action failed.') : { ok: true, message: text || fallback }
}

export class Executor {
  private targets = new Map<string, Target>()

  constructor(private readonly client: DriverClient) {}

  forget(session?: string) {
    if (session) this.targets.delete(session)
    else this.targets.clear()
  }

  async run(session: string, request: PcAction): Promise<PcResult> {
    const a = request.args ?? {}
    const target = this.targets.get(session)
    const where = (t: Target) => ({ pid: t.pid, window_id: t.windowId })
    const pointer = (t: Target, element: unknown, coordinate: unknown): Record<string, unknown> | PcResult => {
      if (typeof element === 'number') {
        if (!t.snapshot) return fail('That capture had no elements. Capture again with mode som.', 'stale')
        return { element_token: `${t.snapshot}:${element}` }
      }
      const point = xy(coordinate)
      if (!point) return fail('Give element or coordinate.')
      return t.screen ? { scope: 'desktop', x: point[0], y: point[1] } : { ...where(t), x: point[0], y: point[1] }
    }
    const needTarget = () => fail('Capture first: there is no window to act on yet.', 'no_target')

    switch (request.action) {
      case 'capture':
        return this.capture(session, str(a.mode) || 'som', str(a.app))
      case 'list_apps': {
        const result = await this.client.callTool('list_apps', {})
        const apps = ((result.structuredContent?.apps ?? []) as Record<string, unknown>[])
          .filter(app => app.running === true || app.is_running === true)
          .map(app => str(app.name) || str(app.app_name))
          .filter(Boolean)
        return result.isError ? done(result, '') : { ok: true, apps }
      }
      case 'list_windows': {
        const result = await this.client.callTool('list_windows', { on_screen_only: true })
        return result.isError ? done(result, '') : { ok: true, windows: windowsOf(result).map(w => ({ app: w.app, title: w.title })) }
      }
      case 'launch_app': {
        const result = await this.client.callTool('launch_app', { name: str(a.app) })
        return this.after(session, done(result, `Opened ${str(a.app)}.`), a, str(a.app))
      }
      case 'focus_app': {
        const windows = windowsOf(await this.client.callTool('list_windows', { on_screen_only: false }))
        const window = pickWindow(windows, str(a.app))
        if (!window) return fail(`No window of ${str(a.app)} is open. Use launch_app to open it.`, 'no_window')
        const result = await this.client.callTool('bring_to_front', { pid: window.pid, window_id: window.windowId })
        this.targets.set(session, { pid: window.pid, windowId: window.windowId, app: window.app, snapshot: null })
        return this.after(session, done(result, `${window.app} is in front.`), a, window.app)
      }
      case 'wait': {
        const seconds = Math.max(0, Math.min(30, num(a.seconds) ?? 1))
        await new Promise(resolve => setTimeout(resolve, seconds * 1000))
        return this.after(session, { ok: true, message: `Waited ${seconds} s.` }, a)
      }
    }

    if (!target) return needTarget()
    const modifiers = Array.isArray(a.modifiers) ? a.modifiers.filter((m): m is string => typeof m === 'string') : []
    let result: ToolResult
    switch (request.action) {
      case 'click':
      case 'double_click':
      case 'right_click':
      case 'middle_click': {
        const at = pointer(target, a.element, a.coordinate)
        if ('ok' in at) return at as PcResult
        const button = request.action === 'right_click' ? 'right' : request.action === 'middle_click' ? 'middle' : str(a.button) || 'left'
        result = await this.client.callTool(request.action === 'double_click' ? 'double_click' : 'click', {
          ...at,
          ...(request.action === 'double_click' ? {} : { button }),
          ...(modifiers.length ? { modifier: modifiers } : {})
        })
        break
      }
      case 'drag': {
        const from = xy(a.from_coordinate)
        const to = xy(a.to_coordinate)
        if (!from || !to) return fail('drag needs from_coordinate and to_coordinate on this computer.')
        result = await this.client.callTool('drag', {
          ...(target.screen ? { scope: 'desktop' } : where(target)),
          from_x: from[0],
          from_y: from[1],
          to_x: to[0],
          to_y: to[1]
        })
        break
      }
      case 'scroll': {
        const at = typeof a.element === 'number' && target.snapshot ? { element_token: `${target.snapshot}:${a.element}` } : where(target)
        result = await this.client.callTool('scroll', { ...at, direction: str(a.direction), amount: Math.max(1, Math.min(50, num(a.amount) ?? 3)) })
        break
      }
      case 'type':
        result = await this.client.callTool('type_text', { ...where(target), text: str(a.text) })
        break
      case 'key': {
        const { key, modifiers: held } = parseKeys(str(a.keys))
        if (!key) return fail(`Couldn't read the key in ${JSON.stringify(str(a.keys))}.`)
        result = held.length
          ? await this.client.callTool('hotkey', { ...where(target), keys: [...held, key] })
          : await this.client.callTool('press_key', { ...where(target), key })
        break
      }
      case 'set_value': {
        if (typeof a.element !== 'number' || !target.snapshot) return fail('set_value needs an element from the last capture.', 'stale')
        result = await this.client.callTool('set_value', { element_token: `${target.snapshot}:${a.element}`, value: str(a.value) })
        break
      }
      default:
        return fail(`This computer can't do ${request.action}.`, 'unsupported_action')
    }
    return this.after(session, done(result, 'Done.'), a)
  }

  /** capture_after: the action's answer with a fresh capture of the same window. */
  private async after(session: string, result: PcResult, args: Record<string, unknown>, app = ''): Promise<PcResult> {
    if (!result.ok || args.capture_after !== true) return result
    const target = this.targets.get(session)
    const capture = await this.capture(session, 'som', app || target?.app || '')
    return { ...capture, message: [result.message, capture.message].filter(Boolean).join(' ') }
  }

  private async capture(session: string, mode: string, app: string): Promise<PcResult> {
    if (app.trim().toLowerCase() === 'screen') {
      const result = await this.client.callTool('get_desktop_state', { max_image_dimension: MAX_IMAGE })
      if (result.isError) return done(result, '')
      const image = imageOf(result)
      const sc = result.structuredContent ?? {}
      const previous = this.targets.get(session)
      this.targets.set(session, { pid: previous?.pid ?? 0, windowId: previous?.windowId ?? 0, app: 'screen', snapshot: null, screen: true })
      return {
        ok: true,
        ...(image ?? {}),
        width: num(sc.screenshot_width) ?? undefined,
        height: num(sc.screenshot_height) ?? undefined,
        message: 'The main screen. No element numbers here: capture one app to act by element.'
      }
    }
    const windows = windowsOf(await this.client.callTool('list_windows', { on_screen_only: true }))
    const window = pickWindow(windows, app)
    if (!window) return fail(app ? `No window of ${app} is on screen. Use launch_app or focus_app.` : 'No window is on screen.', 'no_window')
    const args: Record<string, unknown> = { pid: window.pid, window_id: window.windowId, max_image_dimension: MAX_IMAGE }
    if (mode === 'vision') args.include_accessibility_tree = false
    if (mode === 'ax') args.include_screenshot = false
    let result = await this.client.callTool('get_window_state', args)
    let sc = result.structuredContent ?? {}
    // An Electron window (Conduit's own, VS Code, Discord) turns its
    // accessibility tree on at the first read: read it once more.
    if (mode !== 'vision' && !result.isError && !str(sc.tree_markdown).includes('[0]')) {
      result = await this.client.callTool('get_window_state', args)
      sc = result.structuredContent ?? {}
    }
    if (result.isError) return done(result, '')
    const snapshot = str(sc.snapshot_id) || null
    this.targets.set(session, { pid: window.pid, windowId: window.windowId, app: window.app, snapshot })
    const image = mode === 'ax' ? null : imageOf(result)
    return {
      ok: true,
      ...(image ?? {}),
      app: window.app,
      window_title: str(sc.window_title) || window.title,
      width: num(sc.screenshot_width) ?? undefined,
      height: num(sc.screenshot_height) ?? undefined,
      elements: mode === 'vision' ? [] : elementsOf(str(sc.tree_markdown)),
      ...(sc.truncated === true ? { message: 'Only part of the window was read. Capture again after scrolling, or act by coordinate.' } : {})
    }
  }
}
