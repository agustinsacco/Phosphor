import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as WorkspaceSearch from '@shared/workspace-search'

vi.mock('@shared/workspace-search', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceSearch>()),
  MAX_LISTED_FILES: 4,
}))

const { listWorkspaceFileList } = await import('./list-files')

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })))
})

async function workspace(files: string[], { git = false } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'phosphor-list-files-'))
  roots.push(root)
  if (git) execFileSync('git', ['init', '-q'], { cwd: root })
  for (const path of files) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), '')
  }
  return root
}

describe('listWorkspaceFileList', () => {
  it("lists git's files, gitignore applied, with paths as they are on disk", async () => {
    const root = await workspace(['.gitignore', 'café.md', 'src/a.ts', 'build.log'], { git: true })
    await writeFile(join(root, '.gitignore'), '*.log\n')
    const list = await listWorkspaceFileList(root)
    expect(list.files.sort()).toEqual(['.gitignore', 'café.md', 'src/a.ts'])
    expect(list.truncated).toBe(false)
  })

  it('walks a folder that is not a repository, past the usual ignores', async () => {
    const root = await workspace(['a.txt', 'src/b.ts', 'node_modules/x.js', '.hidden/y.txt'])
    const list = await listWorkspaceFileList(root)
    expect(list.files.sort()).toEqual(['a.txt', 'src/b.ts'])
  })

  it('stops at the listing cap and says so', async () => {
    const files = ['a', 'b', 'c', 'd', 'e'].map((name) => `${name}.txt`)
    for (const git of [true, false]) {
      const list = await listWorkspaceFileList(await workspace(files, { git }))
      expect(list.files).toHaveLength(4)
      expect(list.truncated).toBe(true)
    }
    const exact = await listWorkspaceFileList(await workspace(files.slice(0, 4)))
    expect(exact.truncated).toBe(false)
  })

  it('rejects once stopped, rather than falling back to a walk', async () => {
    for (const git of [true, false]) {
      const root = await workspace(['a.txt'], { git })
      await expect(listWorkspaceFileList(root, AbortSignal.abort('time'))).rejects.toBe('time')
    }
  })
})
