// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const tagged = vi.fn(async (..._args: unknown[]) => undefined)
const archived = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('../src/renderer/src/state/voiceList', () => ({
  tagVoiceSession: (...args: unknown[]) => tagged(...args),
  archiveClassicChat: (...args: unknown[]) => archived(...args)
}))
vi.mock('../src/renderer/src/state/rings', () => ({ useCallPresence: () => undefined }))
let say: ((words: string) => void) | null = null
vi.mock('../src/renderer/src/components/VoiceCall', () => ({
  VoiceCall: (props: { onSay: (words: string) => void }) => {
    say = props.onSay
    return null
  }
}))

import { TranscriptStore } from '../src/renderer/src/state/transcriptStore'
import { emptyTranscript } from '../src/renderer/src/state/transcript'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The node test tsconfig has no JSX: the hook is loaded the way the other render tests load components.
interface ChatCallState {
  calling: boolean
  start: () => void
  end: () => void
  view: (late: { requests: unknown[]; onSend: (text: string) => Promise<boolean> }) => unknown
}
let useChatCall: (options: Record<string, unknown>) => ChatCallState
beforeAll(async () => {
  const component = '../src/renderer/src/components/ChatCall.tsx'
  ;({ useChatCall } = (await import(/* @vite-ignore */ component)) as { useChatCall: typeof useChatCall })
})

function mount(send: (text: string) => Promise<boolean>) {
  const store = new TranscriptStore(emptyTranscript)
  let call: ChatCallState
  const root = createRoot(document.createElement('div'))
  const Probe = ({ chatId }: { chatId: string | null }) => {
    call = useChatCall({
      profile: 'work', chatId, liveId: chatId, connected: true, store, running: false, turnsDone: 0,
      onStop: () => undefined, onCorrected: () => undefined, tell: () => undefined
    })
    return call.view({ requests: [], onSend: (text: string) => send(text) }) as null
  }
  const draw = (chatId: string | null) => act(() => root.render(createElement(Probe, { chatId })))
  draw(null)
  return { draw, call: () => call, unmount: () => act(() => root.unmount()) }
}

afterEach(() => {
  tagged.mockClear()
  archived.mockClear()
  say = null
})

describe('a Classic call started in the new-chat draft (desktop#538)', () => {
  it('never files or archives a chat it didn’t make', async () => {
    const view = mount(async () => true)
    act(() => view.call().start())
    expect(view.call().calling).toBe(true)
    // Another chat drawn while the call waited (the main window ends the call there; this is the backstop).
    view.draw('chat-x')
    await act(async () => undefined)
    expect(tagged).not.toHaveBeenCalled()
    act(() => view.call().end())
    await act(async () => undefined)
    expect(archived).not.toHaveBeenCalled()
    view.unmount()
  })

  it('files and archives the chat its own first request made', async () => {
    const view = mount(async () => true)
    act(() => view.call().start())
    expect(say).not.toBeNull()
    await act(async () => say!('Book a table for six tonight'))
    view.draw('made-by-call')
    await act(async () => undefined)
    expect(tagged).toHaveBeenCalledWith('work', 'made-by-call', 'classic')
    act(() => view.call().end())
    await act(async () => undefined)
    expect(archived).toHaveBeenCalledWith('work', 'made-by-call')
    view.unmount()
  })
})
