import { describe, expect, it } from 'vitest'
import { mintedSocket } from '../src/shared/ipc'
import { QwenAdapter, QwenLiveError, availability, searchAnswer, sessionUpdate, validVoice } from '../src/renderer/src/state/qwenLive'
import { decode, instructions, setupMessage, toolResponse } from '../src/renderer/src/state/geminiLive'

const QWEN_TOKEN = {
  ok: true,
  provider: 'qwen',
  token: 'st-abc',
  expires_at: '2026-11-18T22:00:00Z',
  model: 'qwen3.8-omni-flash-realtime',
  websocket_url: 'wss://ws1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime',
  voice: 'Tina'
}

describe('Qwen Live on the host', () => {
  it('reads the status', () => {
    expect(availability({ ok: true, provider: 'qwen', available: true, model: 'qwen-x-realtime' })).toEqual({ ok: true, model: 'qwen-x-realtime' })
    expect(availability({ ok: true, available: false, reason: 'no_api_key' })).toEqual({ ok: false, reason: 'no_api_key' })
    expect(availability(null)).toEqual({ ok: false, reason: null })
  })

  it("sends the temporary key only to Alibaba Cloud's realtime path, in the Authorization header", () => {
    expect(mintedSocket(QWEN_TOKEN)).toEqual({
      ok: true,
      url: QWEN_TOKEN.websocket_url,
      headers: { Authorization: 'Bearer st-abc' },
      model: 'qwen3.8-omni-flash-realtime',
      voice: 'Tina'
    })
    const invalid = { ok: false, error: 'Invalid Qwen Live credential.' }
    expect(mintedSocket({ ...QWEN_TOKEN, websocket_url: 'wss://evil.example/api-ws/v1/realtime' })).toEqual(invalid)
    expect(mintedSocket({ ...QWEN_TOKEN, websocket_url: 'wss://x.cn-beijing.maas.aliyuncs.com/other' })).toEqual(invalid)
    expect(mintedSocket({ ...QWEN_TOKEN, token: 'sk-permanent' })).toEqual(invalid)
    expect(mintedSocket({ ...QWEN_TOKEN, websocket_url: 'ws://x.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime' })).toEqual({ ok: false, error: 'malformed' })
  })

  it('bounds the voice as the plugin does', () => {
    expect(validVoice('Serena')).toBe(true)
    expect(validVoice('my_voice-2')).toBe(true)
    expect(validVoice('2bad')).toBe(false)
    expect(validVoice('a b')).toBe(false)
  })

  it("reads the host's web search for the model", () => {
    expect(searchAnswer({ ok: true, results: [{ title: 'Weather', snippet: 'Sunny', url: 'https://w.example' }, { title: 'x' }] })).toEqual({
      results: '1. Weather: Sunny (https://w.example)'
    })
    expect(searchAnswer({ ok: true, results: [] })).toEqual({ results: 'No results.' })
  })
})

