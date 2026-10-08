import { describe, expect, it } from 'vitest'
import { dedupeTitle, sanitizeTitle, titleArgs, titlePrompt } from './session-naming'

describe('titleArgs', () => {
  it('always strips tools, context files, skills and templates', () => {
    const args = titleArgs({ claudeCli: false })
    for (const flag of [
      '-p',
      '--no-session',
      '--no-tools',
      '--no-context-files',
      '--no-skills',
      '--no-prompt-templates',
    ]) {
      expect(args).toContain(flag)
    }
    expect(args).not.toContain('--model')
  })

  it('never disables extension discovery — providers register through it', () => {
    // `-ne` turns pi-claude-cli into an unknown provider and the whole
    // naming run errors. Verified against real pi; see titleArgs docs.
    for (const claudeCli of [true, false]) {
      expect(titleArgs({ claudeCli })).not.toContain('--no-extensions')
    }
  })

  it('pins the Claude provider run to Haiku with an explicit provider', () => {
    const args = titleArgs({ claudeCli: true })
    expect(args[args.indexOf('--provider') + 1]).toBe('pi-claude-cli')
    expect(args[args.indexOf('--model') + 1]).toBe('claude-haiku-4-5')
  })
})

describe('titlePrompt', () => {
  it('carries the message and the existing names', () => {
    const prompt = titlePrompt('fix the sidebar resize handle', ['Sidebar Polish', 'Auth Bug'])
    expect(prompt).toContain('fix the sidebar resize handle')
    expect(prompt).toContain('- Sidebar Polish')
    expect(prompt).toContain('- Auth Bug')
  })

  it('omits the existing-names section when there are none', () => {
    expect(titlePrompt('hello', [])).not.toContain('Existing session names')
    expect(titlePrompt('hello', ['  '])).not.toContain('Existing session names')
  })

  it('caps a pathological first message', () => {
    const prompt = titlePrompt('x'.repeat(50_000), [])
    expect(prompt.length).toBeLessThan(2500)
  })
})

describe('sanitizeTitle', () => {
  it('takes the last non-empty line and strips wrapping', () => {
    expect(sanitizeTitle('Here is the name:\n\n"Sidebar Resize Fix."\n')).toBe('Sidebar Resize Fix')
  })

  it('passes a clean single line through', () => {
    expect(sanitizeTitle('Composer Autogrow Bug')).toBe('Composer Autogrow Bug')
  })

  it('collapses internal whitespace and caps length', () => {
    expect(sanitizeTitle('A   Very\tSpaced   Name')).toBe('A Very Spaced Name')
    expect(sanitizeTitle('B'.repeat(200))!.length).toBeLessThanOrEqual(60)
  })

  it('returns null for empty or quote-only output', () => {
    expect(sanitizeTitle('')).toBeNull()
    expect(sanitizeTitle('\n  \n')).toBeNull()
    expect(sanitizeTitle('""')).toBeNull()
  })
})

describe('dedupeTitle', () => {
  it('returns the title untouched when free', () => {
    expect(dedupeTitle('Sidebar Fix', ['Auth Bug'])).toBe('Sidebar Fix')
  })

  it('suffixes on a case-insensitive collision', () => {
    expect(dedupeTitle('Sidebar Fix', ['sidebar fix'])).toBe('Sidebar Fix 2')
    expect(dedupeTitle('Sidebar Fix', ['Sidebar Fix', 'Sidebar Fix 2'])).toBe('Sidebar Fix 3')
  })
})

describe('configurable naming length', () => {
  it('asks for the configured word range', () => {
    expect(titlePrompt('do a thing', [], { min: 3, max: 8 })).toContain('3-8 words')
  })

  it('says "1 word" rather than "1-1 words" when the range collapses', () => {
    expect(titlePrompt('do a thing', [], { min: 1, max: 1 })).toContain('1 word ')
    expect(titlePrompt('do a thing', [], { min: 1, max: 1 })).not.toContain('1-1')
  })

  it('defaults to 2-5 words when no range is passed', () => {
    expect(titlePrompt('do a thing', [])).toContain('2-5 words')
  })

  it('caps the title at the configured length', () => {
    expect(sanitizeTitle('A'.repeat(200), 20)).toHaveLength(20)
  })

  it('never produces an empty title from a zero cap', () => {
    expect(sanitizeTitle('Something', 0)).toBe('S')
  })
})
