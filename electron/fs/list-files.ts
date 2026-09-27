import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { MAX_LISTED_FILES } from '@shared/workspace-search'

const execFileAsync = promisify(execFile)

const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'target',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
])

export interface WorkspaceFileList {
  /** Workspace-relative, `/`-separated: git's tracked files, then its untracked ones. */
  files: string[]
  /** The workspace holds more than `MAX_LISTED_FILES`; `files` is the first of them. */
  truncated: boolean
}

/**
 * List workspace files for @-mentions, the fuzzy finder and the workspace search.
 * Prefers `git ls-files` (gitignore-aware, fast); falls back to a bounded
 * recursive walk with standard ignores.
 *
 * `-z` because without it git quotes any path outside plain ASCII
 * (`"caf\303\251.md"`), which then names no file on disk.
 *
 * `signal` stops the listing part-way (git is killed) and rejects with its
 * reason.
 */
export async function listWorkspaceFileList(
  workspacePath: string,
  signal?: AbortSignal,
): Promise<WorkspaceFileList> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: workspacePath, maxBuffer: 32 * 1024 * 1024, timeout: 15_000, signal },
    )
    // A conflicted path is listed once per merge stage.
    const files = [...new Set(stdout.split('\0').filter(Boolean))]
    if (files.length > 0) {
      return {
        files: files.slice(0, MAX_LISTED_FILES),
        truncated: files.length > MAX_LISTED_FILES,
      }
    }
  } catch {
    // Not a git repo — fall through, unless the listing was stopped.
    signal?.throwIfAborted()
  }
  const results: string[] = []
  const truncated = await walk(workspacePath, workspacePath, results, signal)
  return { files: results, truncated }
}

export async function listWorkspaceFiles(workspacePath: string): Promise<string[]> {
  return (await listWorkspaceFileList(workspacePath)).files
}

/** Collect files below `dir`; true when it stopped at `MAX_LISTED_FILES` with more left. */
async function walk(
  root: string,
  dir: string,
  results: string[],
  signal: AbortSignal | undefined,
): Promise<boolean> {
  signal?.throwIfAborted()
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue
    if (DEFAULT_IGNORES.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (await walk(root, full, results, signal)) return true
    } else if (entry.isFile()) {
      if (results.length >= MAX_LISTED_FILES) return true
      results.push(relative(root, full).split(sep).join('/'))
    }
  }
  return false
}
