import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shell } from 'electron'
vi.mock('electron', () => ({ shell: { trashItem: vi.fn().mockResolvedValue(undefined) } }))
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionBaseline, restoreFileTo, showFileAt } from './git-service'

/**
 * Regression cover for the session baseline.
 *
 * The bug: `createSessionBaseline` used `git stash create`, which silently
 * omits untracked files. Untracked files are exactly the class that was
 * unrecoverable in the two-agents-one-tree incident.
 *
 * `captures untracked source files` is the assertion that matters, and it has
 * been verified to FAIL against the `git stash create` implementation: a stash
 * commit has no entry for an untracked path, so `showFileAt` returns null.
 * Restoring the old body is the way to re-prove this test is not vacuous.
 */

const execFileAsync = promisify(execFile)

let repo: string

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

beforeEach(async () => {
  vi.mocked(shell.trashItem).mockClear()
  repo = await mkdtemp(join(tmpdir(), 'phosphor-baseline-'))
  await git(repo, ['init', '-b', 'main'])
  await git(repo, ['config', 'user.email', 'test@phosphor.dev'])
  await git(repo, ['config', 'user.name', 'Phosphor test'])
  await writeFile(join(repo, 'tracked.txt'), 'committed\n')
  await git(repo, ['add', '-A'])
  await git(repo, ['commit', '-m', 'initial'])
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('safe file restoration', () => {
  it('refuses unavailable baselines without trashing or changing anything', async () => {
    await expect(restoreFileTo(repo, 'missing-baseline', 'tracked.txt')).rejects.toThrow()
    expect(shell.trashItem).not.toHaveBeenCalled()
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('committed\n')
  })

  it('trashes only a file confirmed absent from a valid baseline', async () => {
    await writeFile(join(repo, 'new.txt'), 'new\n')
    expect(await restoreFileTo(repo, 'HEAD', 'new.txt')).toEqual({ restored: false, deleted: true })
    expect(shell.trashItem).toHaveBeenCalledWith(join(repo, 'new.txt'))
  })

  it('restores the working copy without changing staged content', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'staged\n')
    await git(repo, ['add', 'tracked.txt'])
    await writeFile(join(repo, 'tracked.txt'), 'unstaged\n')
    await restoreFileTo(repo, 'HEAD', 'tracked.txt')
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('committed\n')
    expect(await git(repo, ['show', ':tracked.txt'])).toBe('staged')
  })

  it('preserves empty files instead of treating them as absent', async () => {
    await writeFile(join(repo, 'empty.txt'), '')
    const ref = await createSessionBaseline(repo)
    await writeFile(join(repo, 'empty.txt'), 'modified')
    await restoreFileTo(repo, ref!, 'empty.txt')
    expect(await readFile(join(repo, 'empty.txt'), 'utf8')).toBe('')
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('treats filename metacharacters literally', async () => {
    await writeFile(join(repo, 'a[1].txt'), 'original')
    await writeFile(join(repo, 'a1.txt'), 'other')
    const ref = await createSessionBaseline(repo)
    await writeFile(join(repo, 'a[1].txt'), 'changed')
    await writeFile(join(repo, 'a1.txt'), 'leave alone')
    await restoreFileTo(repo, ref!, 'a[1].txt')
    expect(await readFile(join(repo, 'a[1].txt'), 'utf8')).toBe('original')
    expect(await readFile(join(repo, 'a1.txt'), 'utf8')).toBe('leave alone')
  })

  it.each(['../outside', '/outside', '.git/config', 'a/../../outside'])(
    'refuses unsafe path %s',
    async (path) => {
      await expect(restoreFileTo(repo, 'HEAD', path)).rejects.toThrow('inside the workspace')
      expect(shell.trashItem).not.toHaveBeenCalled()
    },
  )
})

describe('createSessionBaseline', () => {
  it('captures untracked source files', async () => {
    await writeFile(join(repo, 'untracked.ts'), 'export const x = 1\n')

    const ref = await createSessionBaseline(repo)
    expect(ref).toBeTruthy()

    expect(await showFileAt(repo, ref as string, 'untracked.ts')).toBe('export const x = 1\n')
  })

  it('captures uncommitted edits to tracked files', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'edited\n')

    const ref = await createSessionBaseline(repo)

    expect(await showFileAt(repo, ref as string, 'tracked.txt')).toBe('edited\n')
  })

  it('leaves the working tree, the index and HEAD untouched', async () => {
    await writeFile(join(repo, 'untracked.ts'), 'export const x = 1\n')
    await writeFile(join(repo, 'tracked.txt'), 'edited\n')

    const statusBefore = await git(repo, ['status', '--porcelain'])
    const headBefore = await git(repo, ['rev-parse', 'HEAD'])

    await createSessionBaseline(repo)

    expect(await git(repo, ['status', '--porcelain'])).toBe(statusBefore)
    expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(headBefore)
  })

  it('honours .gitignore, so build output stays out of the baseline', async () => {
    await writeFile(join(repo, '.gitignore'), 'node_modules/\n')
    await writeFile(join(repo, 'node_modules-marker.txt'), 'x\n')
    await git(repo, ['add', '.gitignore'])
    await git(repo, ['commit', '-m', 'ignore'])

    await rm(join(repo, 'node_modules-marker.txt'), { force: true })
    await execFileAsync('mkdir', ['-p', join(repo, 'node_modules')])
    await writeFile(join(repo, 'node_modules', 'big.js'), 'x'.repeat(1000))

    const ref = await createSessionBaseline(repo)

    expect(await showFileAt(repo, ref as string, 'node_modules/big.js')).toBeNull()
  })

  it('works in a repo with no commits yet', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'phosphor-baseline-empty-'))
    try {
      await git(fresh, ['init', '-b', 'main'])
      await writeFile(join(fresh, 'first.ts'), 'export const y = 2\n')

      const ref = await createSessionBaseline(fresh)
      expect(ref).toBeTruthy()
      expect(await showFileAt(fresh, ref as string, 'first.ts')).toBe('export const y = 2\n')
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })

  it('returns null outside a repo', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'phosphor-baseline-plain-'))
    try {
      expect(await createSessionBaseline(plain)).toBeNull()
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  })
})
