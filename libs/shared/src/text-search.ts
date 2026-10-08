/**
 * The one match engine behind every find surface: the transcript's find bar,
 * the artifact viewer's, and the workspace search main runs over files
 * (`shared/workspace-search.ts`).
 *
 * Pure and dependency-free so both processes share it. Surfaces differ in
 * WHERE they look (row data, a rendered DOM subtree, file contents) and in how
 * they reveal a match; what counts as a match is decided here, once, so the
 * same query with the same toggles finds the same thing everywhere.
 */

export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  /** The query is a JavaScript regular expression, not literal text. */
  regex: boolean
}

export interface SearchQuery extends SearchOptions {
  text: string
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
}

/** Half-open `[start, end)` offsets into the searched string. */
export interface TextRange {
  start: number
  end: number
}

export type CompiledQuery =
  { status: 'empty' } | { status: 'invalid'; error: string } | { status: 'ready'; regex: RegExp }

/** Escape every character a RegExp would read as syntax. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
}

/** A RegExp syntax error as a reader can use it: the reason, not the source echoed back. */
export function regexErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Invalid regular expression: \/.*\/[a-z]*: /s, '')
}

/**
 * Whole word guards only the edges that are word characters, as editors do:
 * `\b` around `.then(` would demand a word boundary between `(` and whatever
 * follows, which rejects exactly the call sites being looked for. Each guard
 * applies only when the match's own edge is a word character, so it works the
 * same for literal text and for a regex, whose edges its source cannot tell.
 */
const WORD_START = '(?:(?=\\w)(?<!\\w)|(?!\\w))'
const WORD_END = '(?:(?<=\\w)(?!\\w)|(?<!\\w))'

/**
 * Turn a query into the regex every surface matches with.
 *
 * Always global and multiline — `^`/`$` anchor per line, which is what a
 * reader means in a file or a transcript — and case-insensitive unless asked.
 */
export function compileQuery(query: SearchQuery): CompiledQuery {
  if (query.text === '') return { status: 'empty' }
  const flags = query.caseSensitive ? 'gm' : 'gim'
  try {
    // A regex is checked on its own first: wrapped for whole word, an
    // unbalanced one (`a)|(b`) could close the wrapper's group and compile.
    let source = query.regex ? new RegExp(query.text, flags).source : escapeRegExp(query.text)
    if (query.wholeWord) source = `${WORD_START}(?:${source})${WORD_END}`
    return { status: 'ready', regex: new RegExp(source, flags) }
  } catch (error) {
    return { status: 'invalid', error: regexErrorText(error) }
  }
}

/**
 * Call `visit` for every non-empty match of `regex` in `text`, in order, up to
 * `limit`.
 *
 * Empty matches (`a*`, `^`, a lookahead) are skipped: a find bar has nothing
 * to paint or step to for them, and counting them would inflate "n of m" with
 * matches no one can see. The regex must carry the `g` flag (`compileQuery`'s
 * always does); its `lastIndex` is reset, so sharing one across calls is safe.
 */
function eachMatch(
  text: string,
  regex: RegExp,
  limit: number,
  visit: (start: number, end: number) => void,
): void {
  if (limit <= 0) return
  let seen = 0
  regex.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const length = match[0].length
    if (length === 0) {
      regex.lastIndex++
      continue
    }
    visit(match.index, match.index + length)
    if (++seen >= limit) break
  }
  regex.lastIndex = 0
}

/** Every non-empty match of `regex` in `text`, in order, up to `limit`. */
export function findMatches(text: string, regex: RegExp, limit = Infinity): TextRange[] {
  const matches: TextRange[] = []
  eachMatch(text, regex, limit, (start, end) => matches.push({ start, end }))
  return matches
}

/** How many non-empty matches `text` holds, up to `limit`. */
export function countMatches(text: string, regex: RegExp, limit = Infinity): number {
  let count = 0
  eachMatch(text, regex, limit, () => count++)
  return count
}
