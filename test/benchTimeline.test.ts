import { describe, expect, it } from 'vitest'
import { commandAnswer, commandAt, plainOutput, sameSteps, stepPath, timelineSteps, toolFields } from '../src/renderer/src/state/benchTimeline'
import type { TranscriptItem } from '../src/renderer/src/state/transcript'

const items: TranscriptItem[] = [
  { kind: 'user', key: 'u1', text: 'Make the build pass\nthanks', at: 1 },
  { kind: 'thinking', key: 'th', text: 'hmm', streaming: false },
  { kind: 'tool', key: 't1', toolId: 'a', name: 'terminal', status: 'done', at: 2, args: '{\n  "command": "npm test"\n}', result: '{"output": "\\u001b[31m1 failed\\u001b[0m\\r\\n", "exit_code": 1, "error": null}' },
  { kind: 'tool', key: 't2', toolId: 'b', name: 'patch', status: 'done', at: 3, args: '{"path": "src/a.ts", "old_string": "x", "new_string": "y"}' },
  { kind: 'tool', key: 't3', toolId: 'c', name: 'todo', status: 'done', at: 4 },
  { kind: 'tool', key: 't3b', toolId: 'c2', name: 'todo_list', status: 'done', at: 4 },
  { kind: 'tool', key: 't3c', toolId: 'c3', name: 'conduit_show', status: 'done', at: 4 },
  { kind: 'tool', key: 't4', toolId: 'd', name: 'read_file', status: 'done', at: 5, args: '{"path": "/srv/app/README.md", "offset": 1, "content": "cut here…' },
  { kind: 'assistant', key: 'a1', text: 'Fixed.', at: 6, streaming: false },
  { kind: 'tool', key: 't5', toolId: 'e', name: 'browser_navigate', status: 'running', at: 7, context: 'http://localhost:5173' },
  { kind: 'tool', key: 't6', toolId: 'f', name: 'memory', status: 'done', at: 8 },
  { kind: 'user', key: 'u2', text: 'queued', at: 9, pending: true }
]

describe('the workbench timeline (desktop issue 453)', () => {
  it('lists what was asked and what the bot did, oldest first, leaving out cards, plans and queued words', () => {
    const steps = timelineSteps(items)
    expect(steps.map(s => [s.key, s.kind])).toEqual([
      ['u1', 'ask'],
      ['t1', 'command'],
      ['t2', 'edit'],
      ['t4', 'read'],
      ['t5', 'page'],
      ['t6', 'step']
    ])
    expect(steps[0]!.detail).toBe('Make the build pass')
    expect(steps[1]).toMatchObject({ detail: 'npm test', output: '1 failed\n', exitCode: 1 })
    expect(steps[2]).toMatchObject({ path: 'src/a.ts', detail: 'src/a.ts' })
    expect(steps[3]).toMatchObject({ path: '/srv/app/README.md' })
    expect(steps[4]).toMatchObject({ detail: 'http://localhost:5173', running: true })
  })

  it('reads the fields before a cut, and a plain answer as it is', () => {
    expect(toolFields('{"command": "ls -la", "timeout": 5')).toEqual({ command: 'ls -la' })
    expect(toolFields(undefined)).toEqual({})
    expect(commandAnswer('plain text\r\nmore')).toEqual({ output: 'plain text\nmore' })
    expect(commandAnswer('{"output": "", "exit_code": 0}')).toEqual({ output: undefined, exitCode: 0 })
    expect(plainOutput('\u001b]0;title\u0007ok')).toBe('ok')
  })

  it('lands the bot’s terminal on the step’s command or the last one before it', () => {
    const steps = timelineSteps(items)
    expect(commandAt(steps, 't4')).toBe('t1')
    expect(commandAt(steps, 'u1')).toBeNull()
    expect(commandAt(steps, null)).toBeNull()
  })

  it('keeps the same steps while a reply streams, and sees a step change', () => {
    const a = timelineSteps(items)
    const streamed = [...items, { kind: 'assistant' as const, key: 'a2', text: 'More words', at: 10, streaming: true }]
    expect(sameSteps(a, timelineSteps(streamed))).toBe(true)
    const done = items.map(item => (item.key === 't5' && item.kind === 'tool' ? { ...item, status: 'done' as const } : item))
    expect(sameSteps(a, timelineSteps(done))).toBe(false)
    const coded = items.map(item => (item.key === 't1' && item.kind === 'tool' ? { ...item, result: '{"output": "\\u001b[31m1 failed\\u001b[0m\\r\\n", "exit_code": 2}' } : item))
    expect(sameSteps(a, timelineSteps(coded))).toBe(false)
  })

  it('puts a file named from the bot’s folder in the chat’s folder', () => {
    expect(stepPath('src/a.ts', '/srv/app/')).toBe('/srv/app/src/a.ts')
    expect(stepPath('./b.ts', '/srv/app')).toBe('/srv/app/b.ts')
    expect(stepPath('/etc/hosts', '/srv/app')).toBe('/etc/hosts')
    expect(stepPath('C:\\x\\y.txt', 'C:\\x')).toBe('C:\\x\\y.txt')
    expect(stepPath('src\\a.ts', 'C:\\Users\\x')).toBe('C:\\Users\\x\\src\\a.ts')
    expect(stepPath('src\\a.ts', '/srv/app')).toBe('/srv/app/src/a.ts')
  })
})
