import { describe, expect, it } from 'vitest'
import { chatDisplay, thinkingMode, withThinking } from '../src/renderer/src/state/display'
import { fieldValue, chatSections, withValue } from '../src/renderer/src/state/profileConfig'

describe('chat display', () => {
  it('reads Thinking as the phone does: unset shows, off with Conduit’s key tells On request from Off', () => {
    expect(thinkingMode({})).toBe('show')
    expect(thinkingMode({ display: { show_reasoning: false } })).toBe('on_request')
    expect(thinkingMode({ display: { show_reasoning: false, conduit_thinking_on_request: false } })).toBe('off')
    expect(chatDisplay({ display: { tool_progress: 'off' } }).toolCards).toBe(false)
    expect(chatDisplay({ display: { tool_progress: 'all' } }).toolCards).toBe(true)
  })
  it('writes Thinking into the display block, Show leaving Conduit’s key', () => {
    expect(withThinking({ display: { x: 1 } }, 'off').display).toEqual({ x: 1, show_reasoning: false, conduit_thinking_on_request: false })
    expect(withThinking({ display: { conduit_thinking_on_request: false } }, 'show').display).toEqual({
      show_reasoning: true,
      conduit_thinking_on_request: false
    })
  })
  it('the Chat rows read and save them', () => {
    const fields = chatSections({})[0].fields
    const thinking = fields.find(f => f.key === 'conduit.reasoning_display')!
    const tools = fields.find(f => f.key === 'display.tool_progress')!
    expect(fieldValue({ display: { show_reasoning: false } }, thinking)).toBe('on_request')
    expect(fieldValue({ display: { tool_progress: 'off' } }, tools)).toBe(false)
    expect(withValue({}, 'conduit.reasoning_display', 'on_request')).toEqual({ display: { show_reasoning: false, conduit_thinking_on_request: true } })
  })
})

describe('tool card details', () => {
  it('opens finished cards when Keep tool cards expanded is on', () => {
    expect(chatDisplay({}).expandTools).toBe(false)
    expect(chatDisplay({ display: { expand_tools: true } }).expandTools).toBe(true)
  })
  it('shows JSON indented and cuts long text', async () => {
    const { toolDetail } = await import('../src/renderer/src/state/transcript')
    expect(toolDetail({ path: 'a.txt' })).toBe('{\n  "path": "a.txt"\n}')
    expect(toolDetail('{"ok":true}')).toBe('{\n  "ok": true\n}')
    expect(toolDetail('plain output ')).toBe('plain output')
    expect(toolDetail({})).toBeUndefined()
    expect(toolDetail(null)).toBeUndefined()
    expect(toolDetail('x'.repeat(10), 4)).toBe('xxxx…')
  })
})

describe('tool details from the REST transcript', () => {
  it('fills a history row’s input and output by call id', async () => {
    const { attachBoards, missingDetails, toolAnswers, toolArgs } = await import('../src/renderer/src/state/transcript')
    const page = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'terminal', arguments: '{"command":"ls"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: 'a.txt' }
      ]
    }
    const state = { items: [{ kind: 'tool' as const, key: 'k', toolId: 'c1', name: 'terminal', status: 'done' as const }], running: false }
    expect(missingDetails(state)).toBe(true)
    const next = attachBoards(state, toolAnswers(page), toolArgs(page))
    expect(next.items[0]).toMatchObject({ args: '{\n  "command": "ls"\n}', result: 'a.txt' })
    expect(missingDetails(next)).toBe(false)
    expect(attachBoards(next, toolAnswers(page), toolArgs(page))).toBe(next)
  })
})

