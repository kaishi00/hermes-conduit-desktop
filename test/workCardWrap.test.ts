import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('wraps a long work title inside its card instead of drawing past it', () => {
  const css = readFileSync(new URL('../src/renderer/src/styles/app.css', import.meta.url), 'utf8')
  expect(css).toMatch(/\.work-card-title\s*\{[^}]*overflow-wrap:\s*anywhere/s)
})
