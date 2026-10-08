import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactListing } from '@shared/artifacts'
import { ArtifactLibrary, foldForks } from './artifact-library'

function sessionFile(
  id: string,
  artifacts: Array<{ slug: string; version: number; content: string }>,
): string {
  const lines = [JSON.stringify({ type: 'session', version: 3, id, timestamp: 't', cwd: '/work' })]
  let parent: string | null = null
  artifacts.forEach((a, i) => {
    const entryId = `${id.slice(-2)}${i}`
    lines.push(
      JSON.stringify({
        type: 'message',
        id: entryId,
        parentId: parent,
        timestamp: `2026-10-0${i + 1}T00:00:00.000Z`,
        message: {
          role: 'toolResult',
          toolName: a.version === 1 ? 'artifact_create' : 'artifact_edit',
          toolCallId: `call-${a.slug}-${a.version}`,
          details: {
            id: a.slug,
            title: a.slug,
            type: 'markdown',
            content: a.content,
            version: a.version,
          },
        },
      }),
    )
    parent = entryId
  })
  return lines.map((l) => `${l}\n`).join('')
}

describe('ArtifactLibrary', () => {
  let dir: string
  let sessions: string
  let library: ArtifactLibrary
  const root = (): string => join(dir, 'store')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'artifact-library-'))
    sessions = join(dir, 'sessions')
    mkdirSync(join(sessions, '--work--'), { recursive: true })
    library = new ArtifactLibrary(root)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const put = (name: string, id: string, artifacts: Parameters<typeof sessionFile>[1]): string => {
    const path = join(sessions, '--work--', name)
    writeFileSync(path, sessionFile(id, artifacts))
    return path
  }

  it('gives a pane every version on the branch, with content and real dates', async () => {
    const path = put('a.jsonl', 'session-aaaaaaaa', [
      { slug: 'notes', version: 1, content: '# one' },
      { slug: 'notes', version: 2, content: '# two' },
    ])
    const [notes] = await library.forSession(path)
    expect(notes!.id).toBe('notes')
    expect(notes!.versions.map((v) => [v.version, v.content])).toEqual([
      [1, '# one'],
      [2, '# two'],
    ])
    expect(new Date(notes!.versions[1]!.createdAt).toISOString()).toBe('2026-10-02T00:00:00.000Z')
  })

  it('keeps a deleted session’s artifacts, says so, and removes them only on request', async () => {
    const path = put('a.jsonl', 'session-aaaaaaaa', [{ slug: 'notes', version: 1, content: 'x' }])
    await library.indexFile(path)
    // A live session's artifact is part of its history: not removable on its own.
    expect(await library.remove('session-aaaaaaaa/notes')).toBe(false)

    await library.retainDeletedSession(path)
    rmSync(path)
    const [listing] = await library.list()
    expect(listing).toMatchObject({ key: 'session-aaaaaaaa/notes', sessionDeleted: true })
    expect((await library.read('session-aaaaaaaa/notes'))?.artifact.versions[0]?.content).toBe('x')

    expect(await library.remove('session-aaaaaaaa/notes')).toBe(true)
    expect(await library.list()).toEqual([])
    // Its content goes too, and so does the now-empty index.
    expect(readdirSync(join(root(), 'blobs'))).toEqual([])
    expect(existsSync(join(root(), 'sessions', 'session-aaaaaaaa.json'))).toBe(false)
  })

  it('keeps no index for a deleted session that had no artifacts', async () => {
    const path = put('a.jsonl', 'session-aaaaaaaa', [])
    await library.indexFile(path)
    await library.retainDeletedSession(path)
    expect(existsSync(join(root(), 'sessions', 'session-aaaaaaaa.json'))).toBe(false)
  })

  it('survives a restart: a new library reads the same store', async () => {
    const path = put('a.jsonl', 'session-aaaaaaaa', [{ slug: 'notes', version: 1, content: 'x' }])
    await library.indexFile(path)
    const again = new ArtifactLibrary(root)
    expect((await again.list()).map((l) => l.key)).toEqual(['session-aaaaaaaa/notes'])
  })

  it('backfills every session file once, then only the ones that changed', async () => {
    put('a.jsonl', 'session-aaaaaaaa', [{ slug: 'notes', version: 1, content: 'x' }])
    put('b.jsonl', 'session-bbbbbbbb', [{ slug: 'plan', version: 1, content: 'y' }])
    writeFileSync(join(sessions, '--work--', 'ignored.txt'), 'not a session')
    expect(await library.backfill(sessions)).toEqual({ indexed: 2, failed: 0 })
    expect(await library.backfill(sessions)).toEqual({ indexed: 0, failed: 0 })
    expect((await library.list()).map((l) => l.id).sort()).toEqual(['notes', 'plan'])
    expect(await library.backfill(join(dir, 'missing'))).toEqual({ indexed: 0, failed: 0 })
  })

  it('serialises concurrent indexing of one file', async () => {
    const path = put('a.jsonl', 'session-aaaaaaaa', [{ slug: 'notes', version: 1, content: 'x' }])
    const results = await Promise.all([library.indexFile(path), library.indexFile(path)])
    expect(results[0]!.artifacts.notes!.versions).toHaveLength(1)
    expect(results[1]!.artifacts.notes!.versions).toHaveLength(1)
  })
})

describe('foldForks', () => {
  const listing = (over: Partial<ArtifactListing>): ArtifactListing => ({
    key: 'k',
    sessionId: 's',
    id: 'notes',
    sessionFile: '/a/2026-10-01T00-00-00-000Z_s.jsonl',
    cwd: '/work',
    title: 'Notes',
    type: 'markdown',
    version: 1,
    versionCount: 1,
    updatedAt: 1,
    sessionDeleted: false,
    copies: 0,
    ...over,
  })

  it('folds forks that still share a version, preferring a live, newer session', () => {
    const rows = foldForks([
      { listing: listing({ key: 'old', sessionDeleted: true }), origin: 'call-1' },
      {
        listing: listing({ key: 'fork', sessionFile: '/b/2026-10-02T00-00-00-000Z_f.jsonl' }),
        origin: 'call-1',
      },
      { listing: listing({ key: 'changed', version: 2, updatedAt: 5 }), origin: 'call-2' },
    ])
    expect(rows.map((r) => [r.key, r.copies])).toEqual([
      ['changed', 0],
      ['fork', 1],
    ])
  })
})
