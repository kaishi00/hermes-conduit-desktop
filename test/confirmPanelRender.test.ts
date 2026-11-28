import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { parsePrompt } from '../src/renderer/src/state/presented'

beforeAll(() => {
  const store = new Map<string, string>()
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window ?? {}, { conduit: new Proxy({ platform: 'linux' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) }), addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  })
})

// Desktop#702 review (hermes-conduit issue 3424): another computer's ask comes from a chat
// (it carries a session_id) but has nothing to rework, so it never offers Edit.
describe('ConfirmPanel', () => {
  const draw = async (row: Record<string, unknown>) => {
    // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
    const panel = '../src/renderer/src/components/ConfirmPanel.tsx'
    const { ConfirmPanel } = (await import(/* @vite-ignore */ panel)) as { ConfirmPanel: unknown }
    const prompt = parsePrompt(row)!
    return renderToStaticMarkup(createElement(ConfirmPanel as never, { item: { profile: 'default', prompt }, more: 0, onAnswer: () => {}, onEdit: () => {} }))
  }

  it('offers Edit on one of Hermes’ own from a chat', async () => {
    const html = await draw({ id: 'c1', title: 'Send the email?', action_label: 'Send', session_id: 's1' })
    expect(html).toContain('>Edit<')
  })

  it('hides Edit on another computer’s ask from a chat', async () => {
    const html = await draw({ id: 'ask-1', title: 'Allow Nahida to control Asuka?', action_label: 'Allow', session_id: 's1', pc: { computer: 'c1', name: 'Asuka', bot: 'Nahida' } })
    expect(html).not.toContain('>Edit<')
    expect(html).toContain('Don’t Allow')
    expect(html).toContain('>Allow<')
  })
})
