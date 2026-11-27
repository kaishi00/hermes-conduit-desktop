import { describe, expect, it } from 'vitest'
import { Executor, elementsOf, parseKeys, pickWindow, windowsOf, type DriverClient } from '../src/main/pcExecutor'
import type { ToolResult } from '../src/main/pcDriver'
import { askingProfiles, requestsFrom } from '../src/renderer/src/state/pcControl'
import { artifactFor, sha256 } from '../src/main/pcDriver'

const WINDOWS: ToolResult = {
  structuredContent: {
    windows: [
      { app_name: 'claude.exe', title: 'Claude', pid: 2, window_id: 20, z_index: 17 },
      { app_name: 'Notepad.exe', title: 'notes.txt - Notepad', pid: 3, window_id: 30, z_index: 5 },
      { app_name: 'Conduit.exe', title: 'Conduit control', pid: 1, window_id: 10, z_index: 99 },
      { app_name: 'Discord.exe', title: 'Discord', pid: 4, window_id: 40, z_index: 50, minimized: true }
    ]
  }
}

const TREE = '- Window "Notepad"\n  - [0] Document "Text editor" [actions=[set_value]]\n    - [1] Button "Close" [actions=[invoke]]\n  - Text "not numbered"'

class FakeDriver implements DriverClient {
  calls: { name: string; args: Record<string, unknown> }[] = []
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args })
    if (name === 'list_windows') return WINDOWS
    if (name === 'get_window_state')
      return {
        content: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }],
        structuredContent: { snapshot_id: 's00000007', tree_markdown: TREE, window_title: 'notes.txt - Notepad', screenshot_width: 800, screenshot_height: 600 }
      }
    return { content: [{ type: 'text', text: `${name} ok` }] }
  }
}

