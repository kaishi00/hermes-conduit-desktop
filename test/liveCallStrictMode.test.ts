// @vitest-environment happy-dom
import { StrictMode, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settle } from './hookHarness'

vi.mock('../src/renderer/src/gateway', () => ({
  gateway: {
    http: async (method: string, path: string) => {
      if (method === 'POST' && String(path).includes('/gpt-live/session')) {
        sessions++
        return { ok: true, auth: 'subscription', transport: { type: 'webrtc', sdp: 'v=0 answer' }, briefing_applied: true }
      }
      return {}
    }
  },
  keptGateway: () => ({ http: async () => ({}) }),
  dashboardHttp: () => async () => ({}),
  GatewayError: class extends Error {}
}))

let sessions = 0

let mints = 0
let opens = 0
let liveIds: string[] = []
let closed: string[] = []
beforeEach(() => {
  mints = 0
  opens = 0
  liveIds = []
  closed = []
  localStorage.clear()
  const track = { stop() {}, getSettings: () => ({}), label: 'mic' }
  ;(navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })
  }
  class Context {
    sampleRate = 16000
    currentTime = 0
    destination = {}
    baseLatency = 0
    outputLatency = 0
    createMediaStreamSource() {
      return { connect() {} }
    }
    createScriptProcessor() {
      return { connect() {}, disconnect() {}, bufferSize: 1024 }
    }
    close() {
      return Promise.resolve()
    }
  }
  ;(globalThis as unknown as { AudioContext: unknown }).AudioContext = Context
  ;(window as unknown as { conduit: unknown }).conduit = {
    liveOpen: async () => {
      opens++
      const id = `live-${++mints}`
      liveIds.push(id)
      return { ok: true, id }
    },
    liveOpenMinted: async () => {
      mints++
      const id = `live-${mints}`
      liveIds.push(id)
      return { ok: true, id }
    },
    liveClose: (id: string) => { closed.push(id) },
    liveSend: () => {},
    onLive: () => () => {},
    onEvent: () => () => {},
    httpOutcome: async () => ({ ok: true, result: {} })
  }
})

describe('a live call in a dev build (desktop#669)', () => {
  it.each([
    ['Gemini', 'GeminiLiveCall'],
    ['Grok', 'GrokLiveCall'],
    ['Local', 'LocalLiveCall']
  ])('opens %s once under StrictMode’s double mount', async (_label, name) => {
    const path = `../src/renderer/src/components/${name}.tsx`
    const mod = (await import(/* @vite-ignore */ path)) as Record<string, (props: unknown) => null>
    const Component = mod[name]!
    const host = document.createElement('div')
    const root = createRoot(host)
    const props = { chatId: 'c1', items: [], onSay: () => {}, running: false, turnsDone: 0, lastReply: '', onEnd: () => {} }
    act(() => root.render(createElement(StrictMode, null, createElement(Component as never, props))))
    for (let i = 0; i < 6; i++) await settle()
    // The first mount's socket is closed at once; exactly one stays for the real call.
    expect(liveIds.length - closed.length).toBe(1)
    act(() => root.unmount())
  })
})
