import { describe, expect, it } from 'vitest'
import { isBusy } from './busy'

describe('isBusy', () => {
  it('is idle when the foreground process is the shell', () => {
    expect(isBusy('zsh', 'zsh')).toBe(false)
    expect(isBusy('bash', 'bash')).toBe(false)
  })

  it('strips login-shell dashes and paths before comparing', () => {
    expect(isBusy('-zsh', 'zsh')).toBe(false)
    expect(isBusy('/bin/zsh', 'zsh')).toBe(false)
  })

  it('is busy for any other foreground process', () => {
    expect(isBusy('node', 'zsh')).toBe(true)
    expect(isBusy('npm run dev', 'zsh')).toBe(true)
    expect(isBusy('vim', 'bash')).toBe(true)
  })

  it('treats missing/empty titles as idle', () => {
    expect(isBusy(undefined, 'zsh')).toBe(false)
    expect(isBusy('', 'zsh')).toBe(false)
    expect(isBusy('  ', 'zsh')).toBe(false)
  })
})
