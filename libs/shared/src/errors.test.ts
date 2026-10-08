import { describe, expect, it } from 'vitest'
import { errorText } from './errors'

describe('errorText', () => {
  it('reads the message off a real Error', () => {
    expect(errorText(new Error('boom'))).toBe('boom')
  })

  it('passes a thrown string through', () => {
    expect(errorText('plain rejection')).toBe('plain rejection')
  })

  it('reads message off a non-Error object', () => {
    // What an IPC-serialized rejection actually looks like: the prototype is
    // lost in transit, so `instanceof Error` is false but `message` survives.
    expect(errorText({ message: 'from ipc' })).toBe('from ipc')
  })

  it('ignores a non-string message rather than returning an object', () => {
    expect(errorText({ message: { nested: true } })).toBe('[object Object]')
  })

  it('handles null and undefined without throwing', () => {
    expect(errorText(null)).toBe('null')
    expect(errorText(undefined)).toBe('undefined')
  })
})
