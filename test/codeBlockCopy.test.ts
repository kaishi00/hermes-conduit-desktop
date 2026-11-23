import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  const store = new Map<string, string>()
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window ?? {}, { conduit: new Proxy({ platform: 'linux' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) }), addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  })
})

// Paths the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
const markdown = '../src/renderer/src/components/Markdown.tsx'
const load = async () =>
  (await import(/* @vite-ignore */ markdown)) as { Markdown: unknown; StreamingMarkdown: unknown; plainText: (node: unknown) => string; codeToCopy: (node: unknown) => string }

describe('a code block in a reply', () => {
  it('has a Copy button that is always drawn, in front of the code', async () => {
    const { Markdown } = await load()
    const html = renderToStaticMarkup(createElement(Markdown as never, { text: 'Send this:\n\n```\nHi Tom,\n\nThanks,\nTalon\n```\n\nDone.' }))
    expect(html).toContain('class="code-block"')
    expect(html).toContain('code-copy')
    expect(html).toContain('>Copy</button>')
    expect(html.indexOf('code-copy')).toBeLessThan(html.indexOf('<pre>'))
    expect(html).toContain('Hi Tom,')
  })

  it('draws one button for each block, and none for inline code', async () => {
    const { Markdown } = await load()
    const html = renderToStaticMarkup(createElement(Markdown as never, { text: 'Run `ls` or:\n\n```sh\na\n```\n\n```sh\nb\n```' }))
    expect(html.match(/code-copy/g)).toHaveLength(2)
    expect(html).toContain('<code>ls</code>')
  })

  it('copies the code as written: nested nodes joined, the fence’s last newline dropped', async () => {
    const { plainText, codeToCopy } = await load()
    expect(plainText(['a', createElement('span', null, 'b\n'), 3])).toBe('ab\n3')
    expect(plainText(null)).toBe('')
    // A fence's children as react-markdown passes them to pre: one code element.
    const fence = createElement('code', { className: 'language-sh' }, 'x\n\ny\n\n')
    expect(codeToCopy(fence)).toBe('x\n\ny\n')
    expect(codeToCopy(createElement('code', null, '\n'))).toBe('')
  })

  it('draws the button in a streaming reply too', async () => {
    const { StreamingMarkdown } = await load()
    const html = renderToStaticMarkup(createElement(StreamingMarkdown as never, { text: 'One:\n\n```\na\n```\n\nTwo' }))
    expect(html.match(/code-copy/g)).toHaveLength(1)
  })
})
