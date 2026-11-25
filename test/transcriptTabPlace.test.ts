// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyTranscript, type TranscriptItem, type TranscriptState } from '../src/renderer/src/state/transcript'

// happy-dom lays nothing out: each transcript is 2,000 px tall in a 500 px scroller, and its scroll stays where it's put.
const tops = new WeakMap<Element, number>()
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(window as unknown as { conduit: unknown }).conduit = new Proxy({ platform: 'linux' } as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : () => () => {})
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 2000 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return tops.get(this) ?? 0
    },
    set(this: Element, value: number) {
      tops.set(this, Math.max(0, Math.min(1500, value)))
    }
  })
})

// A .tsx module, read as the other component tests read theirs (the tests' tsconfig has no JSX).
const transcriptPath = '../src/renderer/src/components/Transcript.tsx'
let Transcript: Parameters<typeof createElement>[0]
beforeEach(async () => {
  Transcript ??= ((await import(/* @vite-ignore */ transcriptPath)) as { Transcript: typeof Transcript }).Transcript
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
})

const rows = (chat: string, count: number): TranscriptState => ({
  ...emptyTranscript,
  items: Array.from({ length: count }, (_, n) => ({ key: `row-${n}`, kind: 'user', text: `${chat} ${n}` }) as unknown as TranscriptItem)
})

function show(chatId: string, keepsPlace?: (chat: string) => boolean) {
  act(() => root!.render(createElement(Transcript as never, { state: rows(chatId, 12), loading: false, error: null, chatId, keepsPlace })))
}

function readUpTo(scroller: HTMLElement, top: number) {
  act(() => {
    scroller.scrollTop = top
    scroller.dispatchEvent(new Event('scroll'))
  })
}

describe('a chat in a tab keeps the reader’s place (issue 423)', () => {
  it('opens where it was left, and any other chat on its newest rows', () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const inTabs = new Set(['a', 'b'])
    const keepsPlace = (chat: string) => inTabs.has(chat)

    show('a', keepsPlace)
    const scroller = host.querySelector<HTMLElement>('.transcript')!
    expect(scroller.scrollTop).toBe(1500)
    readUpTo(scroller, 320)

    show('b', keepsPlace)
    expect(scroller.scrollTop).toBe(1500)
    show('a', keepsPlace)
    expect(scroller.scrollTop).toBe(320)

    // A chat no tab holds opens on its newest rows, wherever it was left (desktop#467).
    readUpTo(scroller, 200)
    show('c', keepsPlace)
    readUpTo(scroller, 100)
    show('a', keepsPlace)
    expect(scroller.scrollTop).toBe(200)
    show('c', keepsPlace)
    expect(scroller.scrollTop).toBe(1500)
  })

  it('leaves a chat left at its end following its newest rows', () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const keepsPlace = () => true
    show('a', keepsPlace)
    const scroller = host.querySelector<HTMLElement>('.transcript')!
    show('b', keepsPlace)
    show('a', keepsPlace)
    expect(scroller.scrollTop).toBe(1500)
  })

  it('keeps no place without tabs', () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    show('a')
    const scroller = host.querySelector<HTMLElement>('.transcript')!
    readUpTo(scroller, 320)
    show('b')
    show('a')
    expect(scroller.scrollTop).toBe(1500)
  })
})
