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
    // The wrapped rows are shown under the tool they ran, as the live events are.
    expect(next.items[0]).toMatchObject({ name: 'conduit_show', board: { cards: [{ type: 'callout', title: 'Heads up', text: 'Hi' }], tabs: false, next: [] } })
    // Another tool's answer is no board, whatever its text says.
    expect(next.items[1]).toMatchObject({ name: 'terminal' })
    expect(next.items[1]).not.toHaveProperty('board')
    expect(attachBoards(next, toolAnswers(page), toolArgs(page), toolNames(page))).toBe(next)
  })

  it('leaves rows alone when the page carries no names', async () => {
    const { attachBoards } = await import('../src/renderer/src/state/transcript')
    const state = {
      items: [{ kind: 'tool' as const, key: 'a', toolId: 'w1', name: 'tool_call', status: 'done' as const }],
      running: false
    }
    expect(attachBoards(state, new Map(), new Map(), new Map())).toBe(state)
  })

  it("renames only what the page's answer names, and keeps a matching name's row identical", async () => {
    const { attachBoards, toolNames } = await import('../src/renderer/src/state/transcript')
    const page = {
      messages: [
        { role: 'tool', tool_call_id: 'w1', tool_name: 'conduit_show', content: '' },
        { role: 'tool', tool_call_id: 'w2', tool_name: 'tool_call', content: '' }
      ]
    }
    const state = {
      items: [
        { kind: 'tool' as const, key: 'a', toolId: 'w1', name: 'tool_call', status: 'done' as const },
        { kind: 'tool' as const, key: 'b', toolId: 'w2', name: 'tool_call', status: 'done' as const }
      ],
      running: false
    }
    const next = attachBoards(state, new Map(), new Map(), toolNames(page))
    expect(next.items[0]).toMatchObject({ name: 'conduit_show' })
    // The page names w2 the wrapper too: nothing to change, so the row stays the same object.
    expect(next.items[1]).toBe(state.items[1])
  })

  it("shows a renamed wrapped call's own arguments, not the wrapper's envelope", async () => {
    const { attachBoards, toolArgs, toolNames } = await import('../src/renderer/src/state/transcript')
    const page = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'w1', function: { name: 'tool_call', arguments: '{"name":"conduit_show","arguments":{"path":"/x"}}' } }] },
        { role: 'tool', tool_call_id: 'w1', tool_name: 'conduit_show', content: '' }
      ]
    }
    const state = {
      items: [{ kind: 'tool' as const, key: 'a', toolId: 'w1', name: 'tool_call', status: 'done' as const }],
      running: false
    }
    const next = attachBoards(state, new Map(), toolArgs(page), toolNames(page))
    expect(next.items[0]).toMatchObject({ name: 'conduit_show', args: '{\n  "path": "/x"\n}' })
    // An envelope naming another tool stays the envelope: only the verified answer's tool is trusted.
    const other = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'w1', function: { name: 'tool_call', arguments: '{"name":"web_search","arguments":{}}' } }] },
        { role: 'tool', tool_call_id: 'w1', tool_name: 'conduit_show', content: '' }
      ]
    }
    const diverged = attachBoards(state, new Map(), toolArgs(other), toolNames(other))
    expect(diverged.items[0]).toMatchObject({ name: 'conduit_show', args: '{\n  "name": "web_search",\n  "arguments": {}\n}' })
  })
})

