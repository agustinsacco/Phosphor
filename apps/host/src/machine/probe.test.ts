import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { PROBE_OUTPUT_CAP, probe, probeFailure, stopProbes } from './probe'

const dir = mkdtempSync(join(realpathSync(tmpdir()), 'host-probe-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const KEY = 'sk-ant-probe-0123456789abcdef'
const PEM = 'first-line-of-a-key\nsecond-line-of-a-key'
const EURO = 'pay-€-0123456789'
/** No secrets: most tests here are about the process, not redaction. */
const plain = { env: { PATH: '/usr/bin:/bin' }, secrets: [] }

/** A CommonJS script run by this test's own node. */
function script(name: string, body: string): [string, string[]] {
  const file = join(dir, `${name}.cjs`)
  writeFileSync(file, body)
  return [process.execPath, [file]]
}

async function gone(pid: number, withinMs = 3_000): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < withinMs;) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

describe('probe', () => {
  it('returns exit code, stdout and stderr', async () => {
    const [node, args] = script('ok', `console.log('out'); console.error('err'); process.exit(3)`)
    expect(await probe(node, args, plain)).toEqual({
      code: 3,
      signal: null,
      stdout: 'out\n',
      stderr: 'err\n',
      timedOut: false,
      truncated: false,
    })
  })

  it('never gives the program an open stdin pipe', async () => {
    // A program that reads stdin to EOF, as `pi -p` does, must finish at once.
    const [node, args] = script(
      'stdin',
      `process.stdin.on('data', () => {}); process.stdin.on('end', () => console.log('eof'))`,
    )
    const result = await probe(node, args, { ...plain, timeoutMs: 5_000 })
    expect(result).toMatchObject({ code: 0, stdout: 'eof\n', timedOut: false })
  })

  it('gives the program exactly the environment it is handed', async () => {
    vi.stubEnv('PHOSPHOR_PROBE_SENTINEL', 'inherited')
    try {
      const [node, args] = script('env', `console.log(JSON.stringify(process.env))`)
      const seen = JSON.parse(
        (await probe(node, args, { ...plain, env: { ...plain.env, ONLY: '1' } })).stdout,
      )
      expect(seen).toMatchObject({ ONLY: '1', PATH: '/usr/bin:/bin' })
      expect(seen).not.toHaveProperty('PHOSPHOR_PROBE_SENTINEL')
      expect(seen).not.toHaveProperty('HOME')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('kills the whole process group on timeout, grandchildren included', async () => {
    const [node, args] = script(
      'hang',
      `const { spawn } = require('node:child_process')
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
console.log(child.pid)
setInterval(() => {}, 1000)`,
    )
    const started = Date.now()
    const result = await probe(node, args, { ...plain, timeoutMs: 1_500 })
    expect(result).toMatchObject({ code: null, signal: 'SIGKILL', timedOut: true })
    expect(Date.now() - started).toBeLessThan(4_000)
    const grandchild = Number(result.stdout.trim())
    expect(grandchild).toBeGreaterThan(1)
    expect(await gone(grandchild)).toBe(true)
    expect(probeFailure(result)).toBe(': timed out')
  })

  it('keeps at most the output cap and still lets the program finish', async () => {
    const [node, args] = script('loud', `process.stdout.write('x'.repeat(${PROBE_OUTPUT_CAP * 3}))`)
    const result = await probe(node, args, plain)
    expect(result).toMatchObject({ code: 0, truncated: true, timedOut: false })
    expect(result.stdout.length).toBe(PROBE_OUTPUT_CAP)
  })

  it('reports a program that cannot start', async () => {
    const result = await probe(join(dir, 'missing'), [], plain)
    expect(result.code).toBeNull()
    expect(result.error).toContain('ENOENT')
    expect(probeFailure(result)).toContain('ENOENT')
  })

  it('stops every running probe for a signal handler', async () => {
    const [node, args] = script('wait', `setInterval(() => {}, 1000)`)
    const running = probe(node, args, { ...plain, timeoutMs: 30_000 })
    await new Promise((resolve) => setTimeout(resolve, 200))
    stopProbes()
    expect(await running).toMatchObject({ signal: 'SIGKILL', timedOut: false })
  })

  it('hides a secret before any line is picked or shortened', async () => {
    const environment = { env: { ...plain.env, KEY, PEM }, secrets: [KEY, PEM] }
    // 182 characters, then the secret: a cut at 200 would keep its first 18.
    const [late, lateArgs] = script(
      'late',
      `console.error('x'.repeat(182) + process.env.KEY); process.exit(1)`,
    )
    expect(probeFailure(await probe(late, lateArgs, environment))).toBe(
      ` (exit 1): ${'x'.repeat(182)}[redacted]`,
    )
    // A first line that is only part of a secret is still part of it.
    const [pem, pemArgs] = script('pem', `console.error(process.env.PEM); process.exit(1)`)
    expect(probeFailure(await probe(pem, pemArgs, environment))).toBe(' (exit 1): [redacted]')
  })

  it('hides a secret the output cap cuts through, even inside a character', async () => {
    const environment = { env: { ...plain.env, KEY, EURO }, secrets: [KEY, EURO] }
    // The cap falls 10 characters into the secret.
    const [node, args] = script(
      'cap',
      `process.stdout.write('y'.repeat(${PROBE_OUTPUT_CAP - 10}) + process.env.KEY + 'tail')`,
    )
    const cut = await probe(node, args, environment)
    expect(cut.truncated).toBe(true)
    expect(cut.stdout).toBe(`${'y'.repeat(PROBE_OUTPUT_CAP - 10)}[redacted]`)
    // Here it falls inside the euro sign, after 'pay-' and one of the sign's three bytes.
    const [euro, euroArgs] = script(
      'euro',
      `process.stdout.write('y'.repeat(${PROBE_OUTPUT_CAP - 5}) + process.env.EURO)`,
    )
    expect((await probe(euro, euroArgs, environment)).stdout).toBe(
      `${'y'.repeat(PROBE_OUTPUT_CAP - 5)}[redacted]`,
    )
  })

  it('describes a failure by exit and first output line', () => {
    const failed = {
      code: 2,
      signal: null,
      stdout: '',
      stderr: 'bad flag\nmore',
      timedOut: false,
      truncated: false,
    }
    expect(probeFailure(failed)).toBe(' (exit 2): bad flag')
    expect(probeFailure({ ...failed, stderr: '' })).toBe(' (exit 2)')
  })
})
