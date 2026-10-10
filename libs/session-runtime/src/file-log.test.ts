import { afterEach, describe, expect, it } from 'vitest'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileLog } from './file-log'

const directories: string[] = []
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'phosphor-log-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('createFileLog', () => {
  it('does no filesystem work before initialization and keeps instances independent', () => {
    const first = createFileLog()
    const second = createFileLog()
    first.write('pi', 'before init')
    expect(first.path()).toBeNull()
    first.init(directory())
    second.init(directory())
    first.write('pi', 'first', { value: 1 })
    second.write('pi', 'second')
    expect(readFileSync(first.path()!, 'utf8')).toMatch(/\[pi\] first {"value":1}\n$/)
    expect(readFileSync(first.path()!, 'utf8')).not.toContain('second')
    expect(readFileSync(second.path()!, 'utf8')).toMatch(/\[pi\] second\n$/)
  })

  it('initializes nested paths once without redirecting an active logger', () => {
    const logger = createFileLog()
    const root = directory()
    logger.init(join(root, 'nested'))
    const path = logger.path()
    logger.init(directory())
    expect(logger.path()).toBe(path)
    logger.write('app', 'ready')
    expect(readFileSync(path!, 'utf8')).toContain('[app] ready')
  })

  it('serializes bigint and circular metadata without losing the message', () => {
    const logger = createFileLog()
    logger.init(directory())
    logger.write('app', 'bigint', { count: 2n })
    const circular: { self?: unknown } = {}
    circular.self = circular
    logger.write('app', 'circular', circular)
    expect(readFileSync(logger.path()!, 'utf8')).toContain('bigint {"count":"2"}')
    expect(readFileSync(logger.path()!, 'utf8')).toContain('circular [unserializable]')
  })

  it('can keep its folder and every file, rotated ones included, to their owner', () => {
    const root = directory()
    const folder = join(root, 'state/logs')
    const mode = (path: string) => statSync(path).mode & 0o777
    const logger = createFileLog({ directory: 0o700, file: 0o600 })
    logger.init(folder)
    logger.write('host', 'first')
    expect([mode(join(root, 'state')), mode(folder), mode(logger.path()!)]).toEqual([
      0o700, 0o700, 0o600,
    ])
    writeFileSync(logger.path()!, 'x'.repeat(5 * 1024 * 1024))
    logger.write('host', 'after rotation')
    expect([mode(logger.path()!), mode(`${logger.path()!}.1`)]).toEqual([0o600, 0o600])
    // A folder, log and rotated log made earlier by something else are tightened, not trusted.
    const loose = join(root, 'loose')
    mkdirSync(loose, { mode: 0o755 })
    chmodSync(loose, 0o755)
    for (const name of ['phosphor.log', 'phosphor.log.1']) {
      writeFileSync(join(loose, name), 'old\n', { mode: 0o644 })
      chmodSync(join(loose, name), 0o644)
    }
    const second = createFileLog({ directory: 0o700, file: 0o600 })
    second.init(loose)
    const kept = `${second.path()!}.1`
    expect([mode(loose), mode(second.path()!), mode(kept)]).toEqual([0o700, 0o600, 0o600])
  })

  it('leaves permissions to the umask, or as they were, when given no modes', () => {
    const root = directory()
    // Desktop's case: an existing rotated log keeps its mode.
    writeFileSync(join(root, 'phosphor.log.1'), 'old\n')
    chmodSync(join(root, 'phosphor.log.1'), 0o644)
    const logger = createFileLog()
    logger.init(root)
    expect(statSync(join(root, 'phosphor.log.1')).mode & 0o777).toBe(0o644)
    logger.write('app', 'ready')
    // Whatever mode a plain write gets here, the log gets too.
    writeFileSync(join(root, 'plain'), '')
    expect(statSync(logger.path()!).mode & 0o777).toBe(statSync(join(root, 'plain')).mode & 0o777)
  })

  it('rotates at the existing limit and replaces only its previous log', () => {
    const root = directory()
    const logger = createFileLog()
    logger.init(root)
    const path = logger.path()!
    writeFileSync(path, 'x'.repeat(5 * 1024 * 1024))
    writeFileSync(`${path}.1`, 'previous')
    const unrelated = join(root, 'user-file')
    writeFileSync(unrelated, 'keep')
    logger.write('app', 'next')
    expect(readFileSync(`${path}.1`, 'utf8')).toHaveLength(5 * 1024 * 1024)
    expect(readFileSync(path, 'utf8')).toContain('[app] next')
    expect(readFileSync(unrelated, 'utf8')).toBe('keep')
  })

  it('never throws on initialization or later write failure', () => {
    const root = directory()
    const notDirectory = join(root, 'file')
    writeFileSync(notDirectory, 'keep')
    const failed = createFileLog()
    expect(() => failed.init(notDirectory)).not.toThrow()
    expect(failed.path()).toBeNull()
    failed.init(root)
    expect(failed.path()).toBeNull()
    expect(() => failed.write('app', 'ignored')).not.toThrow()

    const logger = createFileLog()
    logger.init(join(root, 'logs'))
    rmSync(join(root, 'logs'), { recursive: true })
    expect(() => logger.write('pi', 'lost directory')).not.toThrow()
  })
})
