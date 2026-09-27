import { compileGlobs } from './glob'
import { compileQuery, findMatches, type SearchQuery } from './text-search'

/**
 * The Files pane's search over every file in a workspace ("Search in files"):
 * what crosses IPC, the limits both processes state, and locating matches by
 * line and column. Main runs it (electron/fs/workspace-search-service.ts); the
 * panel is features/files/WorkspaceSearch.tsx.
 */

/** Matches collected before a search stops and says so. */
export const MAX_SEARCH_RESULTS = 2_000
/** A search still running after this long ends with what it found. */
export const SEARCH_TIME_LIMIT_MS = 20_000
/** The most files a workspace listing holds, and so the most one search reads. */
export const MAX_LISTED_FILES = 20_000
export const MAX_QUERY_LENGTH = 2_000
export const MAX_GLOBS_LENGTH = 4_000

export interface WorkspaceSearchRequest {
  /** Chosen by the renderer; names the search for `fs:cancelWorkspaceSearch`. */
  searchId: string
  workspacePath: string
  query: SearchQuery
  /** Comma-separated globs a file's workspace-relative path must match (`shared/glob.ts`). */
  include?: string
  /** Comma-separated globs that rule a file out. */
  exclude?: string
}

export interface LineMatch {
  /** 1-based line of the match start. */
  line: number
  /** 1-based column of the match start, in UTF-16 units (Monaco's columns). */
  column: number
  /** 1-based line of the match end; later than `line` only for a multi-line regex. */
  endLine: number
  /** 1-based column just past the match, on `endLine`. */
  endColumn: number
  /** The start line, cut down around the match when it is long. */
  preview: string
  /** The match inside `preview` (clipped to the line when it spans lines). */
  previewStart: number
  previewEnd: number
}

export interface FileSearchResult {
  /** Workspace-relative, `/`-separated. */
  path: string
  matches: LineMatch[]
}

export interface WorkspaceSearchResult {
  /** Files with matches, in path order. */
  files: FileSearchResult[]
  matchCount: number
  /** Files read and searched. */
  searchedFiles: number
  /** Files passed over: binary, media, too large, unreadable. */
  skippedFiles: number
  /**
   * Why the search ended before the last match: it collected the most results
   * it returns, it ran out of time, or a newer search replaced it.
   */
  stopped?: 'results' | 'time' | 'cancelled'
  /** The workspace holds more files than a search lists; only the first were searched. */
  moreFiles?: boolean
  /** The query or a glob does not compile, or the search failed. */
  error?: string
}

export const EMPTY_SEARCH_RESULT: WorkspaceSearchResult = Object.freeze({
  files: [],
  matchCount: 0,
  searchedFiles: 0,
  skippedFiles: 0,
})

export type CompiledSearch =
  | { status: 'empty' }
  | { status: 'invalid'; error: string }
  | { status: 'ready'; regex: RegExp; wants: (path: string) => boolean }

/**
 * A search's query and globs, compiled together: what main searches with, and
 * what the panel checks as you type, so a half-typed regex says so at once.
 * Broken globs are reported even while the query is empty.
 */
export function compileSearch({
  query,
  include = '',
  exclude = '',
}: Pick<WorkspaceSearchRequest, 'query' | 'include' | 'exclude'>): CompiledSearch {
  if (query.text.length > MAX_QUERY_LENGTH) {
    return {
      status: 'invalid',
      error: `Longer than ${MAX_QUERY_LENGTH.toLocaleString()} characters`,
    }
  }
  if (include.length > MAX_GLOBS_LENGTH || exclude.length > MAX_GLOBS_LENGTH) {
    return {
      status: 'invalid',
      error: `Longer than ${MAX_GLOBS_LENGTH.toLocaleString()} characters`,
    }
  }
  const compiled = compileQuery(query)
  if (compiled.status === 'invalid') return compiled
  const included = compileGlobs(include)
  if (included.status === 'invalid') return included
  const excluded = compileGlobs(exclude)
  if (excluded.status === 'invalid') return excluded
  if (compiled.status === 'empty') return compiled
  return {
    status: 'ready',
    regex: compiled.regex,
    wants: (path) =>
      (included.status !== 'ready' || included.test(path)) &&
      !(excluded.status === 'ready' && excluded.test(path)),
  }
}

/** Characters of context kept before a match in a clipped preview. */
const PREVIEW_BEFORE = 40
/** Longest preview a line is cut down to. */
const PREVIEW_MAX = 240

/**
 * One line cut down to something a results list can show, keeping the match
 * in view: a minified bundle is one 400 KB line, and the match could be at
 * the end of it.
 */
export function linePreview(
  line: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  if (line.length <= PREVIEW_MAX) return { text: line, start, end }
  const from = start > PREVIEW_BEFORE ? start - PREVIEW_BEFORE : 0
  const to = Math.min(line.length, from + PREVIEW_MAX)
  const lead = from > 0 ? '…' : ''
  const trail = to < line.length ? '…' : ''
  const shift = lead.length - from
  return {
    text: lead + line.slice(from, to) + trail,
    start: start + shift,
    end: Math.min(end, to) + shift,
  }
}

/**
 * Matches in a file's text, located by line and column, up to `limit`.
 *
 * Lines break at `\n` only: main turns CRLF and a lone CR into `\n` first, as
 * Monaco splits lines, so a line here is a line there. Lines are counted
 * incrementally between consecutive matches, so a file is walked once however
 * many matches it holds.
 */
export function findLineMatches(text: string, regex: RegExp, limit = Infinity): LineMatch[] {
  const out: LineMatch[] = []
  let line = 1
  let lineStart = 0
  /** Where the line at `lineStart` ends; found once per line, when a match needs it. */
  let lineEnd = -1
  let cursor = 0
  for (const range of findMatches(text, regex, limit)) {
    for (let i = cursor; i < range.start; i++) {
      if (text.charCodeAt(i) === 10) {
        line++
        lineStart = i + 1
        lineEnd = -1
      }
    }
    cursor = range.start
    let endLine = line
    let endLineStart = lineStart
    for (let i = range.start; i < range.end; i++) {
      if (text.charCodeAt(i) === 10) {
        endLine++
        endLineStart = i + 1
      }
    }
    if (lineEnd < lineStart) {
      const newline = text.indexOf('\n', lineStart)
      lineEnd = newline === -1 ? text.length : newline
    }
    const preview = linePreview(
      text.slice(lineStart, lineEnd),
      range.start - lineStart,
      Math.min(range.end, lineEnd) - lineStart,
    )
    out.push({
      line,
      column: range.start - lineStart + 1,
      endLine,
      endColumn: range.end - endLineStart + 1,
      preview: preview.text,
      previewStart: preview.start,
      previewEnd: preview.end,
    })
  }
  return out
}
