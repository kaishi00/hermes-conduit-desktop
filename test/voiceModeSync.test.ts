// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/src/state/voiceList', () => ({ tagVoiceSession: async () => undefined, archiveClassicChat: async () => undefined }))
vi.mock('../src/renderer/src/state/rings', () => ({ useCallPresence: () => undefined }))
vi.mock('../src/renderer/src/components/VoiceCall', () => ({ VoiceCall: () => null }))

import { TranscriptStore } from '../src/renderer/src/state/transcriptStore'
import { emptyTranscript } from '../src/renderer/src/state/transcript'
import { VOICE_MODE_STORAGE_KEY } from '../src/renderer/src/state/gptLive'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface ChatCallState {
  nextMode: string
}
let useChatCall: (options: Record<string, unknown>) => ChatCallState
beforeAll(async () => {
  // The node test tsconfig has no JSX: the hook is loaded the way the other render tests load components.
  const component = '../src/renderer/src/components/ChatCall.tsx'
  ;({ useChatCall } = (await import(/* @vite-ignore */ component)) as { useChatCall: typeof useChatCall })
})

function mount() {
  const store = new TranscriptStore(emptyTranscript)
  let call: ChatCallState
  const root = createRoot(document.createElement('div'))
  const Probe = () => {
    call = useChatCall({
      profile: 'work', chatId: null, liveId: null, connected: true, store, running: false, turnsDone: 0,
      onStop: () => undefined, onCorrected: () => undefined, tell: () => undefined
    })
    return null
  }
  act(() => root.render(createElement(Probe)))
  mounted = root
  return { call: () => call }
}
let mounted: ReturnType<typeof createRoot> | null = null

/** Another window's mode pick (the Live call window's capsule, a chat window) arrives as a storage change (desktop#663). */
function storedElsewhere(key: string | null, mode: string | null) {
  if (key === VOICE_MODE_STORAGE_KEY || key === null) {
    if (mode === null) localStorage.removeItem(VOICE_MODE_STORAGE_KEY)
    else localStorage.setItem(VOICE_MODE_STORAGE_KEY, mode)
  }
  act(() => void window.dispatchEvent(new StorageEvent('storage', { key })))
}

afterEach(() => {
  // Unmounted here, so a failed case doesn't leave its storage listener behind.
  if (mounted) act(() => mounted!.unmount())
  mounted = null
  localStorage.clear()
})

describe('the next call’s mode follows a mode picked in another window', () => {
  it('takes the mode another window stored', () => {
    const view = mount()
    expect(view.call().nextMode).toBe('classic')
    storedElsewhere(VOICE_MODE_STORAGE_KEY, 'gemini')
    expect(view.call().nextMode).toBe('gemini')
  })

  it('reads the mode again when another window clears its storage', () => {
    const view = mount()
    storedElsewhere(VOICE_MODE_STORAGE_KEY, 'gpt')
    expect(view.call().nextMode).toBe('gpt')
    storedElsewhere(null, null)
    expect(view.call().nextMode).toBe('classic')
  })

  it('leaves the mode be for another key', () => {
    const view = mount()
    localStorage.setItem(VOICE_MODE_STORAGE_KEY, 'grok')
    storedElsewhere('conduit.somethingElse', null)
    expect(view.call().nextMode).toBe('classic')
  })
})
