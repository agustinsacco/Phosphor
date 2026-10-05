import { shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { git } from './git-exec'

/** Per-file porcelain status for explorer dots: relativePath → XY code. */
export async function gitStatusMap(workspacePath: string): Promise<Record<string, string>> {
  const out = await git(workspacePath, ['status', '--porcelain', '-uall'], { allowFail: true })
  const map: Record<string, string> = {}
  for (const line of out.split('\n')) {
    if (line.length < 4) continue
    const code = line.slice(0, 2)
    let path = line.slice(3)
    // Renames: "R  old -> new"
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4)
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
    map[path] = code
  }
  return map
}

/**
 * Session baseline: a commit-ish capturing the exact worktree at session
 * start WITHOUT touching the working directory, the index, or HEAD.
 * Returns null for non-repos.
 *
 * This used to be `git stash create`, which **silently omits untracked
 * files**. Untracked files are exactly the class that was unrecoverable when
 * two concurrent sessions collided in one tree (one agent ran
 * `git add -A && commit` and discarded the rest; a component and an extracted
 * module were rebuilt from scratch). So the product's own undo did not cover
 * the loss it was written for.
 *
 * The replacement stages into a throwaway index and writes a real tree:
 *
 *   read-tree HEAD → add -A → write-tree → commit-tree
 *
 * Two things are load-bearing.
 *
 * 1. `GIT_INDEX_FILE` must live OUTSIDE the worktree. Point it inside and
 *    `git add -A` captures the index file into the tree it is indexing.
 * 2. The identity is forced in the env. `commit-tree` fails outright on a
 *    machine with no `user.email` configured, and a baseline that only works
 *    on configured machines is worse than none.
 *
 * `add -A` honours `.gitignore`, so `node_modules` and build output stay out;
 * this captures untracked *source*, which is the point.
 *
 * Lifetime is unchanged from the stash version: the commit is a loose object
 * nothing references, so it survives until a `git gc` prune (default two
 * weeks), which comfortably outlives a session.
 */
export async function createSessionBaseline(workspacePath: string): Promise<string | null> {
  try {
    await git(workspacePath, ['rev-parse', '--git-dir'])
  } catch {
    return null
  }

  const head = await git(workspacePath, ['rev-parse', 'HEAD'], { allowFail: true, trim: true })
  const indexFile = join(tmpdir(), `phosphor-baseline-${randomUUID()}.index`)
  const env = {
    GIT_INDEX_FILE: indexFile,
    GIT_AUTHOR_NAME: 'Phosphor',
    GIT_AUTHOR_EMAIL: 'phosphor@localhost',
    GIT_COMMITTER_NAME: 'Phosphor',
    GIT_COMMITTER_EMAIL: 'phosphor@localhost',
  }

  try {
    // Skipped in a repo with no commits yet: there is no tree to read.
    if (head) await git(workspacePath, ['read-tree', head], { env })
    await git(workspacePath, ['add', '-A'], { env })
    const tree = await git(workspacePath, ['write-tree'], { env, trim: true })
    if (!tree) return head || null
    const args = ['commit-tree', tree, '-m', 'Phosphor session baseline']
    if (head) args.push('-p', head)
    const commit = await git(workspacePath, args, { env, trim: true })
    return commit || head || null
  } catch {
    // Any failure falls back to HEAD, which is what the old code did when the
    // tree was clean. Never throw: a missing baseline degrades the diff pane,
    // it must not fail session start.
    return head || null
  } finally {
    await rm(indexFile, { force: true })
  }
}

async function baselineFile(workspacePath: string, ref: string, path: string) {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => !part || part === '..' || part === '.' || part === '.git')
  )
    throw new Error('Expected a file path inside the workspace.')
  // Resolve once so ref changes cannot alter the object between checking and restoring.
  // Failure here is NOT evidence that this is a newly created file.
  const tree = await git(
    workspacePath,
    ['rev-parse', '--verify', '--end-of-options', `${ref}^{tree}`],
    { trim: true },
  )
  const listing = await git(workspacePath, ['ls-tree', '-z', tree, '--', path], {
    env: { GIT_LITERAL_PATHSPECS: '1' },
  })
  const entry = listing.split('\0').find((line) => line.slice(line.indexOf('\t') + 1) === path)
  if (!entry) return { tree, content: null }
  const [, type, object] = entry.slice(0, entry.indexOf('\t')).split(' ')
  if (type !== 'blob' || !object) throw new Error('The baseline path is not a file.')
  const content = await git(workspacePath, ['cat-file', 'blob', object])
  return { tree, content }
}

/** Null means confirmed absence in a valid tree; Git/read failures propagate. */
export async function showFileAt(
  workspacePath: string,
  ref: string,
  relativePath: string,
): Promise<string | null> {
  return (await baselineFile(workspacePath, ref, relativePath)).content
}

/** Restore one file to its baseline content (file-recovery UX). */
export async function restoreFileTo(
  workspacePath: string,
  ref: string,
  relativePath: string,
): Promise<{ restored: boolean; deleted: boolean }> {
  const baseline = await baselineFile(workspacePath, ref, relativePath)
  if (baseline.content === null) {
    // Didn't exist at baseline — the session created it; trash it.
    const { join } = await import('node:path')
    await shell.trashItem(join(workspacePath, relativePath))
    return { restored: false, deleted: true }
  }
  // The user's staged changes belong to them. Only restore the working copy.
  await git(
    workspacePath,
    ['restore', `--source=${baseline.tree}`, '--worktree', '--', relativePath],
    {
      env: { GIT_LITERAL_PATHSPECS: '1' },
    },
  )
  return { restored: true, deleted: false }
}
