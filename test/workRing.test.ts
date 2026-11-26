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

  it('shows what a working bot is doing now, else its last line, shimmering, and the words for needs you (BotsHome.tsx)', () => {
    const src = readFileSync(join(__dirname, '../src/renderer/src/components/BotsHome.tsx'), 'utf8')
    expect(src).toMatch(/<span className="meta bot-side-working">\{botWork\?\.doing \|\| bot\.lastLine \|\| t\("Working"\)\}<\/span>/)
    expect(src).toMatch(/\{needs \? \(\s*<span className="meta bot-side-pill needs">/)
    expect(src).toMatch(/\{needs \|\| busy \? <WorkRing needs=\{needs\} \/> : null\}/)
  })

  it('spins and sweeps only with motion allowed, and pulses a needs-you ring once (app.css)', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/styles/app.css'), 'utf8')
    expect(css).toMatch(/\.work-ring\.needs::after \{[^}]*animation: work-ring-ping 1\.1s ease-out 1;/)
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
