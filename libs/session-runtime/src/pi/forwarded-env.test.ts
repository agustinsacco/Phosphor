import { describe, expect, it } from 'vitest'
import { isForwardedEnvName } from './forwarded-env'

describe('isForwardedEnvName', () => {
  it('accepts provider and pi prefixes and the exact proxy names', () => {
    for (const name of [
      'ANTHROPIC_API_KEY',
      'AWS_PROFILE',
      'OPENAI_BASE_URL',
      'PI_CACHE_RETENTION',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'NO_PROXY',
    ]) {
      expect(isForwardedEnvName(name), name).toBe(true)
    }
  })

  it('matches names case-insensitively', () => {
    expect(isForwardedEnvName('https_proxy')).toBe(true)
    expect(isForwardedEnvName('anthropic_api_key')).toBe(true)
  })

  it('refuses everything else, including near misses', () => {
    for (const name of [
      'PATH',
      'HOME',
      'SSH_AUTH_SOCK',
      'NODE_OPTIONS',
      'ELECTRON_RUN_AS_NODE',
      'HTTP_PROXY_USER',
      'XHTTPS_PROXY',
      'PIP_INDEX_URL',
      'AWS',
    ]) {
      expect(isForwardedEnvName(name), name).toBe(false)
    }
  })
})
