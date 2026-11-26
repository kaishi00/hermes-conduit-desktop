// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => {
  document.body.innerHTML = ''
})

async function mount(needs: number) {
  const path = '../src/renderer/src/components/WorkRing.tsx'
  const { WorkRing } = (await import(/* @vite-ignore */ path)) as { WorkRing: unknown }
  const host = document.createElement('div')
  document.body.append(host)
  act(() => createRoot(host).render(createElement(WorkRing as never, { needs } as never)))
  return host.querySelector('.work-ring')!
}

describe('a bot at work, on its face', () => {
  it('circles a working bot, and rings one that needs you with the count', async () => {
    const working = await mount(0)
    expect(working.className).toBe('work-ring working')
    expect(working.querySelector('.work-ring-count')).toBeNull()
    expect(working.getAttribute('aria-hidden')).toBe('true')
    const needs = await mount(3)
    expect(needs.className).toBe('work-ring needs')
    expect(needs.querySelector('.work-ring-count')?.textContent).toBe('3')
  })

  it('shows what a working bot is doing now, else Working (never its last message), shimmering, and the words for needs you (BotsHome.tsx)', () => {
    const src = readFileSync(join(__dirname, '../src/renderer/src/components/BotsHome.tsx'), 'utf8')
    expect(src).toMatch(/\(tile\.own && liveDoing\?\.bot === bot\.name \? liveDoing\.text : null\) \|\| \(tile\.own \? otherChatsDoing\?\.get\(bot\.name\) : null\) \|\| botWork\?\.doing \|\| null;/)
    expect(src).toMatch(/<span className="meta bot-side-working">\{doingNow \|\| t\("Working"\)\}<\/span>/)
    const app = readFileSync(join(__dirname, '../src/renderer/src/App.tsx'), 'utf8')
    expect(app).toMatch(/useTranscriptValue\(transcriptStore, state => \(state\.running \? liveDoing\(state\.items\) : null\)\)/)
    expect(app).toMatch(/liveDoing: liveDoingNow \? \{ bot: selected\.profile \?\? 'default', text: liveDoingNow \} : null,/)
    expect(app).toMatch(/otherChatsDoing: answering,/)
    expect(src).toMatch(/\{needs \? \(\s*<span className="meta bot-side-pill needs">/)
    expect(src).toMatch(/\{needs \|\| busy \? <WorkRing needs=\{needs\} \/> : null\}/)
  })

  it('spins and sweeps only with motion allowed, and pulses a needs-you ring once (app.css)', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/styles/app.css'), 'utf8')
    expect(css).toMatch(/\.work-ring\.needs::after \{[^}]*animation: work-ring-ping 1\.1s ease-out 1;/)
    // A far bot's dashboard badge and the count never share a corner: bottom-right badge and top count in
    // the Bots list, top-right badge and bottom count on the rail.
    expect(css).toMatch(/\.bot-side-face \.bot-tile-badge \{[^}]*bottom: -4px;/)
    expect(css).toMatch(/\.bot-side-face \.work-ring-count \{[^}]*top: -5px;\s*bottom: auto;/)
    expect(css).toMatch(/\.rail-face-badge \{[^}]*top: 1px;/)
    expect(css).toMatch(/\.work-ring-count \{[^}]*bottom: -5px;/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.work-ring\.working,\s*\.work-ring\.needs::after,\s*\.bot-side-working \{\s*animation: none;/)
  })
})

describe('what a bot is doing now', () => {
  it("is its newest running workstream's step, and nothing when none runs", async () => {
    const { botDoing } = await import('../src/renderer/src/state/work')
    const item = (ref: string, status: string, updatedAt: number, checklist: { text: string; state: string }[], step = '') =>
      ({ ref, status, updatedAt, checklist, step, agents: 0 }) as never
    expect(botDoing({ items: [] })).toBeNull()
    expect(
      botDoing({
        items: [
          item('W1', 'running', 1, [{ text: 'Add tests', state: 'doing' }]),
          item('W2', 'running', 5, [{ text: 'Run the full suite', state: 'doing' }]),
          item('W3', 'done', 9, [{ text: 'Old', state: 'doing' }])
        ]
      })
    ).toBe('Run the full suite')
    // No checklist step in progress: the tool step it's on.
    expect(botDoing({ items: [item('W4', 'running', 1, [], 'Running a command')] })).toBe('Running a command')
  })
})

describe('what the open reply is doing now', () => {
  it('names the running step, Thinking… while it reasons, and nothing for the words or before it starts', async () => {
    const { liveDoing } = await import('../src/renderer/src/state/liveDoing')
    const user = { kind: 'user', key: 'u', text: 'Run the tests' } as const
    const tool = (name: string, status: 'running' | 'done') => ({ kind: 'tool', key: `t-${name}`, toolId: name, name, status }) as const
    expect(liveDoing([user, tool('terminal', 'running')])).toBe('Running a command')
    expect(liveDoing([user, tool('read_file', 'done'), tool('patch', 'running')])).toBe('Editing a file')
    expect(liveDoing([user, tool('terminal', 'done'), { kind: 'thinking', key: 'r', text: '…', streaming: true }])).toBe('Thinking…')
    expect(liveDoing([user, { kind: 'assistant', key: 'a', text: 'Done', streaming: true }])).toBeNull()
    // An earlier turn's step that never closed isn't this one's.
    expect(liveDoing([tool('terminal', 'running'), user])).toBeNull()
  })
})
