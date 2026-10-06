import { describe, expect, it } from 'vitest'
import { parseAuthNotice, parseOAuthPrompt, parseReconnectNotice } from './connectors'

/**
 * The exact strings the adapter emits (`pi-mcp-adapter/commands.ts`). The
 * hyperlink is an OSC 8 escape, which is what a terminal-shaped prompt looks
 * like once it reaches a GUI.
 */
const OSC8 =
  '\u001b]8;;https://linear.app/oauth/authorize?x=1\u0007Open authorization page\u001b]8;;\u0007'
const REAL_PROMPT =
  `Complete linear OAuth\n\n${OSC8}\n` +
  'https://linear.app/oauth/authorize?client_id=abc&state=xyz\n\n' +
  'Approve access, then paste the full localhost callback URL below.'

describe('parseOAuthPrompt', () => {
  it('reads the server name and the bare authorization URL', () => {
    expect(parseOAuthPrompt(REAL_PROMPT)).toEqual({
      serverName: 'linear',
      authorizationUrl: 'https://linear.app/oauth/authorize?client_id=abc&state=xyz',
    })
  })

  it('handles a server name with spaces and dashes', () => {
    expect(
      parseOAuthPrompt('Complete my-linear server OAuth\n\nhttps://x.test/a')?.serverName,
    ).toBe('my-linear server')
  })

  it('ignores every other input prompt, which must keep its normal dialog', () => {
    expect(parseOAuthPrompt('Enter a commit message')).toBeNull()
    // Shaped like the header but with no URL to open: falling through to the
    // generic dialog is strictly better than a card with nothing to click.
    expect(parseOAuthPrompt('Complete linear OAuth')).toBeNull()
    expect(parseOAuthPrompt('Complete linear OAuth\n\nftp://x.test/a')).toBeNull()
    expect(parseOAuthPrompt('')).toBeNull()
  })
})

describe('parseAuthNotice', () => {
  it('reads the adapter verdicts', () => {
    expect(parseAuthNotice('OAuth authentication successful for "notion".')).toEqual({
      serverName: 'notion',
      outcome: 'success',
    })
    expect(parseAuthNotice('OAuth authentication failed for "notion".')).toEqual({
      serverName: 'notion',
      outcome: 'failure',
    })
    expect(parseAuthNotice('Failed to authenticate "slack": redirect_uri mismatch')).toEqual({
      serverName: 'slack',
      outcome: 'failure',
      detail: 'redirect_uri mismatch',
    })
  })

  it('does not claim unrelated notifications', () => {
    expect(parseAuthNotice('MCP: linear - 3 tools skipped')).toBeNull()
    expect(parseAuthNotice('Authenticating linear...')).toBeNull()
  })
})

describe('parseReconnectNotice', () => {
  it('reads a successful reconnect, with its tool count', () => {
    expect(parseReconnectNotice('MCP: Reconnected to linear (67 tools, 0 resources)')).toEqual({
      serverName: 'linear',
      outcome: 'connected',
      toolCount: 67,
      resourceCount: 0,
    })
  })

  it('reads the singular forms', () => {
    expect(parseReconnectNotice('MCP: Reconnected to tiny (1 tool, 1 resource)')?.outcome).toBe(
      'connected',
    )
  })

  it('separates a missing credential from a broken server', () => {
    expect(parseReconnectNotice('MCP: notion requires OAuth. Run /mcp-auth notion first.')).toEqual(
      { serverName: 'notion', outcome: 'needs-auth', detail: 'Sign-in required.' },
    )
    expect(
      parseReconnectNotice('MCP: Failed to reconnect to fellow: fetch failed (ENOTFOUND)'),
    ).toEqual({
      serverName: 'fellow',
      outcome: 'failed',
      detail: 'fetch failed (ENOTFOUND)',
    })
  })

  it('reads disabled and not-in-config', () => {
    expect(
      parseReconnectNotice('MCP: braintrust is disabled. Run /mcp enable braintrust, then /reload.')
        ?.outcome,
    ).toBe('disabled')
    expect(parseReconnectNotice('Server "ghost" not found in config')?.outcome).toBe('missing')
  })

  it('fails closed on anything else', () => {
    expect(parseReconnectNotice('MCP: linear - 3 tools skipped')).toBeNull()
    expect(parseReconnectNotice('OAuth authentication successful for "linear".')).toBeNull()
    expect(parseReconnectNotice('')).toBeNull()
  })
})
