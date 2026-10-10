import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHostLog, hostLogDirectory, redactionPieces } from './log'

// A value with a quote and a newline: JSON would write both escaped.
const SECRET = 'sk-ant-"quoted"-0123\nsecond-line-4567'
const LINES = SECRET.split('\n')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(realpathSync(tmpdir()), 'phosphor-host-log-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('the Host log', () => {
  it('lives in the XDG state folder, ignoring a relative one', () => {
    expect(hostLogDirectory({ XDG_STATE_HOME: '/state' }, '/home/me')).toBe(
      '/state/phosphor-host/logs',
    )
    for (const env of [{}, { XDG_STATE_HOME: '' }, { XDG_STATE_HOME: 'state' }]) {
      expect(hostLogDirectory(env, '/home/me')).toBe('/home/me/.local/state/phosphor-host/logs')
    }
  })

  it('is owner-only', () => {
    const log = createHostLog(join(dir, 'logs'), [])
    log.write('host', 'ready')
    expect(statSync(join(dir, 'logs')).mode & 0o777).toBe(0o700)
    expect(statSync(log.path()!).mode & 0o777).toBe(0o600)
  })

  it('never holds a secret, raw, escaped or one line of it, wherever it appears', () => {
    const log = createHostLog(join(dir, 'logs'), [SECRET])
    log.write('pi', `spawn failed with ${SECRET}`)
    log.write('pi', 'stderr', { sessionId: 'a', text: `key=${SECRET}` })
    // How pi's stderr reaches the log: one line at a time.
    for (const line of LINES) log.write('pi', 'stderr', { sessionId: 'a', text: `> ${line} <` })
    log.write('pi', 'spawn', {
      args: ['-n', SECRET],
      nested: [{ deep: SECRET }],
      when: new Date(0),
    })
    const text = readFileSync(log.path()!, 'utf8')
    for (const form of [SECRET, JSON.stringify(SECRET).slice(1, -1), ...LINES, 'quoted']) {
      expect(text).not.toContain(form)
    }
    expect(text).toContain('> [redacted] <')
    expect(text).toContain('"when":"1970-01-01T00:00:00.000Z"')
    expect(log.hide(`a ${LINES[1]} b`)).toBe('a [redacted] b')
  })

  it('keeps shared values, marks a cycle, and never throws, as the file log writes them', () => {
    const log = createHostLog(join(dir, 'logs'), [SECRET])
    const shared = { value: SECRET }
    const cycle: Record<string, unknown> = { name: 'cycle' }
    cycle.self = cycle
    log.write('host', 'data', { first: shared, second: shared, cycle, count: 2n })
    log.write('host', 'getter', {
      get boom(): string {
        throw new Error(SECRET)
      },
    })
    const text = readFileSync(log.path()!, 'utf8')
    expect(text).toContain(
      '{"first":{"value":"[redacted]"},"second":{"value":"[redacted]"},' +
        '"cycle":{"name":"cycle","self":"[circular]"},"count":"2"}',
    )
    expect(text).toContain('[host] getter "[unserializable]"')
  })

  it('hides every line of a secret that spans lines, however short, but not a blank one', () => {
    const secrets = ['short-but-whole', 'line-one-x\r\nab\rline-three', 'ab\n \t\ncd']
    expect(redactionPieces(secrets)).toEqual([
      'line-one-x\r\nab\rline-three',
      'short-but-whole',
      'line-one-x',
      'line-three',
      'ab\n \t\ncd',
      'ab',
      'cd',
    ])
    // Two secrets whose every line is short, printed by pi and split as its stderr is.
    const log = createHostLog(join(dir, 'logs'), ['q7Zx1\nK9wP2', 'Jj\n \t\nVv'])
    for (const text of ['cannot reach with q7Zx1', 'K9wP2 and Jj', ' \t', 'Vv <']) {
      log.write('pi', 'stderr', { sessionId: 'a', text })
    }
    const written = readFileSync(log.path()!, 'utf8')
    for (const line of ['q7Zx1', 'K9wP2', 'Jj', 'Vv']) expect(written).not.toContain(line)
    expect(written).toContain('"text":"[redacted] and [redacted]"')
    expect(log.hide('spaces and\ttabs stay')).toBe('spaces and\ttabs stay')
  })
})
