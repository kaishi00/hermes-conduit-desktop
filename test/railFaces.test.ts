// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ''
})

const tile = { key: 'kaleb', host: 'https://a.example', own: true, bot: { name: 'kaleb', title: 'Kaleb' } } as never

describe('the rail’s faces strip (issue 584)', () => {
  it('wears its own badge and names its state in the tooltip', async () => {
    const path = '../src/renderer/src/components/RailFaces'
    const { RailFaces } = await import(/* @vite-ignore */ path)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(RailFaces as never, {
      tiles: [tile],
      running: new Set<string>(),
      workOf: () => ({ needsYou: 2, working: 0 }),
      badgeFor: () => ({ letter: 'A', color: '#fff', name: 'Alpha' }),
      onOpen: () => undefined
    } as never)))
    const face = host.querySelector<HTMLButtonElement>('.rail-face')!
    expect(face.querySelector('.rail-face-badge')).not.toBeNull()
    expect(face.getAttribute('aria-label')).toBe('Kaleb · Alpha · 2 needs you')
    expect(face.getAttribute('title')).toBe('Kaleb · Alpha · 2 needs you')
  })
})
