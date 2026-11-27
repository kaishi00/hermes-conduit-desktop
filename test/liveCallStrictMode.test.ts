// @vitest-environment happy-dom
import { StrictMode, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settle } from './hookHarness'

vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { http: async () => ({}) },
  keptGateway: () => ({ http: async () => ({}) }),
  dashboardHttp: () => async () => ({}),
  GatewayError: class extends Error {}
}))

let mints = 0
beforeEach(() => {
  mints = 0
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
    liveOpenMinted: async () => {
      mints++
      return { ok: true, id: `live-${mints}` }
    },
    liveClose: () => {},
    liveSend: () => {},
    onLive: () => () => {},
    onEvent: () => () => {},
    httpOutcome: async () => ({ ok: true, result: {} })
  }
})

describe('a live call in a dev build (desktop#669)', () => {
  it('opens its connection under StrictMode’s double mount', async () => {
    const path = '../src/renderer/src/components/GeminiLiveCall.tsx'
    const { GeminiLiveCall } = (await import(/* @vite-ignore */ path)) as { GeminiLiveCall: (props: unknown) => null }
    const host = document.createElement('div')
    const root = createRoot(host)
    const props = { chatId: 'c1', items: [], onSay: () => {}, running: false, turnsDone: 0, lastReply: '', onEnd: () => {} }
    act(() => root.render(createElement(StrictMode, null, createElement(GeminiLiveCall as never, props))))
    for (let i = 0; i < 6; i++) await settle()
    expect(mints).toBe(1)
    act(() => root.unmount())
  })
})
