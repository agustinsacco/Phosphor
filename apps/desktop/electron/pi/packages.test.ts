import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_CLI_PACKAGE,
  checkClaudeCliUpdate,
  checkPackageUpdates,
  parseClaudeAuthStatus,
  runClaudeUpdate,
} from './packages'
import type { JobSender } from './packages'

describe('parseClaudeAuthStatus', () => {
  it('parses the Claude Code 2.x logged-in JSON shape', () => {
    // Captured from claude 2.1.219 `claude auth status`.
    const stdout = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      apiKeySource: '/login managed key',
      email: 'user@example.com',
    })
    expect(parseClaudeAuthStatus(stdout)).toEqual({
      ok: true,
      loggedIn: true,
      method: 'claude.ai',
      email: 'user@example.com',
    })
  })

  it('parses logged-out state and tolerates leading noise', () => {
    const stdout = 'some banner\n{"loggedIn": false}'
    expect(parseClaudeAuthStatus(stdout)).toEqual({
      ok: true,
      loggedIn: false,
      method: undefined,
      email: undefined,
    })
  })

  it('reports non-JSON output as an error, not a crash', () => {
    expect(parseClaudeAuthStatus('command not found').ok).toBe(false)
    expect(parseClaudeAuthStatus('{broken').ok).toBe(false)
    expect(parseClaudeAuthStatus('').ok).toBe(false)
  })
})

describe('checkClaudeCliUpdate', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('asks the registry for the Claude Code package, scope-escaped', async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url))
      return new Response(JSON.stringify({ version: '2.1.258' }), { status: 200 })
    }) as typeof fetch

    expect(await checkClaudeCliUpdate()).toBe('2.1.258')
    expect(seen).toEqual(['https://registry.npmjs.org/@anthropic-ai%2fclaude-code/latest'])
    expect(CLAUDE_CLI_PACKAGE).toBe('@anthropic-ai/claude-code')
  })

  it('answers null rather than throwing when the registry is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline')
    }) as typeof fetch
    expect(await checkClaudeCliUpdate()).toBeNull()
  })

  it('answers null on a non-OK response or a version-less body', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as typeof fetch
    expect(await checkClaudeCliUpdate()).toBeNull()
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch
    expect(await checkClaudeCliUpdate()).toBeNull()
  })
})

describe('checkPackageUpdates', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('resolves npm entries and skips git and path ones', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 }),
    ) as typeof fetch

    const entries = [
      { spec: 'npm:@saccolabs/pi-claude-cli', kind: 'npm' },
      { spec: 'git:github.com/user/repo', kind: 'git' },
    ] as Parameters<typeof checkPackageUpdates>[0]

    expect(await checkPackageUpdates(entries)).toEqual({
      'npm:@saccolabs/pi-claude-cli': '9.9.9',
    })
  })
})

describe('runClaudeUpdate', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'phosphor-claude-update-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** Collect one job's streamed output and exit code. */
  function collect(): { sender: JobSender; done: Promise<{ output: string; code: number }> } {
    let output = ''
    let settle: (value: { output: string; code: number }) => void
    const done = new Promise<{ output: string; code: number }>((resolve) => {
      settle = resolve
    })
    const sender: JobSender = {
      isDestroyed: () => false,
      send: (channel, ...args) => {
        if (channel.startsWith('packages:output:')) output += String(args[0])
        if (channel.startsWith('packages:exit:')) settle({ output, code: Number(args[0]) })
      },
    }
    return { sender, done }
  }

  it("runs the CLI's own `update` subcommand and streams its output", async () => {
    const fake = join(dir, 'claude')
    writeFileSync(fake, '#!/bin/sh\necho "got:$*"\n', { mode: 0o755 })

    const { sender, done } = collect()
    await runClaudeUpdate(sender, fake)

    // `update`, not `npm install -g`: npm does not own a native install.
    expect(await done).toEqual({ output: 'got:update\n', code: 0 })
  })

  it('surfaces a missing binary on the job channels instead of throwing', async () => {
    const { sender, done } = collect()
    // An empty override is falsy, so this takes the PATH-resolution branch;
    // point it at a path that cannot spawn to prove failures still report.
    await runClaudeUpdate(sender, join(dir, 'does-not-exist'))

    const result = await done
    expect(result.code).not.toBe(0)
    expect(result.output.length).toBeGreaterThan(0)
  })
})
