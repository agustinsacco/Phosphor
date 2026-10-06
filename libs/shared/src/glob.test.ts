import { describe, expect, it } from 'vitest'
import { compileGlobs } from './glob'

function matcher(input: string): (path: string) => boolean {
  const compiled = compileGlobs(input)
  if (compiled.status !== 'ready') throw new Error(`not ready: ${input}`)
  return compiled.test
}

describe('compileGlobs', () => {
  it('matches a pattern without a leading slash at any depth', () => {
    const test = matcher('*.ts')
    expect(test('a.ts')).toBe(true)
    expect(test('src/deep/a.ts')).toBe(true)
    expect(test('a.tsx')).toBe(false)
    expect(test('a.ts.map')).toBe(false)
  })

  it('anchors a leading / or ./ at the workspace root', () => {
    for (const input of ['/src', './src']) {
      const test = matcher(input)
      expect(test('src/app.ts')).toBe(true)
      expect(test('lib/src/app.ts')).toBe(false)
    }
  })

  it('matches everything inside a named folder', () => {
    const test = matcher('node_modules')
    expect(test('node_modules/react/index.js')).toBe(true)
    expect(test('packages/a/node_modules/b.js')).toBe(true)
    expect(test('node_modules_old/x.js')).toBe(false)
    expect(matcher('dist/')('dist/main.js')).toBe(true)
  })

  it('keeps * and ? inside one segment, and lets ** span several', () => {
    expect(matcher('/src/*.ts')('src/a.ts')).toBe(true)
    expect(matcher('/src/*.ts')('src/x/a.ts')).toBe(false)
    const deep = matcher('src/**/*.test.ts')
    expect(deep('src/a.test.ts')).toBe(true)
    expect(deep('src/x/y/a.test.ts')).toBe(true)
    expect(deep('src/a.ts')).toBe(false)
    expect(matcher('a?c')('abc')).toBe(true)
    expect(matcher('a?c')('a/c')).toBe(false)
    expect(matcher('/src/**')('src/x/y.ts')).toBe(true)
    expect(matcher('**')('anything/at/all')).toBe(true)
    expect(matcher('src/**/**/*.ts')('src/a/b/c.ts')).toBe(true)
  })

  it('reads braces and character classes', () => {
    const either = matcher('{src,lib}/*.ts')
    expect(either('src/a.ts')).toBe(true)
    expect(either('lib/a.ts')).toBe(true)
    expect(either('app/a.ts')).toBe(false)
    expect(matcher('[ab].ts')('b.ts')).toBe(true)
    expect(matcher('[ab].ts')('c.ts')).toBe(false)
    expect(matcher('[!ab].ts')('c.ts')).toBe(true)
    expect(matcher('[!ab].ts')('a.ts')).toBe(false)
  })

  it('never lets a class match the separator', () => {
    expect(matcher('a[/]b')('a/b')).toBe(false)
    expect(matcher('a[!x]b')('a/b')).toBe(false)
    expect(matcher('[.-0]')('/')).toBe(false)
    expect(matcher('[a^]')('^')).toBe(true)
  })

  it('keeps a comma inside a class or braces in its pattern', () => {
    const test = matcher('[a,b].ts, {x,y}.md')
    expect(test('a.ts')).toBe(true)
    expect(test(',.ts')).toBe(true)
    expect(test('y.md')).toBe(true)
    expect(test('c.ts')).toBe(false)
  })

  it('splits on the commas after an unclosed [', () => {
    const test = matcher('[.ts, *.md')
    expect(test('[.ts')).toBe(true)
    expect(test('README.md')).toBe(true)
  })

  it('takes a comma-separated list, and ignores case', () => {
    const test = matcher('*.md, *.json ,')
    expect(test('README.md')).toBe(true)
    expect(test('package.json')).toBe(true)
    expect(test('index.ts')).toBe(false)
    expect(matcher('*.TS')('a.ts')).toBe(true)
  })

  it('treats literal characters literally', () => {
    expect(matcher('a+b.(x)')('a+b.(x)')).toBe(true)
    expect(matcher('a+b.(x)')('aab.(x)')).toBe(false)
    expect(matcher('[.ts')('[.ts')).toBe(true)
  })

  it('reports empty input and patterns that do not compile', () => {
    expect(compileGlobs('').status).toBe('empty')
    expect(compileGlobs(' , ').status).toBe('empty')
    expect(compileGlobs('{src').status).toBe('invalid')
    expect(compileGlobs('[z-a].ts')).toEqual({
      status: 'invalid',
      error: 'Range out of order in character class',
    })
  })
})
