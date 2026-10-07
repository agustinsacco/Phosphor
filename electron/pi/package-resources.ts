/**
 * What an installed pi package contributes: its extensions, skills, prompts
 * and themes, resolved to real paths the way pi resolves them.
 *
 * A `pi` manifest lists directories and globs (`"skills": ["./skills"]`), not
 * resources. Showing those entries as written made pi-subagents read as
 * "1 skill · 1 prompt" when it ships two skills and six prompts, so each entry
 * is expanded here: a directory follows pi's convention rules, a glob is
 * matched below its static prefix, `!pattern` exclusions are applied. Without
 * a manifest, pi's convention directories are read.
 *
 * Display only. pi stays the authority on what loads (settings-level filters
 * in the object form are not applied; the row says "filtered" instead).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { PiPackageResources } from '@shared/models'
import { parseSkillFrontmatter } from '@shared/skills'

export type ResourceKind = keyof PiPackageResources

const KINDS: ResourceKind[] = ['extensions', 'skills', 'prompts', 'themes']
const FILE_EXTS: Record<ResourceKind, string[]> = {
  extensions: ['.ts', '.js'],
  skills: ['.md'],
  prompts: ['.md'],
  themes: ['.json'],
}
/** Bounds the walk: a package is a published tarball, not a workspace. */
const MAX_DEPTH = 5
const MAX_PATHS = 200

export const EMPTY_RESOURCES: PiPackageResources = {
  extensions: [],
  skills: [],
  prompts: [],
  themes: [],
}

function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function entries(dir: string): Array<{ name: string; path: string; dir: boolean }> {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map((entry) => ({
        name: entry.name,
        path: join(dir, entry.name),
        dir: entry.isDirectory(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

const hasExt = (kind: ResourceKind, name: string): boolean =>
  FILE_EXTS[kind].some((ext) => name.endsWith(ext))

const hasIndex = (dir: string): boolean =>
  existsSync(join(dir, 'index.ts')) || existsSync(join(dir, 'index.js'))

/** Skill bundles under `dir`, recursively; a bundle's own subdirs are not skills. */
function skillPaths(dir: string, depth: number, top: boolean): string[] {
  if (existsSync(join(dir, 'SKILL.md'))) return [dir]
  if (depth < 0) return []
  const found: string[] = []
  for (const entry of entries(dir)) {
    if (entry.dir) found.push(...skillPaths(entry.path, depth - 1, false))
    // Loose `.md` skills count only at the root of a skills directory.
    else if (top && entry.name.endsWith('.md')) found.push(entry.path)
  }
  return found
}

/** One kind's resources inside a directory, by pi's convention rules. */
function conventionPaths(kind: ResourceKind, dir: string): string[] {
  if (kind === 'skills') return skillPaths(dir, MAX_DEPTH, true)
  // A directory with an entry point is one extension (`"extensions": ["./dist"]`).
  if (kind === 'extensions' && hasIndex(dir)) return [dir]
  return entries(dir).flatMap((entry) => {
    if (!entry.dir) return hasExt(kind, entry.name) ? [entry.path] : []
    return kind === 'extensions' && hasIndex(entry.path) ? [entry.path] : []
  })
}

/** `*` matches within a segment, `**` across segments. */
function globRegex(pattern: string): RegExp {
  const body = pattern
    .replace(/^\.\//, '')
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((chunk) => chunk.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*')
  return new RegExp(`^${body.replace(/\.\*\//g, '(?:.*/)?')}$`)
}

function globPaths(root: string, pattern: string): string[] {
  const segments = pattern.replace(/^\.\//, '').split('/')
  const firstGlob = segments.findIndex((segment) => segment.includes('*'))
  const base = resolve(root, ...segments.slice(0, firstGlob))
  if (!within(root, base)) return []
  const regex = globRegex(pattern)
  const matches: string[] = []
  const walk = (dir: string, depth: number): void => {
    for (const entry of entries(dir)) {
      if (matches.length >= MAX_PATHS) return
      const rel = relative(root, entry.path).split(sep).join('/')
      if (regex.test(rel)) matches.push(entry.path)
      else if (entry.dir && depth > 0) walk(entry.path, depth - 1)
    }
  }
  walk(base, MAX_DEPTH)
  return matches
}

/** Expand one manifest entry (path, directory or glob) to resource paths. */
function manifestPaths(kind: ResourceKind, root: string, entry: string): string[] {
  const candidates = entry.includes('*') ? globPaths(root, entry) : [resolve(root, entry)]
  return candidates.flatMap((path) => {
    if (!within(root, path)) return []
    let isDir: boolean
    try {
      isDir = statSync(path).isDirectory()
    } catch {
      return []
    }
    if (isDir) return conventionPaths(kind, path)
    return kind === 'extensions' || hasExt(kind, path) ? [path] : []
  })
}

/**
 * Absolute paths of everything a package directory provides, per kind.
 * A single-file package is one extension.
 */
export function resolvePackagePaths(installPath: string): PiPackageResources {
  const root = resolve(installPath)
  let stats
  try {
    stats = statSync(root)
  } catch {
    return EMPTY_RESOURCES
  }
  if (stats.isFile()) return { ...EMPTY_RESOURCES, extensions: [root] }

  const manifest = readManifest(root)
  const result: PiPackageResources = { extensions: [], skills: [], prompts: [], themes: [] }
  for (const kind of KINDS) {
    let paths: string[]
    if (manifest) {
      const listed = manifest[kind]
      const patterns = Array.isArray(listed)
        ? listed.filter((value): value is string => typeof value === 'string')
        : []
      const excluded = patterns
        .filter((pattern) => pattern.startsWith('!'))
        .map((pattern) => globRegex(pattern.slice(1)))
      paths = patterns
        .filter((pattern) => !pattern.startsWith('!'))
        .flatMap((pattern) => manifestPaths(kind, root, pattern))
        .filter((path) => {
          const rel = relative(root, path).split(sep).join('/')
          return !excluded.some((regex) => regex.test(rel))
        })
    } else {
      const dir = join(root, kind)
      paths = existsSync(dir) ? conventionPaths(kind, dir) : []
    }
    result[kind] = [...new Set(paths)].slice(0, MAX_PATHS)
  }
  return result
}

function readManifest(root: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      pi?: unknown
    }
    return parsed.pi && typeof parsed.pi === 'object'
      ? (parsed.pi as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const stripExt = (name: string): string => name.replace(/\.[^.]+$/, '')

/** The name pi resolves a skill by: frontmatter `name`, else the bundle dir. */
function skillName(path: string): string {
  const file = path.endsWith('.md') ? path : join(path, 'SKILL.md')
  try {
    const name = parseSkillFrontmatter(readFileSync(file, 'utf8')).attrs['name']
    if (name) return name
  } catch {
    // unreadable — fall back to the path
  }
  return path.endsWith('.md') ? stripExt(basename(path)) : basename(path)
}

/**
 * Display names per kind: skill names, prompt command names (no `/`), theme
 * names, extension file or directory names.
 */
export function discoverResources(installPath: string): PiPackageResources {
  const paths = resolvePackagePaths(installPath)
  const unique = (names: string[]): string[] => [...new Set(names)]
  return {
    extensions: unique(paths.extensions.map((path) => basename(path))),
    skills: unique(paths.skills.map(skillName)),
    prompts: unique(paths.prompts.map((path) => stripExt(basename(path)))),
    themes: unique(paths.themes.map((path) => stripExt(basename(path)))),
  }
}
