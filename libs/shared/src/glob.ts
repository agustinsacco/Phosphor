import { escapeRegExp, regexErrorText } from './text-search'

/**
 * The workspace search's "files to include" / "files to exclude" fields:
 * comma-separated globs matched against workspace-relative, `/`-separated
 * paths, read the way VS Code reads them.
 *
 * - A pattern matches at any depth unless it starts with `/` or `./`, which
 *   anchor it at the workspace root: `*.ts` is `**` + `/*.ts`.
 * - A pattern that names a folder matches everything inside it: `src` covers
 *   `src/app.ts`, and so does `src/`.
 * - `*` and `?` stay inside one path segment, `**` spans any number of them,
 *   `{a,b}` is either, `[abc]` / `[!abc]` is one character in or out of a set.
 *
 * Matching ignores case: on the case-insensitive disks macOS and Windows use,
 * `*.TS` names the same files as `*.ts`.
 */

export type CompiledGlobs =
  | { status: 'empty' }
  | { status: 'invalid'; error: string }
  | { status: 'ready'; test: (path: string) => boolean }

/**
 * Split on the commas that separate patterns, not the ones inside `{a,b}` or
 * `[a,b]`. A `[` with no `]` after it is a literal, as `patternSource` reads it.
 */
function splitPatterns(input: string): string[] {
  const patterns: string[] = []
  let braces = 0
  let inClass = false
  let current = ''
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!
    if (char === '[' && !inClass) inClass = input.includes(']', i + 1)
    else if (char === ']') inClass = false
    else if (char === '{' && !inClass) braces++
    else if (char === '}' && !inClass && braces > 0) braces--
    if (char === ',' && braces === 0 && !inClass) {
      patterns.push(current)
      current = ''
    } else {
      current += char
    }
  }
  patterns.push(current)
  return patterns.map((pattern) => pattern.trim()).filter(Boolean)
}

/** A `[...]` class starting at `start`, as regex source, and where it ends; null when unclosed. */
function characterClass(glob: string, start: number): { source: string; end: number } | null {
  let body = start + 1
  const negated = glob[body] === '!' || glob[body] === '^'
  if (negated) body++
  const close = glob.indexOf(']', body)
  if (close === -1 || close === body) return null
  const members = glob.slice(body, close).replace(/\^/g, '\\^')
  // A class never matches the separator, negated or not: `[!a]` and `[.-0]`
  // are one character of a name, as `?` is.
  return { source: negated ? `[^/${members}]` : `(?!/)[${members}]`, end: close }
}

function patternSource(pattern: string): string {
  let glob = pattern.replace(/\\/g, '/')
  let anchored = false
  if (glob.startsWith('./')) {
    glob = glob.slice(2)
    anchored = true
  } else if (glob.startsWith('/')) {
    glob = glob.replace(/^\/+/, '')
    anchored = true
  }
  glob = glob
    // `src/` is the folder `src`, which the descendant suffix below covers.
    .replace(/\/+$/, '')
    .split('/')
    .map((segment) => (/^\*{2,}$/.test(segment) ? '**' : segment))
    // `a/**/**/b` is `a/**/b`; repeated groups only give the regex more ways
    // to backtrack.
    .filter((segment, index, all) => !(segment === '**' && all[index - 1] === '**'))
    .join('/')
  // `/` or `./` alone: the workspace root, so everything in it.
  if (glob === '') return '.*'

  let source = ''
  let braces = 0
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!
    if (char === '*') {
      const wholeSegment =
        glob[i + 1] === '*' &&
        (i === 0 || glob[i - 1] === '/') &&
        (i + 2 === glob.length || glob[i + 2] === '/')
      if (wholeSegment) {
        // `**` at the end is anything below; `**/` is any number of whole
        // segments, none included.
        source += i + 2 === glob.length ? '.*' : '(?:[^/]*/)*'
        i += 2
        continue
      }
      // Inside a segment, `**` is `*`.
      while (glob[i + 1] === '*') i++
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else if (char === '[') {
      const found = characterClass(glob, i)
      if (found) {
        source += found.source
        i = found.end
      } else {
        source += '\\['
      }
    } else if (char === '{') {
      braces++
      source += '(?:'
    } else if (char === '}' && braces > 0) {
      braces--
      source += ')'
    } else if (char === ',' && braces > 0) {
      source += '|'
    } else {
      source += escapeRegExp(char)
    }
  }
  if (braces > 0) throw new Error(`Unclosed "{" in ${pattern}`)
  const lead =
    anchored || source.startsWith('(?:[^/]*/)*') || source.startsWith('.*') ? '' : '(?:[^/]*/)*'
  return `${lead}${source}(?:/.*)?`
}

/** Compile a comma-separated glob list into one path test. */
export function compileGlobs(input: string): CompiledGlobs {
  const patterns = splitPatterns(input)
  if (patterns.length === 0) return { status: 'empty' }
  try {
    const regex = new RegExp(`^(?:${patterns.map(patternSource).join('|')})$`, 'i')
    return { status: 'ready', test: (path) => regex.test(path) }
  } catch (error) {
    return { status: 'invalid', error: regexErrorText(error) }
  }
}
