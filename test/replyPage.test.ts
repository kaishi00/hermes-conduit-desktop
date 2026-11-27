// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { FunctionComponent } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { settle } from './hookHarness'

afterEach(() => {
  document.body.innerHTML = ''
})

// Imported by path, as the other component tests do: the tests' typecheck draws no JSX.
async function replyPage(): Promise<FunctionComponent<{ html: string; ready: boolean }>> {
  const path = '../src/renderer/src/components/PagePreview.tsx'
  return ((await import(/* @vite-ignore */ path)) as { ReplyPage: FunctionComponent<{ html: string; ready: boolean }> }).ReplyPage
}

function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  return { host, root }
}

describe('HTML written in a reply (#628)', () => {
  it('shows the HTML when its address is refused', async () => {
    ;(window as unknown as { conduit: unknown }).conduit = { pageUrl: () => Promise.reject(new Error('too large')) }
    const { host, root } = mount()
    await act(async () => root.render(createElement(await replyPage(), { html: '<b>Hi</b>', ready: true })))
    await settle()
    expect(host.querySelector('pre.page-source')?.textContent).toBe('<b>Hi</b>')
    act(() => root.unmount())
  })

  it('drops the last page’s address while the next one’s is asked for', async () => {
    let answer: (url: string) => void = () => {}
    const asked: string[] = []
    ;(window as unknown as { conduit: unknown }).conduit = {
      pageUrl: (html: string) => {
        asked.push(html)
        return asked.length === 1 ? Promise.resolve('about:blank#first') : new Promise<string>(resolve => (answer = resolve))
      }
    }
    const { host, root } = mount()
    await act(async () => root.render(createElement(await replyPage(), { html: '<p>one</p>', ready: true })))
    await settle()
    expect(host.innerHTML).toContain('about:blank#first')
    await act(async () => root.render(createElement(await replyPage(), { html: '<p>two</p>', ready: true })))
    await settle()
    expect(host.innerHTML).not.toContain('about:blank#first')
    await act(async () => answer('about:blank#second'))
    await settle()
    expect(host.innerHTML).toContain('about:blank#second')
    act(() => root.unmount())
  })
})
