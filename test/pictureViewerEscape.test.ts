// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

// Paths the node typecheck doesn't follow: the renderer's, checked by tsconfig.web.json.
const picture = '../src/renderer/src/components/Picture.tsx'

type PictureModule = {
  PictureViewerHost: (p: { children: unknown }) => null
  PictureImage: (p: { src: string; name: string }) => null
}

describe('Escape with the picture viewer open over a sheet', () => {
  it('closes the viewer alone; the next Escape reaches the sheet', async () => {
    Object.assign(window, { conduit: new Proxy({ platform: 'linux' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) }) })
    const { PictureViewerHost, PictureImage } = (await import(/* @vite-ignore */ picture)) as PictureModule
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(PictureViewerHost, null, createElement(PictureImage, { src: 'data:image/png;base64,AQID', name: 'plant' }))))
    // A sheet or file viewer the picture opened from, listening as they do.
    const sheetClosed = vi.fn()
    window.addEventListener('keydown', event => event.key === 'Escape' && sheetClosed(), true)
    act(() => host.querySelector<HTMLButtonElement>('.picture-button')!.click())
    expect(host.querySelector('.picture-viewer')).not.toBeNull()

    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(host.querySelector('.picture-viewer')).toBeNull()
    expect(sheetClosed).not.toHaveBeenCalled()

    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(sheetClosed).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
  })
})
