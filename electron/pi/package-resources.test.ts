import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { discoverResources, resolvePackagePaths } from './package-resources'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'phosphor-pkg-res-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function file(rel: string, content = ''): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), content)
}

const manifest = (pi: unknown): void => file('package.json', JSON.stringify({ name: 'demo', pi }))

describe('discoverResources', () => {
  it('expands manifest directories the way pi does (the pi-subagents shape)', () => {
    manifest({ extensions: ['./index.js'], skills: ['./skills'], prompts: ['./prompts'] })
    file('index.js')
    file('skills/council-mode/SKILL.md', '---\nname: council-mode\n---\n')
    file('skills/pi-subagents/SKILL.md', '---\nname: pi-subagents\n---\n')
    file('skills/pi-subagents/references/multi-lane.md')
    file('prompts/council.md')
    file('prompts/review-loop.md')
    file('prompts/notes.txt')

    expect(discoverResources(root)).toEqual({
      extensions: ['index.js'],
      skills: ['council-mode', 'pi-subagents'],
      prompts: ['council', 'review-loop'],
      themes: [],
    })
  })

  it('names a skill by its frontmatter, falling back to the directory', () => {
    manifest({ skills: ['./skills'] })
    file('skills/dir-name/SKILL.md', '---\nname: declared-name\n---\n')
    file('skills/bare/SKILL.md', '# no frontmatter')
    expect(discoverResources(root).skills).toEqual(['bare', 'declared-name'])
  })

  it('finds nested skill bundles but not a bundle’s own subfolders', () => {
    manifest({ skills: ['./skills'] })
    file('skills/group/inner/SKILL.md')
    file('skills/outer/SKILL.md')
    file('skills/outer/nested/SKILL.md')
    expect(discoverResources(root).skills).toEqual(['inner', 'outer'])
  })

  it('treats a manifest directory with an entry point as one extension', () => {
    manifest({ extensions: ['./dist'] })
    file('dist/index.js')
    file('dist/helper.js')
    expect(discoverResources(root).extensions).toEqual(['dist'])
  })

  it('matches globs and applies exclusions', () => {
    manifest({ prompts: ['./res/**/*.md', '!res/drafts/*.md'], themes: ['themes/*.json'] })
    file('res/a.md')
    file('res/deep/b.md')
    file('res/drafts/c.md')
    file('themes/night.json')
    const resources = discoverResources(root)
    expect(resources.prompts).toEqual(['a', 'b'])
    expect(resources.themes).toEqual(['night'])
  })

  it('declares nothing for a kind the manifest omits, even if the folder exists', () => {
    // pi-mcp-adapter ships skills/ but its manifest lists only extensions, so
    // pi never loads that skill; the listing must not claim it does.
    manifest({ extensions: ['./index.ts'] })
    file('index.ts')
    file('skills/mcp-scripting/SKILL.md')
    expect(discoverResources(root).skills).toEqual([])
  })

  it('reads convention directories without a manifest', () => {
    file('package.json', JSON.stringify({ name: 'conv' }))
    file('extensions/main.ts')
    file('extensions/notes.txt')
    file('extensions/folder/index.ts')
    file('skills/one/SKILL.md')
    file('skills/loose.md')
    file('themes/day.json')
    expect(discoverResources(root)).toEqual({
      extensions: ['folder', 'main.ts'],
      skills: ['loose', 'one'],
      prompts: [],
      themes: ['day'],
    })
  })

  it('ignores manifest paths that escape the package', () => {
    manifest({ skills: ['../outside'] })
    expect(resolvePackagePaths(root).skills).toEqual([])
  })

  it('treats a single-file package as one extension', () => {
    file('ext.ts')
    expect(discoverResources(join(root, 'ext.ts')).extensions).toEqual(['ext.ts'])
  })
})
