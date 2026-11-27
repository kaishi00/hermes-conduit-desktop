// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settle } from './hookHarness'

/** What the main process answers each copy: true when the system read the bytes as a picture. */
const copyImage = vi.fn(async (_bytes: ArrayBuffer) => true)

beforeEach(() => {
  copyImage.mockReset()
  copyImage.mockResolvedValue(true)
  Object.assign(window, {
    conduit: new Proxy({ platform: 'linux', copyImage } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) })
  })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Paths the node typecheck doesn't follow: the renderer's, checked by tsconfig.web.json.
const picture = '../src/renderer/src/components/Picture.tsx'
const saveMedia = '../src/renderer/src/state/saveMedia.ts'

type PictureModule = {
  PictureViewerHost: (p: { children: unknown }) => null
  PictureImage: (p: { src: string; name: string }) => null
}

async function mount(src: string) {
  const { PictureViewerHost, PictureImage } = (await import(/* @vite-ignore */ picture)) as PictureModule
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const draw = (shown: string) => act(() => root.render(createElement(PictureViewerHost, null, createElement(PictureImage, { src: shown, name: 'cat' }))))
  draw(src)
  const copy = () => [...host.querySelectorAll<HTMLButtonElement>('.picture-viewer-save')].find(b => b.textContent !== 'Download')
  return {
    open: () => act(() => host.querySelector<HTMLButtonElement>('.picture-button')!.click()),
    copy,
    label: () => copy()?.textContent,
    draw,
    close: () => act(() => host.querySelector<HTMLButtonElement>('.picture-viewer-close')!.click()),
    unmount: () => act(() => root.unmount())
  }
}

describe("the picture viewer's Copy", () => {
  it('sits beside Download, copies the picture and says Copied for 1.5 s', async () => {
    const view = await mount('data:image/png;base64,AQID')
    view.open()
    expect(view.label()).toBe('Copy')
    act(() => view.copy()!.click())
    await act(settle)
    expect([...new Uint8Array(copyImage.mock.calls[0]![0])]).toEqual([1, 2, 3])
    expect(view.label()).toBe('Copied')
    act(() => vi.advanceTimersByTime(1500))
    expect(view.label()).toBe('Copy')
    view.unmount()
  })

  it("says Couldn't copy when nothing reached the clipboard", async () => {
    copyImage.mockResolvedValue(false)
    const view = await mount('data:image/png;base64,AQID')
    view.open()
    act(() => view.copy()!.click())
    await act(settle)
    expect(view.label()).toBe("Couldn't copy")
    view.unmount()
  })

  it('keeps its note for the picture it copied, not one shown in its place', async () => {
    const view = await mount('data:image/png;base64,AQID')
    view.open()
    act(() => view.copy()!.click())
    await act(settle)
    expect(view.label()).toBe('Copied')
    view.close()
    view.draw('data:image/png;base64,BAUG')
    view.open()
    expect(view.label()).toBe('Copy')
    view.unmount()
  })
})

describe('copying a picture the system reads only as the page draws it', () => {
  it('sends a PNG the page drew of it', async () => {
    vi.useRealTimers()
    const png = new Uint8Array([137, 80, 78, 71])
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        naturalWidth = 2
        naturalHeight = 3
        width = 2
        height = 3
        decode = async () => undefined
      }
    )
    const drawn: unknown[] = []
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return create(tag)
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: (...args: unknown[]) => drawn.push(args) }),
        toBlob: (done: (blob: Blob | null) => void, type: string) => done(new Blob([png], { type }))
      }
    }) as typeof document.createElement)
    copyImage.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { copyPicture } = (await import(/* @vite-ignore */ saveMedia)) as { copyPicture: (src: string) => Promise<boolean> }
    expect(await copyPicture('data:image/webp;base64,AQID')).toBe(true)
    expect(drawn).toHaveLength(1)
    expect(copyImage).toHaveBeenCalledTimes(2)
    expect([...new Uint8Array(copyImage.mock.calls[1]![0])]).toEqual([...png])
    vi.restoreAllMocks()
  })
})
