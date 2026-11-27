// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settle } from './hookHarness'

const http = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { http: (...args: unknown[]) => http(...args) },
  GatewayError: class extends Error {}
}))

const status = (staged: string | null, unstaged: string | null) => ({
  repo: true,
  root: '/r',
  top: '/r',
  branch: { head: 'main' },
  files: [{ path: 'a.txt', staged, unstaged }]
})

beforeEach(() => http.mockReset())

async function mount(onStatus: (status: unknown) => void) {
  const path = '../src/renderer/src/components/ChangesView.tsx'
  const { ChangesView } = (await import(/* @vite-ignore */ path)) as { ChangesView: (props: unknown) => null }
  const host = document.createElement('div')
  const root = createRoot(host)
  const props = { root: '/r', refreshKey: 0, shown: false, onStatus, onOpenFile: () => {} }
  act(() => root.render(createElement(ChangesView as never, props)))
  return { host, root, rerender: (refreshKey: number) => act(() => root.render(createElement(ChangesView as never, { ...props, refreshKey }))) }
}

describe('the Changes view', () => {
  it("doesn't let a status read that began before an action land over the action's answer (issue 680)", async () => {
    const reported: unknown[] = []
    http.mockResolvedValueOnce(status(null, 'modified'))
    const view = await mount(s => reported.push(s))
    await settle()
    // A read starts (a reply ended), and hangs on a big folder.
    let finishRead: (value: unknown) => void = () => {}
    http.mockImplementationOnce(() => new Promise(resolve => (finishRead = resolve)))
    view.rerender(1)
    await settle()
    // Staging answers first, with the folder after it.
    http.mockResolvedValueOnce({ status: status('modified', null) })
    const stage = [...view.host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Stage')!
    act(() => stage.click())
    await settle()
    finishRead(status(null, 'modified'))
    await settle()
    expect(view.host.querySelector('[aria-label="Unstage"]')).not.toBeNull()
    expect(view.host.querySelector('[aria-label="Stage"]')).toBeNull()
    expect((reported.at(-1) as { files: { staged: string | null }[] }).files[0]!.staged).toBe('modified')
    act(() => view.root.unmount())
  })

  it('gives the bench nothing new when a read finds the folder as it was (issue 679)', async () => {
    const reported: unknown[] = []
    http.mockResolvedValue(status(null, 'modified'))
    const view = await mount(s => reported.push(s))
    await settle()
    view.rerender(1)
    await settle()
    view.rerender(2)
    await settle()
    expect(http).toHaveBeenCalledTimes(3)
    expect(reported).toHaveLength(1)
    http.mockResolvedValue(status('modified', null))
    view.rerender(3)
    await settle()
    expect(reported).toHaveLength(2)
    act(() => view.root.unmount())
  })
})
