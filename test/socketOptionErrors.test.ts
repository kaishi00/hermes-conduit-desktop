import { describe, expect, it } from 'vitest'
import { handleUncaught, isRefusedSocketOption } from '../src/main/socketOptionErrors'

const refused = () => Object.assign(new Error('setTypeOfService EINVAL'), { code: 'EINVAL', syscall: 'setTypeOfService', errno: -22 })

describe('a socket option the system refused (desktop#397)', () => {
  it('knows the error Node throws from its HTTP client', () => {
    expect(isRefusedSocketOption(refused())).toBe(true)
    // As the dialog showed it: the message alone.
    expect(isRefusedSocketOption(new Error('setTypeOfService EINVAL'))).toBe(true)
  })

  it('is not any other error', () => {
    expect(isRefusedSocketOption(new Error('connect ECONNREFUSED 127.0.0.1:9119'))).toBe(false)
    expect(isRefusedSocketOption(Object.assign(new Error('setTypeOfService EBADF'), { code: 'EBADF', syscall: 'setTypeOfService' }))).toBe(false)
    expect(isRefusedSocketOption(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
    expect(isRefusedSocketOption('setTypeOfService EINVAL')).toBe(false)
  })

  it('logs it and shows no dialog', () => {
    const logged: string[] = []
    const shown: string[] = []
    expect(handleUncaught(refused(), { log: m => logged.push(m), showError: (_t, body) => shown.push(body) })).toBe('ignored')
    expect(logged).toHaveLength(1)
    expect(shown).toEqual([])
  })

  it('shows any other uncaught exception as Electron does', () => {
    const shown: [string, string][] = []
    const error = new Error('boom')
    expect(handleUncaught(error, { log: () => undefined, showError: (title, body) => shown.push([title, body]) })).toBe('shown')
    expect(shown[0]![0]).toBe('A JavaScript error occurred in the main process')
    expect(shown[0]![1]).toContain('Uncaught Exception:')
    expect(shown[0]![1]).toContain('boom')
  })
})