describe('Qwen Live session', () => {
  it("turns Gemini's setup into Qwen's session, with the function tools and no Google Search", () => {
    const setup = setupMessage('qwen-m', 'Be brief.', 'Tina', true, 'hermes') as { setup: Record<string, unknown> }
    expect((setup.setup.tools as unknown[]).length).toBe(1)
    const update = sessionUpdate(setup.setup, 'Serena') as { type: string; session: Record<string, any> }
    expect(update.type).toBe('session.update')
    expect(update.session.instructions).toBe('Be brief.')
    expect(update.session.audio.input.format).toEqual({ type: 'pcm', sample_rate: 16000 })
    expect(update.session.audio.output).toEqual({ format: { type: 'pcm', sample_rate: 24000 }, voice: 'Serena' })
    expect(update.session.turn_detection.type).toBe('server_vad')
    const names = update.session.tools.map((tool: any) => tool.function.name)
    expect(names).toEqual([
      'ask_thread',
      'read_last_reply',
      'end_conversation',
      'show_on_screen',
      'start_job',
      'list_jobs',
      'cancel_job',
      'interrupt_job',
      'call_me_when_done',
      'find_chat',
      'read_chat',
      'answer_approval',
      'answer_question',
      'send_request',
      'set_ask_first',
      'recall_memory',
      'web_search'
    ])
    expect(update.session.tools[0].function.parameters.type).toBe('object')
    expect(update.session.tools[0].function.parameters.properties.request.type).toBe('string')
  })

  it('looks things up where the call can', () => {
    expect(instructions({ search: 'hermes' })).toContain('call web_search')
    expect(instructions({ search: 'none' })).toContain('You have no web search')
    expect(instructions({})).toContain('use Google Search')
    expect((setupMessage('m', 'x', null, false, 'none') as any).setup.tools).toEqual([{ functionDeclarations: expect.any(Array) }])
  })

  it('maps audio, transcripts, interruptions and turns to Gemini frames', () => {
    const sent: Record<string, unknown>[] = []
    let n = 0
    const qwen = new QwenAdapter(
      'Tina',
      e => sent.push(e),
      () => `e${++n}`
    )
    const read = (event: object) => {
      const frame = qwen.receive(JSON.stringify(event))
      return frame ? decode(frame) : null
    }
    expect(read({ type: 'session.updated', session: {} })).toEqual([{ type: 'ready' }])
    expect(read({ type: 'response.audio.delta', delta: 'AAA=' })).toEqual([{ type: 'audio', pcm: 'AAA=' }])
    expect(read({ type: 'response.audio_transcript.delta', delta: 'Hi' })).toEqual([{ type: 'output', text: 'Hi' }])
    expect(read({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'hello' })).toEqual([{ type: 'input', text: 'hello' }])
    expect(read({ type: 'input_audio_buffer.speech_started' })).toEqual([{ type: 'interrupted' }])
    expect(read({ type: 'rate_limits.updated' })).toBeNull()
    expect(read({ type: 'response.done', response: { status: 'completed' } })).toEqual([{ type: 'turnComplete' }])
    expect(() => qwen.receive('{"type":"error","error":{"message":"quota"}}')).toThrow(QwenLiveError)
    expect(() => qwen.receive('{"type":"response.done","response":{"status":"failed"}}')).toThrow(QwenLiveError)
    expect(sent).toEqual([])
    qwen.send({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: 'BBB=' } } })
    expect(sent.pop()).toEqual({ type: 'input_audio_buffer.append', audio: 'BBB=', event_id: 'e1' })
    qwen.send({ realtimeInput: { audioStreamEnd: true } })
    expect(atob((sent.pop() as { audio: string }).audio).length).toBe(32000)
  })

  it('answers function calls and asks for a reply only once none is running and no call waits', () => {
    const sent: Record<string, any>[] = []
    const qwen = new QwenAdapter('Tina', e => sent.push(e))
    qwen.receive(JSON.stringify({ type: 'response.created' }))
    qwen.receive(JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', call_id: 'c1', name: 'ask_thread' } }))
    const frame = qwen.receive(JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'c1', arguments: '{"request":"check mail"}' }))
    expect(decode(frame!)).toEqual([{ type: 'toolCall', id: 'c1', name: 'ask_thread', args: { request: 'check mail' } }])
    // A message for the model while the call waits: queued, not answered yet.
    qwen.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'update' }] }], turnComplete: true } })
    expect(sent.map(e => e.type)).toEqual(['conversation.item.create'])
    qwen.receive(JSON.stringify({ type: 'response.done', response: { status: 'completed' } }))
    expect(sent.map(e => e.type)).toEqual(['conversation.item.create'])
    qwen.send(toolResponse('c1', 'ask_thread', { status: 'done', result: 'Two emails.' }, 'WHEN_IDLE'))
    expect(sent[1].item).toEqual({ type: 'function_call_output', call_id: 'c1', output: '{"status":"done","result":"Two emails."}' })
    expect(sent.map(e => e.type)).toEqual(['conversation.item.create', 'conversation.item.create', 'response.create'])
    // Arguments that aren't an object are marked, never run with none.
    const bad = qwen.receive(JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'c2', name: 'ask_thread', arguments: '[1' }))
    expect(decode(bad!)).toEqual([{ type: 'toolCall', id: 'c2', name: 'ask_thread', args: { invalid_arguments: 'true' } }])
  })

  it('lets go of a call a cancelled response never finished', () => {
    const sent: Record<string, any>[] = []
    const qwen = new QwenAdapter('Tina', e => sent.push(e))
    qwen.receive(JSON.stringify({ type: 'response.created' }))
    qwen.receive(JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', call_id: 'c9', name: 'ask_thread' } }))
    qwen.receive(JSON.stringify({ type: 'response.done', response: { status: 'cancelled' } }))
    qwen.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'hi' }] }], turnComplete: true } })
    expect(sent.map(e => e.type)).toEqual(['conversation.item.create', 'response.create'])
  })
})
