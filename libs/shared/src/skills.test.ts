import { describe, expect, it } from 'vitest'
import {
  composeSkillMd,
  isSkillDraft,
  parseSkillFrontmatter,
  setSkillDraftFlag,
  skillFrontmatterWarnings,
  validateSkillName,
} from './skills'

describe('validateSkillName', () => {
  it('accepts standard names', () => {
    expect(validateSkillName('pdf-processing')).toBeNull()
    expect(validateSkillName('a')).toBeNull()
    expect(validateSkillName('x1-y2-z3')).toBeNull()
  })

  it('rejects the standard-listed invalid shapes', () => {
    expect(validateSkillName('')).not.toBeNull()
    expect(validateSkillName('PDF-Processing')).not.toBeNull()
    expect(validateSkillName('-pdf')).not.toBeNull()
    expect(validateSkillName('pdf-')).not.toBeNull()
    expect(validateSkillName('pdf--processing')).not.toBeNull()
    expect(validateSkillName('a'.repeat(65))).not.toBeNull()
  })
})

describe('parseSkillFrontmatter', () => {
  it('parses key/value pairs and the body', () => {
    const { attrs, body } = parseSkillFrontmatter(
      '---\nname: demo\ndescription: Does things\n---\n\n# Demo\n',
    )
    expect(attrs['name']).toBe('demo')
    expect(attrs['description']).toBe('Does things')
    expect(body).toBe('\n# Demo\n')
  })

  it('folds indented continuation lines into the value', () => {
    const { attrs } = parseSkillFrontmatter(
      '---\ndescription: first part\n  second part\nname: demo\n---\nbody',
    )
    expect(attrs['description']).toBe('first part second part')
    expect(attrs['name']).toBe('demo')
  })

  it('drops YAML block markers (the anthropics/skills claude-api shape)', () => {
    const { attrs } = parseSkillFrontmatter('---\ndescription: |-\n  Reference for X\n---\n')
    expect(attrs['description']).toBe('Reference for X')
  })

  it('returns everything as body when there is no frontmatter', () => {
    const parsed = parseSkillFrontmatter('# just markdown\n')
    expect(parsed.raw).toBeNull()
    expect(parsed.body).toBe('# just markdown\n')
    expect(parsed.attrs).toEqual({})
  })
})

describe('setSkillDraftFlag', () => {
  const doc = '---\nname: demo\ndescription: d\n---\n\nbody\n'

  it('adds and removes disable-model-invocation without touching the body', () => {
    const drafted = setSkillDraftFlag(doc, true)
    expect(drafted).toContain('disable-model-invocation: true')
    expect(drafted.endsWith('\n\nbody\n')).toBe(true)
    expect(isSkillDraft(parseSkillFrontmatter(drafted).attrs)).toBe(true)

    const published = setSkillDraftFlag(drafted, false)
    expect(published).toBe(doc)
  })

  it('is a no-op without a frontmatter block', () => {
    expect(setSkillDraftFlag('# no frontmatter', true)).toBe('# no frontmatter')
  })
})

describe('composeSkillMd', () => {
  it('produces a parseable document, draft flag included', () => {
    const text = composeSkillMd({
      name: 'weekly-status',
      description: 'Reports\nweekly',
      content: '# Steps',
      draft: true,
    })
    const { attrs, body } = parseSkillFrontmatter(text)
    expect(attrs['name']).toBe('weekly-status')
    expect(attrs['description']).toBe('Reports weekly')
    expect(isSkillDraft(attrs)).toBe(true)
    expect(body.trim()).toBe('# Steps')
  })
})

describe('skillFrontmatterWarnings', () => {
  it('flags the three "why was my skill ignored" causes', () => {
    expect(skillFrontmatterWarnings({})).toHaveLength(2) // no name, no description
    expect(
      skillFrontmatterWarnings({ name: 'ok', description: 'x'.repeat(1025) }).join(' '),
    ).toContain('1024')
    expect(
      skillFrontmatterWarnings({ name: 'ok', description: 'd', 'allowed-tools': 'bash' }).join(' '),
    ).toContain('Pre-approves')
  })

  it('is empty for a compliant skill', () => {
    expect(skillFrontmatterWarnings({ name: 'ok-skill', description: 'Does a thing.' })).toEqual([])
  })
})
