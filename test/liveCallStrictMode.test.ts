// @vitest-environment happy-dom
import { StrictMode, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settle } from './hookHarness'

const posts: string[] = []
const saves: string[] = []
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: {
    http: async (method: string, path: string, body?: { billing?: string; sdp?: string }) => {
      if (method === 'POST') posts.push(path)
      // GPT-Live's session: an answer it connects with.
      if (method === 'POST' && body?.sdp !== undefined) return { ok: true, auth: body.billing, transport: { type: 'webrtc', sdp: 'v=0\r\n' } }
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

let mints = 0
let opens = 0
let peers = 0
beforeEach(() => {
  mints = 0
  opens = 0
  peers = 0
  posts.length = 0
  saves.length = 0
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
    close() {}
  }
  ;(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = Peer
  ;(window as unknown as { conduit: unknown }).conduit = {
    liveOpenMinted: async () => {
      mints++
      return { ok: true, id: `live-${mints}` }
    },
    liveOpen: async () => {
      opens++
      return { ok: true, id: `socket-${opens}` }
    },
    liveClose: () => {},
    liveSend: () => {},
    onLive: () => () => {},
    onEvent: () => () => {},
    httpOutcome: async () => ({ ok: true, result: {} })
  }
})

describe('a live call in a dev build (desktop#669)', () => {
  // Desktop issue 736: every call, not only the Gemini/Qwen shell.
  const calls = [
    { file: 'GeminiLiveCall', started: () => mints },
    { file: 'GrokLiveCall', started: () => opens },
    { file: 'LocalLiveCall', started: () => opens },
    { file: 'GptLiveCall', started: () => peers }
  ]
  for (const call of calls) {
    it(`${call.file} opens its connection once under StrictMode’s double mount, and the real call saves when it ends`, async () => {
      const path = `../src/renderer/src/components/${call.file}.tsx`
      const module = (await import(/* @vite-ignore */ path)) as Record<string, (props: unknown) => null>
      const host = document.createElement('div')
      const root = createRoot(host)
      const props = { profile: 'default', chatId: 'c1', items: [], onSay: () => {}, running: false, turnsDone: 0, lastReply: '', onEnd: () => {} }
      act(() => root.render(createElement(StrictMode, null, createElement(module[call.file] as never, props))))
      for (let i = 0; i < 6; i++) await settle()
      expect(call.started()).toBe(1)
      // The first run's teardown saved its empty call; the real call saves again when it ends.
      const before = saves.length
      act(() => root.unmount())
      await settle()
      expect(saves.length).toBe(before + 1)
    })
  }
})
