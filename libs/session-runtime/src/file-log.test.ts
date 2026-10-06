import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
