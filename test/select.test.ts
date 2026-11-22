import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
// A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
const path = '../src/renderer/src/components/Select'

const option = (value: string | number, label: string, disabled = false) => createElement('option', { key: `${value}`, value, disabled }, label)

describe('the app dropdown', () => {
  it('reads <option> rows through fragments, arrays and conditionals, as a <select> does', async () => {
    const { selectOptions } = await import(path)
    const rows = selectOptions([option('a', 'Alpha'), null, false, createElement(Fragment, { key: 'f' }, [option(2, 'Two', true)]), createElement('option', { key: 'n' }, 'No value')])
    expect(rows.map((r: { value: string; disabled: boolean }) => [r.value, r.disabled])).toEqual([
      ['a', false],
      ['2', true],
      ['No value', false]
    ])
  })

  it('heads grouped rows with their group, and the field can show its own words for the pick', async () => {
    const { selectOptions, SelectGroup, Select } = await import(path)
    const groups = [
      createElement(SelectGroup, { key: 'h', id: 'home', label: 'Home' }, [option('h1', 'SeaBag'), option('h2', 'Default')]),
      createElement(SelectGroup, { key: 's', id: 'studio', label: 'Studio' }, [option('s1', 'Releases')])
    ]
    const rows = selectOptions([option('none', 'Loose'), ...groups])
    expect(rows.map((r: { value: string; group?: { key: string } }) => [r.value, r.group?.key])).toEqual([
      ['none', undefined],
      ['h1', 'home'],
      ['h2', 'home'],
      ['s1', 'studio']
    ])
    const html = renderToStaticMarkup(createElement(Select, { value: 's1', onChange: () => {}, shownLabel: 'S · Releases' }, groups))
    expect(html).toContain('S · Releases')
  })

  it('shows the matching row, else blank, and steps over disabled rows', async () => {
    const { selectOptions, shownOption, stepOption } = await import(path)
    const rows = selectOptions([option('a', 'A'), option('b', 'B', true), option('c', 'C')])
    expect(shownOption(rows, 'c').label).toBe('C')
    expect(shownOption(rows, 'gone')).toBeUndefined()
    expect(stepOption(rows, 0, 1)).toBe(2)
    expect(stepOption(rows, 2, 1)).toBe(2)
    expect(stepOption(rows, 2, -1)).toBe(0)
  })

  it('draws a field with the picked label and no native <select>', async () => {
    const { Select } = await import(path)
    const html = renderToStaticMarkup(createElement(Select, { value: 'b', onChange: () => {}, 'aria-label': 'Pick', className: 'language-select' }, [option('a', 'Alpha'), option('b', 'Beta')]))
    expect(html).not.toContain('<select')
    expect(html).toContain('class="conduit-select language-select"')
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toContain('Beta')
    expect(html).not.toContain('Alpha')
  })

  it("keeps an option's language, so a native name draws in its own script", async () => {
    const { Select } = await import(path)
    const html = renderToStaticMarkup(createElement(Select, { value: 'ja', onChange: () => {} }, [createElement('option', { key: 'ja', value: 'ja', lang: 'ja' }, '日本語')]))
    expect(html).toContain('lang="ja"')
  })

  it('draws two or three fixed choices as segmented buttons when asked', async () => {
    const { Select } = await import(path)
    const html = renderToStaticMarkup(createElement(Select, { value: 'b', onChange: () => {}, segments: true, 'aria-label': 'Pick' }, [option('a', 'Alpha'), option('b', 'Beta')]))
    expect(html).toContain('role="radiogroup"')
    expect(html.match(/role="radio"/g)).toHaveLength(2)
    expect(html).toContain('aria-checked="true"')
    expect(html).not.toContain('aria-pressed')
  })
})
