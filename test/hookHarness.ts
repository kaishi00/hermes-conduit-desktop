/**
 * Runs a hook in a real React root, for a test file that runs under
 * `// @vitest-environment happy-dom`. `result()` is the hook's latest
 * answer, `renders()` how many times it ran, `rerender` gives it new props.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export function renderHook<P, R>(hook: (props: P) => R, props: NoInfer<P>) {
  let latest: R
  let count = 0
  const root = createRoot(document.createElement('div'))
  const Probe = ({ p }: { p: P }) => {
    count++
    latest = hook(p)
    return null
  }
  act(() => root.render(createElement(Probe, { p: props })))
  return {
    result: () => latest,
    renders: () => count,
    rerender: (next: NoInfer<P>) => act(() => root.render(createElement(Probe, { p: next }))),
    unmount: () => act(() => root.unmount())
  }
}

/** Lets pending promises and React's updates settle. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}
