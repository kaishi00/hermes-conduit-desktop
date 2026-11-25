// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { faviconFailed, faviconUrl, fileType, forgetFailedFavicons } from '../src/renderer/src/state/linkMarks'

const testGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
testGlobals.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root | undefined

beforeEach(() => {
  forgetFailedFavicons()
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  host.remove()
})

async function render(text: string, openFile?: (path: string) => void) {
  // The node typecheck cannot follow renderer JSX and aliases; Vite resolves this renderer boundary.
  const path = '../src/renderer/src/components/Markdown.tsx'
  const { Markdown, FileLinks } = (await import(/* @vite-ignore */ path)) as { Markdown: unknown; FileLinks: { Provider: unknown } }
  root = createRoot(host)
  act(() => root!.render(createElement(FileLinks.Provider as never, { value: openFile ?? null } as never, createElement(Markdown as never, { text } as never))))
}

describe('a site’s icon for a link', () => {
  it('is the favicon at the site’s own root, for an https link to a named host', () => {
    expect(faviconUrl('https://example.com/a/b?c=1#d')).toBe('https://example.com/favicon.ico')
    expect(faviconUrl('https://docs.example.com:8443/x')).toBe('https://docs.example.com:8443/favicon.ico')
  })

  it('is none for anything else', () => {
    for (const href of [
      undefined,
      '',
      'not a link',
      'http://example.com/',
      'mailto:a@example.com',
      'conduit://session/abc',
      'https://localhost/x',
      'https://192.168.1.4/x',
      'https://[::1]/x',
      'https://nas.local/x',
      'https://nas.local./x',
      'https://localhost./x',
      'https://hermes.internal/x',
      'https://user:secret@example.com/x'
    ])
      expect([href, faviconUrl(href)]).toEqual([href, null])
  })

  it('is not asked again of a host whose icon failed', () => {
    faviconFailed('https://example.com/a')
    expect(faviconUrl('https://example.com/other')).toBeNull()
    expect(faviconUrl('https://example.com./other')).toBeNull()
    expect(faviconUrl('https://example.org/')).toBe('https://example.org/favicon.ico')
  })
})

describe('a file’s type from its name', () => {
  it('is its extension in capitals, with the type’s name where it has one', () => {
    expect(fileType('src/app.ts')).toEqual({ label: 'TS', name: 'TypeScript' })
    expect(fileType('C:\\site\\Index.HTML')).toEqual({ label: 'HTML', name: 'HTML' })
    expect(fileType('~/notes.md')).toEqual({ label: 'MD', name: 'Markdown' })
    expect(fileType('data.parquet')).toBeNull()
    expect(fileType('build.zig')).toEqual({ label: 'ZIG', name: 'ZIG' })
    expect(fileType('archive.tar.gz')).toEqual({ label: 'GZ', name: 'GZ' })
  })

  it('is none for a folder, a name without a type, a dotfile and a version', () => {
    for (const path of ['docs/', 'a/b/c', 'Makefile', '.env', '/etc/hosts', 'release-1.2', '', 'a.b c']) expect([path, fileType(path)]).toEqual([path, null])
  })
})

describe('a reply’s marks', () => {
  it('draws a link’s icon before its words, and drops it when it fails', async () => {
    await render('See [the docs](https://example.com/docs) and [here](http://plain.example/).')
    const links = [...host.querySelectorAll('a')]
    const icon = links[0]!.querySelector<HTMLImageElement>('img.link-favicon')
    expect(icon?.getAttribute('src')).toBe('https://example.com/favicon.ico')
    expect(icon?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(icon?.getAttribute('alt')).toBe('')
    expect(links[0]!.textContent).toBe('the docs')
    expect(links[1]!.querySelector('img')).toBeNull()
    act(() => icon!.dispatchEvent(new Event('error')))
    expect(host.querySelector('img.link-favicon')).toBeNull()
    expect(faviconUrl('https://example.com/elsewhere')).toBeNull()
  })

  it('draws a file’s type beside its name, whether or not it opens', async () => {
    await render('Edit `src/app.ts`, not `owner/repo` or `docs/`.')
    const codes = [...host.querySelectorAll('code')]
    expect(codes.map(code => code.querySelector('.file-type')?.textContent ?? null)).toEqual(['TS', null, null])
    expect(codes[0]!.querySelector('.file-type')?.getAttribute('title')).toBe('TypeScript')
    expect(codes[0]!.className).toBe('')
    act(() => root!.unmount())
    root = undefined
    const opened: string[] = []
    await render('Edit `src/app.ts`.', path => opened.push(path))
    const link = host.querySelector<HTMLElement>('code.file-link')!
    expect(link.querySelector('.file-type')?.textContent).toBe('TS')
    expect(link.getAttribute('title')).toBe('src/app.ts')
    act(() => link.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(opened).toEqual(['src/app.ts'])
  })

  it('leaves a code block’s code alone', async () => {
    await render('```\nsrc/app.ts\n```')
    expect(host.querySelector('.file-type')).toBeNull()
  })
})
