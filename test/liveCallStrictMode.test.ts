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

vi.mock('../src/renderer/src/state/voiceSave', async original => ({
  ...(await original<typeof import('../src/renderer/src/state/voiceSave')>()),
  saveCall: async (_profile: unknown, callId: string) => {
    saves.push(callId)
  }
}))

const saves: string[] = []
let sessions = 0
let peers = 0
let closedPeers = 0

let mints = 0
let opens = 0
let liveIds: string[] = []
let closed: string[] = []
beforeEach(() => {
  sessions = 0
  saves.length = 0
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
  peers = 0
  closedPeers = 0
  class Peer {
    iceGatheringState = 'complete'
    connectionState = 'new'
    localDescription = { sdp: 'v=0' }
    constructor() {
      peers++
    }
    addTrack() {}
    createDataChannel() {
      return { addEventListener() {}, close() {}, send() {}, readyState: 'connecting' }
    }
    async createOffer() {
      return { type: 'offer', sdp: 'v=0' }
    }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    addEventListener() {}
    getSenders() {
      return []
    }
    close() {
      closedPeers++
    }
  }
  ;(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = Peer
  ;(window as unknown as { conduit: unknown }).conduit = {
    liveOpen: async () => {
      const id = `live-${++opens}`
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
    ['Gemini', 'GeminiLiveCall', {}],
    ['Qwen', 'GeminiLiveCall', { provider: 'qwen' }],
    ['Grok', 'GrokLiveCall', {}],
    ['Local', 'LocalLiveCall', {}]
  ])('opens %s once under StrictMode’s double mount', async (_label, name, extra) => {
    const path = `../src/renderer/src/components/${name}.tsx`
    const mod = (await import(/* @vite-ignore */ path)) as Record<string, (props: unknown) => null>
    const Component = mod[name]!
    const host = document.createElement('div')
    const root = createRoot(host)
    const props = { chatId: 'c1', items: [], onSay: () => {}, running: false, turnsDone: 0, lastReply: '', onEnd: () => {}, ...extra }
    act(() => root.render(createElement(StrictMode, null, createElement(Component as never, props))))
    for (let i = 0; i < 6; i++) await settle()
    // The first mount aborts before it opens anything; exactly one socket stays for the real call.
    expect(liveIds.length - closed.length).toBe(1)
    expect(opens + mints).toBe(liveIds.length)
    // The first run's teardown saved its empty call; the real call saves once more when it ends.
    const before = saves.length
    act(() => root.unmount())
    await settle()
    // Teardown closes the surviving socket, too.
    expect(closed).toEqual(liveIds)
    expect(saves.length).toBe(before + 1)
  })

  // Desktop issue 736: GPT-Live starts through WebRTC and a host session, not the relay socket.
  it('opens GPT-Live once under StrictMode’s double mount', async () => {
    const path = '../src/renderer/src/components/GptLiveCall.tsx'
    const mod = (await import(/* @vite-ignore */ path)) as Record<string, (props: unknown) => null>
    const host = document.createElement('div')
    const root = createRoot(host)
    const props = { profile: 'default', chatId: 'c1', items: [], onSay: () => {}, running: false, turnsDone: 0, lastReply: '', onEnd: () => {} }
    act(() => root.render(createElement(StrictMode, null, createElement(mod.GptLiveCall as never, props))))
    for (let i = 0; i < 6; i++) await settle()
    // One host session and one live peer for the real call.
    expect(sessions).toBe(1)
    expect(peers - closedPeers).toBe(1)
    const before = saves.length
    act(() => root.unmount())
    await settle()
    expect(closedPeers).toBe(peers)
    expect(saves.length).toBe(before + 1)
  })
})
