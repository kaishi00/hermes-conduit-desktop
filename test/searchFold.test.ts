import { describe, expect, it } from 'vitest'
import { searchFold } from '../src/renderer/src/state/searchFold'

describe('searchFold (desktop#399)', () => {
  it('finds an accented word from a plain one, and a plain word from an accented one', () => {
    expect(searchFold('Reunião com André').includes(searchFold('andre'))).toBe(true)
    expect(searchFold('Notes for Andre').includes(searchFold('André'))).toBe(true)
    expect(searchFold('Configuração').includes(searchFold('configuracao'))).toBe(true)
  })

  it('folds a precomposed and a combining accent alike', () => {
    expect(searchFold('café')).toBe(searchFold('café'))
  })

  it('leaves letters that are not accents alone', () => {
    expect(searchFold('Straße 日本語 Ørsted')).toBe('straße 日本語 ørsted')
    expect(searchFold('naive').includes(searchFold('nave'))).toBe(false)
  })
})
