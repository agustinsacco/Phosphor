import { describe, expect, it } from 'vitest'
import type { ArtifactListing } from '@shared/artifacts'
import type { Artifact } from '@/stores/artifacts'
import { mergeGlobalArtifacts } from './globalArtifacts'

const stored = (over: Partial<ArtifactListing> = {}): ArtifactListing => ({
  key: 'sid/guide',
  sessionId: 'sid',
  id: 'guide',
  sessionFile: '/sessions/a.jsonl',
  cwd: '/work',
  sessionName: 'Remote access',
  title: 'Guide',
  type: 'html',
  version: 2,
  versionCount: 2,
  updatedAt: 100,
  sessionDeleted: false,
  copies: 0,
  ...over,
})

const liveArtifact = (version: number, updatedAt: number): Artifact => ({
  id: 'guide',
  title: `Guide v${version}`,
  type: 'html',
  versions: Array.from({ length: version }, (_, i) => ({
    version: i + 1,
    title: 'Guide',
    content: '',
    createdAt: 0,
  })),
  updatedAt,
})

describe('mergeGlobalArtifacts', () => {
  it('lists closed and deleted sessions’ artifacts straight from the store', () => {
    const rows = mergeGlobalArtifacts([stored({ sessionDeleted: true })], [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'sid/guide', sessionDeleted: true })
    expect(rows[0]!.phosphorId).toBeUndefined()
  })

  it('marks a stored row whose session is open, so it opens in place', () => {
    const rows = mergeGlobalArtifacts(
      [stored()],
      [{ phosphorId: 'p1', diskPath: '/sessions/a.jsonl', workspacePath: '/work', artifacts: {} }],
    )
    expect(rows[0]!.phosphorId).toBe('p1')
  })

  it('lays a running turn’s newer version over the stored one', () => {
    const rows = mergeGlobalArtifacts(
      [stored()],
      [
        {
          phosphorId: 'p1',
          diskPath: '/sessions/a.jsonl',
          workspacePath: '/work',
          artifacts: { guide: liveArtifact(3, 500) },
        },
      ],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'sid/guide',
      version: 3,
      updatedAt: 500,
      title: 'Guide v3',
    })
    // Still knows which session it came from.
    expect(rows[0]!.sessionName).toBe('Remote access')
  })

  it('includes a brand-new session that has no file yet', () => {
    const rows = mergeGlobalArtifacts(
      [],
      [{ phosphorId: 'p2', workspacePath: '/work', artifacts: { guide: liveArtifact(1, 50) } }],
    )
    expect(rows[0]).toMatchObject({ key: 'live:p2/guide', phosphorId: 'p2', cwd: '/work' })
  })

  it('sorts newest first', () => {
    const rows = mergeGlobalArtifacts(
      [stored({ key: 'a', id: 'a', updatedAt: 1 }), stored({ key: 'b', id: 'b', updatedAt: 9 })],
      [],
    )
    expect(rows.map((r) => r.key)).toEqual(['b', 'a'])
  })
})