describe('wrapped calls in saved history', () => {
  it("draws a resumed wrapped call under the tool its envelope names, with the tool's own arguments", async () => {
    const { fromHistory } = await import('../src/renderer/src/state/transcript')
    const items = fromHistory([
      { role: 'tool', name: 'tool_call', tool_call_id: 'w1', args: '{"name":"conduit_show","arguments":{"path":"/x"}}', content: '' },
      { role: 'tool', name: 'tool_call', tool_call_id: 'w2', args: '{"name":"terminal"}', content: '' },
      { role: 'tool', name: 'tool_call', tool_call_id: 'w3', args: '{"calls":[{"name":"terminal"},{"name":"web_search"}]}', content: '' },
      { role: 'tool', name: 'tool_call', tool_call_id: 'w4', args: '{"name":"connectors__slack"}', content: '' },
      { role: 'tool', name: 'tool_call', tool_call_id: 'w5', args: 'not-json{', content: '' },
      { role: 'tool', name: 'tool_call', tool_call_id: 'w6', args: JSON.stringify(JSON.stringify({ name: 'conduit_show', arguments: { a: 1 } })), content: '' },
      { role: 'tool', name: 'terminal', tool_call_id: 'w7', args: '{"plain":"envelope"}', content: '' }
    ])
    expect(items[0]).toMatchObject({ name: 'conduit_show', args: '{\n  "path": "/x"\n}' })
    // A tool that took no arguments shows no Input.
    expect(items[1]).toMatchObject({ name: 'terminal' })
    expect((items[1] as { args?: unknown }).args).toBeUndefined()
    // A batch, a connector call and a malformed envelope keep the wrapper.
    expect(items[2]).toMatchObject({ name: 'tool_call' })
    expect(items[3]).toMatchObject({ name: 'tool_call' })
    expect(items[4]).toMatchObject({ name: 'tool_call', args: 'not-json{' })
    // A string-encoded envelope reads the same as the object.
    expect(items[5]).toMatchObject({ name: 'conduit_show', args: '{\n  "a": 1\n}' })
    // A concrete tool's row is never touched.
    expect(items[6]).toMatchObject({ name: 'terminal', args: '{\n  "plain": "envelope"\n}' })
  })

  it('fills a wrapped row from the kept copy and adopts its verified name', async () => {
    const { withKeptDetails } = await import('../src/renderer/src/state/transcript')
    const kept = {
      items: [
        {
          kind: 'tool' as const,
          key: 'row-1',
          toolId: 'w1',
          name: 'conduit_show',
          status: 'done' as const,
          args: '{\n  "path": "/x"\n}',
          board: { cards: [{ type: 'callout', title: 'Heads up', text: 'Hi' }], tabs: false, next: [] }
        }
      ],
      running: false
    }
    const fresh = {
      items: [{ kind: 'tool' as const, key: 'row-1', toolId: 'w1', name: 'tool_call', status: 'done' as const }],
      running: false
    }
    const next = withKeptDetails(fresh, kept)
    expect(next.items[0]).toMatchObject({ name: 'conduit_show', args: '{\n  "path": "/x"\n}' })
    expect(next.items[0]).toHaveProperty('board')
    // Nothing to fill: the state comes back untouched.
    expect(withKeptDetails(next, kept)).toBe(next)
  })

  it('keeps a fresh verified name over a stale kept wrapper name', async () => {
    const { withKeptDetails } = await import('../src/renderer/src/state/transcript')
    const kept = {
      items: [
        {
          kind: 'tool' as const,
          key: 'row-1',
          toolId: 'w1',
          name: 'tool_call',
          status: 'done' as const,
          args: '{\n  "envelope": true\n}',
          result: 'The kept answer.'
        }
      ],
      running: false
    }
    const fresh = {
      items: [{ kind: 'tool' as const, key: 'row-1', toolId: 'w1', name: 'conduit_show', status: 'done' as const }],
      running: false
    }
    const next = withKeptDetails(fresh, kept)
    // The envelope already named this row: a stale kept copy must not undo it.
    expect(next.items[0]).toMatchObject({ name: 'conduit_show', result: 'The kept answer.' })
  })

  it('keeps a no-argument wrapped call argumentless through the boards pass', async () => {
    const { attachBoards, fromHistory, toolAnswers, toolArgs, toolNames } = await import('../src/renderer/src/state/transcript')
    const envelope = '{"name":"conduit_show"}'
    const rows = [
      { role: 'assistant', tool_calls: [{ id: 'w1', function: { name: 'tool_call', arguments: envelope } }] },
      { role: 'tool', name: 'tool_call', tool_call_id: 'w1', args: envelope, content: '' }
    ]
    const page = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'w1', function: { name: 'tool_call', arguments: envelope } }] },
        { role: 'tool', tool_call_id: 'w1', tool_name: 'conduit_show', content: JSON.stringify({ cards: [{ type: 'callout', title: 'Heads up', text: 'Hi' }] }) }
      ]
    }
    const state = { items: fromHistory(rows), running: false }
    const next = attachBoards(state, toolAnswers(page), toolArgs(page), toolNames(page))
    expect(next.items[0]).toMatchObject({ name: 'conduit_show' })
    // The envelope must not resurface as the tool's Input.
    expect((next.items[0] as { args?: unknown }).args).toBeUndefined()
    // Nothing left to fill: the same objects come back.
    expect(attachBoards(next, toolAnswers(page), toolArgs(page), toolNames(page))).toBe(next)
  })
})

