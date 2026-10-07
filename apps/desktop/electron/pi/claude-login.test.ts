import { describe, expect, it } from 'vitest'
import { hasInvalidCodeNotice, parseClaudeLoginUrl } from './claude-login'

/**
 * Verbatim captures from Claude Code 2.1.231's `claude auth login` with piped
 * stdio. This file is a parser for someone else's output, so the shapes are the
 * contract — a reworded line here is the failure this suite is meant to name.
 */
const FIRST_PROMPT = [
  'Opening browser to sign in…',
  'If the browser didn\u2019t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Aprofile+user%3Ainference&code_challenge=cD0DWCFz&code_challenge_method=S256&state=3RvrIyL',
  'Paste code here if prompted > ',
].join('\n')

/** What a rejected code produces: a notice, then a whole new handshake. */
const AFTER_INVALID_CODE = [
  FIRST_PROMPT,
  'Invalid code. Please make sure the full code was copied.',
  'Opening browser to sign in…',
  'If the browser didn\u2019t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&code_challenge=n2GLpGFG&state=akna_RvW',
  'Paste code here if prompted > ',
].join('\n')

describe('parseClaudeLoginUrl', () => {
  it('reads the authorization URL off the CLI’s fallback line', () => {
    const url = parseClaudeLoginUrl(FIRST_PROMPT)
    expect(url).toContain('https://claude.com/cai/oauth/authorize')
    // The query string carries the PKCE challenge; a truncated URL opens a
    // page the user cannot complete.
    expect(url).toContain('code_challenge=cD0DWCFz')
    expect(url).toContain('state=3RvrIyL')
  })

  it('prefers the newest URL after a rejected code', () => {
    // The regression this guards: the first URL's PKCE challenge is dead once
    // the CLI restarts, so a code pasted from it can never succeed.
    expect(parseClaudeLoginUrl(AFTER_INVALID_CODE)).toContain('code_challenge=n2GLpGFG')
  })

  it('falls back to a bare oauth URL if the prose changes', () => {
    expect(parseClaudeLoginUrl('go to https://claude.com/cai/oauth/authorize?x=1 now')).toBe(
      'https://claude.com/cai/oauth/authorize?x=1',
    )
  })

  it('strips trailing sentence punctuation', () => {
    expect(parseClaudeLoginUrl('visit: https://claude.com/cai/oauth/authorize.')).toBe(
      'https://claude.com/cai/oauth/authorize',
    )
  })

  it('returns undefined before any URL has been printed', () => {
    expect(parseClaudeLoginUrl('Opening browser to sign in…')).toBeUndefined()
  })
})

describe('hasInvalidCodeNotice', () => {
  it('detects the CLI’s rejection', () => {
    expect(hasInvalidCodeNotice(AFTER_INVALID_CODE)).toBe(true)
  })

  it('does not fire on a clean prompt', () => {
    expect(hasInvalidCodeNotice(FIRST_PROMPT)).toBe(false)
  })
})
