import { describe, expect, it } from 'vitest'
import {
  compileQuery,
  countMatches,
  DEFAULT_SEARCH_OPTIONS,
  findMatches,
  regexErrorText,
  type SearchQuery,
} from './text-search'

function query(text: string, options: Partial<SearchQuery> = {}): SearchQuery {
  return { ...DEFAULT_SEARCH_OPTIONS, text, ...options }
}

function regexFor(text: string, options: Partial<SearchQuery> = {}): RegExp {
  const compiled = compileQuery(query(text, options))
  if (compiled.status !== 'ready') throw new Error(`not ready: ${compiled.status}`)
  return compiled.regex
}

describe('compileQuery', () => {
  it('treats an empty query as empty, not as match-everything', () => {
    expect(compileQuery(query('')).status).toBe('empty')
  })

  it('matches literal text, regex syntax included', () => {
    const regex = regexFor('a.b(c)')
    expect(findMatches('a.b(c) axb(c)', regex)).toEqual([{ start: 0, end: 6 }])
  })

  it('is case-insensitive unless asked', () => {
    expect(countMatches('Foo foo FOO', regexFor('foo'))).toBe(3)
    expect(countMatches('Foo foo FOO', regexFor('foo', { caseSensitive: true }))).toBe(1)
  })

  it('whole word refuses matches glued to word characters', () => {
    const regex = regexFor('log', { wholeWord: true })
    expect(findMatches('log logger catalog log.', regex)).toEqual([
      { start: 0, end: 3 },
      { start: 19, end: 22 },
    ])
  })

  it('whole word still works when the query ends on punctuation', () => {
    const regex = regexFor('.then(', { wholeWord: true })
    expect(countMatches('p.then(x) p.thenable(', regex)).toBe(1)
  })

  it('whole word treats a regex query as one unit', () => {
    const regex = regexFor('\\.then\\(', { wholeWord: true, regex: true })
    expect(countMatches('p.then(x) p.thenable(', regex)).toBe(1)
    const either = regexFor('cat|dog', { wholeWord: true, regex: true })
    expect(countMatches('cat catalog hotdog dog', either)).toBe(2)
  })

  it('compiles a regex query and reports a broken one', () => {
    expect(countMatches('a1 b22 c', regexFor('\\d+', { regex: true }))).toBe(2)
    const broken = compileQuery(query('(unclosed', { regex: true }))
    expect(broken).toEqual({ status: 'invalid', error: 'Unterminated group' })
  })

  it('refuses a regex that is only valid once wrapped', () => {
    // `(?:a)|(?:b)` compiles; the query `a)|(?:b` alone does not.
    expect(compileQuery(query('a)|(?:b', { regex: true })).status).toBe('invalid')
    expect(compileQuery(query('a)|(?:b', { regex: true, wholeWord: true })).status).toBe('invalid')
  })

  it('anchors ^ and $ per line', () => {
    expect(countMatches('one\ntwo\none', regexFor('^one$', { regex: true }))).toBe(2)
  })
})

describe('findMatches', () => {
  it('skips empty matches instead of looping or counting them', () => {
    expect(findMatches('aaa', regexFor('x*', { regex: true }))).toEqual([])
    expect(findMatches('ab', regexFor('a*', { regex: true }))).toEqual([{ start: 0, end: 1 }])
  })

  it('stops at the limit', () => {
    expect(findMatches('a a a a', regexFor('a'), 2)).toHaveLength(2)
  })

  it('leaves a shared regex reusable', () => {
    const regex = regexFor('x')
    expect(countMatches('x x', regex)).toBe(2)
    expect(countMatches('x x', regex)).toBe(2)
  })
})

describe('regexErrorText', () => {
  it("drops the engine's prefix and the whole pattern", () => {
    let error: unknown
    const unterminated = 'a(b'
    try {
      new RegExp(unterminated, 'gim')
    } catch (caught) {
      error = caught
    }
    expect(regexErrorText(error)).toBe('Unterminated group')
    expect(regexErrorText('plain')).toBe('plain')
  })
})