describe('wrapped call restore leftovers (#425, #429)', () => {
  const cards = [{ type: 'callout', title: 'Heads up', text: 'Hi' }]

  it('restores a show that answered only ok from the cards it was given', async () => {
    const { attachBoards, fromHistory, toolAnswers, toolArgs, toolNames } = await import('../src/renderer/src/state/transcript')
    const page = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 's1', function: { name: 'conduit_show', arguments: JSON.stringify({ cards }) } }] },
        { role: 'tool', tool_call_id: 's1', tool_name: 'conduit_show', content: '{"ok":true}' },
        { role: 'assistant', tool_calls: [{ id: 'w1', function: { name: 'tool_call', arguments: JSON.stringify({ name: 'conduit_show', arguments: { cards } }) } }] },
        { role: 'tool', tool_call_id: 'w1', tool_name: 'conduit_show', content: '{"ok":true}' }
      ]
    }
    const state = {
      items: [
        { kind: 'tool' as const, key: 'a', toolId: 's1', name: 'conduit_show', status: 'done' as const },
        { kind: 'tool' as const, key: 'b', toolId: 'w1', name: 'tool_call', status: 'done' as const }
      ],
      running: false
    }
    const next = attachBoards(state, toolAnswers(page), toolArgs(page), toolNames(page))
    expect(next.items[0]).toMatchObject({ board: { cards } })
    expect(next.items[1]).toMatchObject({ name: 'conduit_show', board: { cards } })
    // A resume row that carries its answer reads the cards the same way.
    const resumed = fromHistory([{ role: 'tool', name: 'conduit_show', tool_call_id: 's1', args: JSON.stringify({ cards }), content: '{"ok":true}' }])
    expect(resumed[0]).toMatchObject({ board: { cards } })
  })

  it('counts a finished wrapper-named row without a board as missing, answer or not', async () => {
    const { missingBoards, missingDetails } = await import('../src/renderer/src/state/transcript')
    const row = { kind: 'tool' as const, key: 'a', toolId: 'w1', name: 'tool_call', status: 'done' as const, result: 'An answer.' }
    expect(missingBoards({ items: [row], running: false })).toEqual(['w1'])
    expect(missingDetails({ items: [row], running: false })).toBe(true)
    // A running one has no answer to read yet, and a concrete tool with its answer needs nothing.
    expect(missingBoards({ items: [{ ...row, status: 'running' as const }], running: true })).toEqual([])
    expect(missingDetails({ items: [{ ...row, name: 'terminal' }], running: false })).toBe(false)

    // A full read that could not settle this row is remembered: reopening does not read it again.
    const { missingToolIds } = await import('../src/renderer/src/state/transcript')
    expect(missingToolIds({ items: [row], running: false }, new Set(['w1']))).toEqual([])
    expect(missingDetails({ items: [row], running: false }, new Set(['w1']))).toBe(false)
    expect(missingDetails({ items: [row], running: false }, new Set(['other']))).toBe(true)
  })

  it('verifies an envelope against the page name whatever the case', async () => {
    const { attachBoards, toolArgs, toolNames } = await import('../src/renderer/src/state/transcript')
    const page = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'w1', function: { name: 'tool_call', arguments: '{"name":"Conduit_Show","arguments":{"path":"/x"}}' } }] },
        { role: 'tool', tool_call_id: 'w1', tool_name: 'conduit_show', content: '' }
      ]
    }
    const state = { items: [{ kind: 'tool' as const, key: 'a', toolId: 'w1', name: 'tool_call', status: 'done' as const }], running: false }
    const next = attachBoards(state, new Map(), toolArgs(page), toolNames(page))
    expect(next.items[0]).toMatchObject({ name: 'conduit_show', args: '{\n  "path": "/x"\n}' })
  })

  it('returns a wrapped row with its arguments untouched on a second pass', async () => {
    const { attachBoards, toolAnswers, toolArgs, toolNames } = await import('../src/renderer/src/state/transcript')
    const page = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'w1', function: { name: 'tool_call', arguments: '{"name":"terminal","arguments":{"command":"ls"}}' } }] },
        { role: 'tool', tool_call_id: 'w1', tool_name: 'terminal', content: 'a.txt' }
      ]
    }
    const state = { items: [{ kind: 'tool' as const, key: 'a', toolId: 'w1', name: 'tool_call', status: 'done' as const }], running: false }
    const next = attachBoards(state, toolAnswers(page), toolArgs(page), toolNames(page))
    expect(next.items[0]).toMatchObject({ name: 'terminal', args: '{\n  "command": "ls"\n}', result: 'a.txt' })
    expect(attachBoards(next, toolAnswers(page), toolArgs(page), toolNames(page))).toBe(next)
  })

  it('keeps a no-argument wrapped call in the reopen cache', async () => {
    const { attachBoards, fromHistory, toolAnswers, toolArgs, toolNames, withKeptDetails, missingDetails } = await import('../src/renderer/src/state/transcript')
    const envelope = '{"name":"conduit_show"}'
    const rows = [{ role: 'tool', name: 'tool_call', tool_call_id: 'w1', args: envelope, content: '' }]
    const page = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'w1', function: { name: 'tool_call', arguments: envelope } }] },
        { role: 'tool', tool_call_id: 'w1', tool_name: 'conduit_show', content: JSON.stringify({ cards }) }
      ]
    }
    const first = attachBoards({ items: fromHistory(rows), running: false }, toolAnswers(page), toolArgs(page), toolNames(page))
    expect(first.items[0]).toMatchObject({ noArgs: true, board: { cards } })
    // The next open fills the board from the kept copy, so nothing is left to read.
    const again = withKeptDetails({ items: fromHistory(rows), running: false }, first)
    expect(again.items[0]).toMatchObject({ name: 'conduit_show', board: { cards } })
    expect((again.items[0] as { args?: unknown }).args).toBeUndefined()
    expect(missingDetails(again)).toBe(false)
  })

  it('draws a divergent envelope the same on every open', async () => {
    const { attachBoards, fromHistory, toolAnswers, toolArgs, toolNames, withKeptDetails } = await import('../src/renderer/src/state/transcript')
    // The envelope names web_search; the page's answer verified conduit_show.
    const envelope = '{"name":"web_search","arguments":{"query":"x"}}'
    const rows = [{ role: 'tool', name: 'tool_call', tool_call_id: 'w1', args: envelope, content: '' }]
    const page = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'w1', function: { name: 'tool_call', arguments: envelope } }] },
        { role: 'tool', tool_call_id: 'w1', tool_name: 'conduit_show', content: JSON.stringify({ cards }) }
      ]
    }
    const first = attachBoards({ items: fromHistory(rows), running: false }, toolAnswers(page), toolArgs(page), toolNames(page))
    const again = withKeptDetails({ items: fromHistory(rows), running: false }, first)
    const shown = (state: { items: unknown[] }) => {
      const { name, args, result, board } = state.items[0] as { name: string; args?: string; result?: string; board?: unknown }
      return { name, args, result, board }
    }
    expect(shown(first).name).toBe('conduit_show')
    // The Input is the envelope as sent, never the other tool's arguments under this tool's name.
    expect(shown(first).args).toBe('{\n  "name": "web_search",\n  "arguments": {\n    "query": "x"\n  }\n}')
    expect(shown(again)).toEqual(shown(first))
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
