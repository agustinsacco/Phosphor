import { describe, expect, it } from 'vitest'
import { compileQuery, DEFAULT_SEARCH_OPTIONS, type SearchQuery } from './text-search'
import {
  compileSearch,
  findLineMatches,
  linePreview,
  MAX_GLOBS_LENGTH,
  MAX_QUERY_LENGTH,
} from './workspace-search'

function query(text: string, options: Partial<SearchQuery> = {}): SearchQuery {
  return { ...DEFAULT_SEARCH_OPTIONS, text, ...options }
}

function regexFor(text: string, options: Partial<SearchQuery> = {}): RegExp {
  const compiled = compileQuery(query(text, options))
  if (compiled.status !== 'ready') throw new Error(`not ready: ${compiled.status}`)
  return compiled.regex
}

describe('compileSearch', () => {
  it('filters paths with the include and exclude globs', () => {
    const compiled = compileSearch({ query: query('x'), include: 'src', exclude: '*.test.ts' })
    if (compiled.status !== 'ready') throw new Error(compiled.status)
    expect(compiled.wants('src/a.ts')).toBe(true)
    expect(compiled.wants('src/a.test.ts')).toBe(false)
    expect(compiled.wants('docs/a.md')).toBe(false)
  })

  it('wants every path when neither glob is set', () => {
    const compiled = compileSearch({ query: query('x') })
    if (compiled.status !== 'ready') throw new Error(compiled.status)
    expect(compiled.wants('any/where.txt')).toBe(true)
  })

  it('reports a broken glob even while the query is empty', () => {
    expect(compileSearch({ query: query(''), include: '{src' }).status).toBe('invalid')
    expect(compileSearch({ query: query(''), exclude: '[z-a]' }).status).toBe('invalid')
    expect(compileSearch({ query: query('') }).status).toBe('empty')
  })

  it('reports a broken regex', () => {
    expect(compileSearch({ query: query('(', { regex: true }) })).toEqual({
      status: 'invalid',
      error: 'Unterminated group',
    })
  })

  it('refuses input past the length limits before compiling it', () => {
    const long = compileSearch({ query: query('x'.repeat(MAX_QUERY_LENGTH + 1)) })
    expect(long).toMatchObject({ status: 'invalid', error: expect.stringMatching(/^Longer than/) })
    const globs = compileSearch({ query: query('x'), exclude: 'a,'.repeat(MAX_GLOBS_LENGTH) })
    expect(globs.status).toBe('invalid')
  })
})

describe('findLineMatches', () => {
  it('locates matches by 1-based line and column', () => {
    const text = 'alpha\nbeta gamma\n\ngamma'
    expect(findLineMatches(text, regexFor('gamma'))).toEqual([
      {
        line: 2,
        column: 6,
        endLine: 2,
        endColumn: 11,
        preview: 'beta gamma',
        previewStart: 5,
        previewEnd: 10,
      },
      {
        line: 4,
        column: 1,
        endLine: 4,
        endColumn: 6,
        preview: 'gamma',
        previewStart: 0,
        previewEnd: 5,
      },
    ])
  })

  it('previews each match on a shared line against that line', () => {
    const matches = findLineMatches('a b a\nc a', regexFor('a'))
    expect(matches.map((m) => [m.line, m.column, m.preview])).toEqual([
      [1, 1, 'a b a'],
      [1, 5, 'a b a'],
      [2, 3, 'c a'],
    ])
  })

  it('spans lines for a multi-line regex, previewing only the first', () => {
    const [match] = findLineMatches('x\nfoo\nbar\n', regexFor('foo\\nba', { regex: true }))
    expect(match).toMatchObject({ line: 2, column: 1, endLine: 3, endColumn: 3, preview: 'foo' })
    expect(match!.previewEnd).toBe(3)
  })

  it('keeps line counting right across a multi-line match', () => {
    const matches = findLineMatches('a\nb\na\nb\nz', regexFor('a\\nb', { regex: true }))
    expect(matches.map((m) => m.line)).toEqual([1, 3])
  })

  it('stops at the limit', () => {
    expect(findLineMatches('x x x', regexFor('x'), 2)).toHaveLength(2)
  })
})

describe('linePreview', () => {
  it('returns short lines whole', () => {
    expect(linePreview('short line', 6, 10)).toEqual({ text: 'short line', start: 6, end: 10 })
  })

  it('cuts a long line down around the match', () => {
    const line = 'x'.repeat(1000) + 'NEEDLE' + 'y'.repeat(1000)
    const preview = linePreview(line, 1000, 1006)
    expect(preview.text.startsWith('…')).toBe(true)
    expect(preview.text.endsWith('…')).toBe(true)
    expect(preview.text.slice(preview.start, preview.end)).toBe('NEEDLE')
    expect(preview.text.length).toBeLessThan(260)
  })
})