describe('pcExecutor', () => {
  it('reads the numbered rows of the tree', () => {
    expect(elementsOf(TREE)).toEqual([
      { index: 0, role: 'Document', label: 'Text editor' },
      { index: 1, role: 'Button', label: 'Close' }
    ])
  })

  it('picks the front window, never its own bar or a minimized one, and an app by name', () => {
    const windows = windowsOf(WINDOWS)
    expect(pickWindow(windows, '')?.title).toBe('Claude')
    expect(pickWindow(windows, 'notepad')?.windowId).toBe(30)
    expect(pickWindow(windows, 'Discord')).toBeNull()
  })

  it('reads key combos the way computer_use writes them', () => {
    expect(parseKeys('ctrl+s')).toEqual({ key: 's', modifiers: ['ctrl'] })
    expect(parseKeys('Enter')).toEqual({ key: 'return', modifiers: [] })
    expect(parseKeys('cmd+shift+t')).toEqual({ key: 't', modifiers: ['cmd', 'shift'] })
  })

  it('captures a window, then clicks its element by that snapshot’s token', async () => {
    const fake = new FakeDriver()
    const run = new Executor(fake)
    const capture = await run.run('chat-1', { action: 'capture', args: { app: 'notepad' } })
    expect(capture).toMatchObject({ ok: true, image: 'aGk=', app: 'Notepad.exe', width: 800 })
    expect(capture.elements?.[1]).toEqual({ index: 1, role: 'Button', label: 'Close' })
    await run.run('chat-1', { action: 'click', args: { element: 1 } })
    expect(fake.calls.at(-1)).toEqual({ name: 'click', args: { element_token: 's00000007:1', button: 'left' } })
    await run.run('chat-1', { action: 'type', args: { text: 'hello' } })
    expect(fake.calls.slice(-2)).toEqual([
      { name: 'bring_to_front', args: { pid: 3, window_id: 30 } },
      { name: 'type_text', args: { pid: 3, window_id: 30, text: 'hello', delivery_mode: 'foreground' } }
    ])
    await run.run('chat-1', { action: 'key', args: { keys: 'ctrl+s' } })
    expect(fake.calls.at(-1)).toEqual({ name: 'press_key', args: { pid: 3, window_id: 30, key: 's', modifiers: ['ctrl'], delivery_mode: 'foreground' } })
  })

  it('types nothing when the window can’t come to the front', async () => {
    const fake = new FakeDriver()
    const real = fake.callTool.bind(fake)
    fake.callTool = async (name, args) => (name === 'bring_to_front' ? (fake.calls.push({ name, args }), { isError: true }) : real(name, args))
    const run = new Executor(fake)
    await run.run('chat-1', { action: 'capture', args: { app: 'notepad' } })
    expect(await run.run('chat-1', { action: 'type', args: { text: 'hello' } })).toMatchObject({ ok: false, code: 'not_in_front' })
    expect(fake.calls.some(c => c.name === 'type_text')).toBe(false)
  })

  it('keeps each chat’s window apart, and asks for a capture first', async () => {
    const run = new Executor(new FakeDriver())
    await run.run('chat-1', { action: 'capture', args: {} })
    expect(await run.run('chat-2', { action: 'click', args: { element: 1 } })).toMatchObject({ ok: false, code: 'no_target' })
  })

  it('clicks the whole screen in screen pixels', async () => {
    const fake = new FakeDriver()
    const run = new Executor(fake)
    await run.run('chat-1', { action: 'capture', args: { app: 'screen' } })
    expect(fake.calls[0]).toEqual({ name: 'get_desktop_state', args: { max_image_dimension: 1456 } })
    await run.run('chat-1', { action: 'right_click', args: { coordinate: [100, 200] } })
    expect(fake.calls.at(-1)).toEqual({ name: 'click', args: { scope: 'desktop', x: 100, y: 200, button: 'right' } })
    await run.run('chat-1', { action: 'scroll', args: { direction: 'down', coordinate: [5, 6] } })
    expect(fake.calls.at(-1)).toEqual({ name: 'scroll', args: { scope: 'desktop', x: 5, y: 6, direction: 'down', amount: 3 } })
  })

  it('captures again after an action when asked', async () => {
    const fake = new FakeDriver()
    const run = new Executor(fake)
    await run.run('chat-1', { action: 'capture', args: { app: 'notepad' } })
    const after = await run.run('chat-1', { action: 'click', args: { element: 0, capture_after: true } })
    expect(after.image).toBe('aGk=')
    expect(fake.calls.map(c => c.name).slice(-3)).toEqual(['click', 'list_windows', 'get_window_state'])
  })
})

describe('pcControl', () => {
  it('reads /pc/next and names the bot', () => {
    const body = { requests: [{ id: 'r1', session: 's1', chat: 'Tidy', action: 'capture', args: { mode: 'som' }, needs_ok: true }, { id: '' }] }
    expect(requestsFrom(body, 'nahida', 'Nahida')).toEqual([
      { id: 'r1', session: 's1', chat: 'Tidy', action: 'capture', args: { mode: 'som' }, needs_ok: true, bot: 'Nahida', profile: 'nahida' }
    ])
  })

  it('asks only for bots picked, still on the dashboard, once the driver is there', () => {
    const state = { on: true, bots: ['nahida', 'gone'], driver: 'ready' } as never
    expect(askingProfiles(state, [{ name: 'nahida' }, { name: 'furina' }])).toEqual(['nahida'])
    expect(askingProfiles({ ...(state as object), driver: 'missing' } as never, [{ name: 'nahida' }])).toEqual([])
    expect(askingProfiles({ ...(state as object), on: false } as never, [{ name: 'nahida' }])).toEqual([])
  })

  it('pins a driver build for Windows and the Mac', () => {
    expect(artifactFor('win32', 'x64')?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(artifactFor('darwin', 'arm64')?.binary).toContain('cua-driver')
    expect(artifactFor('linux', 'x64')).toBeNull()
    expect(sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