describe('boards from the REST transcript', () => {
  it('restores a board whose call went through the tool_call wrapper', async () => {
    const { attachBoards, toolAnswers, toolArgs, toolNames } = await import('../src/renderer/src/state/transcript')
    const shown = JSON.stringify({ cards: [{ type: 'callout', title: 'Heads up', text: 'Hi' }] })
    const page = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'w1', function: { name: 'tool_call', arguments: '{"tool":"conduit_show"}' } }] },
        { role: 'tool', tool_call_id: 'w1', tool_name: 'conduit_show', content: shown },
        { role: 'tool', tool_call_id: 'w2', tool_name: 'terminal', content: shown }
      ]
    }
    const state = {
      items: [
        { kind: 'tool' as const, key: 'a', toolId: 'w1', name: 'tool_call', status: 'done' as const },
        { kind: 'tool' as const, key: 'b', toolId: 'w2', name: 'tool_call', status: 'done' as const }
      ],
      running: false
    }
    expect(toolNames(page)).toEqual(new Map([['w1', 'conduit_show'], ['w2', 'terminal']]))
    const next = attachBoards(state, toolAnswers(page), toolArgs(page), toolNames(page))
    expect(next.items[0]).toMatchObject({ board: { cards: [{ type: 'callout', title: 'Heads up', text: 'Hi' }], tabs: false, next: [] } })
    // Another tool's answer is no board, whatever its text says.
    expect(next.items[1]).not.toHaveProperty('board')
    expect(attachBoards(next, toolAnswers(page), toolArgs(page), toolNames(page))).toBe(next)
  })
})

describe('self-improvement reviews', () => {
  it('reads a review row as the phone does', async () => {
    const { reviewFromText, fromHistory, applyEvent } = await import('../src/renderer/src/state/transcript')
    expect(reviewFromText('💾 Self-improvement review: Memory ➕ likes tea · Memory ✏️ lives in Paris')).toEqual({
      summary: 'Memory updated',
      details: ['Memory ➕ likes tea', 'Memory ✏️ lives in Paris']
    })
    expect(reviewFromText('💾 Self-improvement review: Memory ➕ a · Skill ➕ b')?.summary).toBe('Memory and skills updated')
    expect(reviewFromText('💾 Self-improvement review: nothing new')).toEqual({ summary: 'nothing new', details: [] })
    expect(reviewFromText('hello')).toBeNull()
    expect(reviewFromText('💾 Saved two facts', true)).toEqual({ summary: 'Saved two facts', details: [] })
    const items = fromHistory([
      { role: 'system', content: '💾 Self-improvement review: Skill ➕ deploy' },
      { role: 'system', content: 'other' }
    ])
    expect(items).toMatchObject([{ kind: 'review', summary: 'Skill updated', details: ['Skill ➕ deploy'] }])
    const live = applyEvent({ items: [], running: false }, { type: 'review.summary', payload: { text: 'Saved one fact', details: ['Memory ➕ x'] } })
    expect(live.items[0]).toMatchObject({ kind: 'review', summary: 'Saved one fact', details: ['Memory ➕ x'] })
  })
  it('follows Self-improvement updates', async () => {
    const { showsReviews } = await import('../src/renderer/src/state/display')
    expect(showsReviews(undefined)).toBe(true)
    expect(showsReviews('default')).toBe(true)
    expect(showsReviews(' Off ')).toBe(false)
    expect(showsReviews(false)).toBe(false)
    expect(chatDisplay({ display: { memory_notifications: 'off' } }).showReviews).toBe(false)
  })
})

describe('cron reports in a Bot Chat', () => {
  it('reads the plugin’s note as a report, not a message of yours', async () => {
    const { cronReport, fromHistory } = await import('../src/renderer/src/state/transcript')
    const note = '[Cron job "Morning news" report: shown in the chat, no reply asked for]\r\n\r\nThree stories today.'
    expect(cronReport(note)).toEqual({ job: 'Morning news', report: 'Three stories today.' })
    expect(cronReport('[Cron job "" report: shown in the chat, no reply asked for]')).toBeNull()
    expect(cronReport('hello')).toBeNull()
    expect(fromHistory([{ role: 'user', content: note }])).toMatchObject([{ kind: 'cron', job: 'Morning news' }])
  })
})
