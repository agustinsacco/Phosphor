import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  classifySpec,
  gitDirFromSpec,
  listPackages,
  npmNameFromSpec,
  resolveInstallPath,
} from './packages'

describe('classifySpec', () => {
  it('classifies npm, git, and path specs', () => {
    expect(classifySpec('npm:pi-mcp-adapter')).toBe('npm')
    expect(classifySpec('npm:@saccolabs/pi-claude-cli@0.4.0')).toBe('npm')
    expect(classifySpec('git:github.com/user/repo@v1')).toBe('git')
    expect(classifySpec('https://github.com/user/repo')).toBe('git')
    expect(classifySpec('ssh://git@github.com/user/repo')).toBe('git')
    expect(classifySpec('/abs/path/pkg')).toBe('path')
    expect(classifySpec('../relative/pkg')).toBe('path')
  })
})

describe('npmNameFromSpec', () => {
  it('strips the prefix and version, keeping scopes intact', () => {
    expect(npmNameFromSpec('npm:pi-mcp-adapter')).toBe('pi-mcp-adapter')
    expect(npmNameFromSpec('npm:pi-mcp-adapter@1.2.3')).toBe('pi-mcp-adapter')
    expect(npmNameFromSpec('npm:@saccolabs/pi-claude-cli')).toBe('@saccolabs/pi-claude-cli')
    expect(npmNameFromSpec('npm:@saccolabs/pi-claude-cli@0.4.0')).toBe('@saccolabs/pi-claude-cli')
  })
})

describe('gitDirFromSpec', () => {
  it('normalizes the spec forms pi accepts to host/path', () => {
    expect(gitDirFromSpec('git:github.com/user/repo@v1')).toBe('github.com/user/repo')
    expect(gitDirFromSpec('git:git@github.com:user/repo')).toBe('github.com/user/repo')
    expect(gitDirFromSpec('https://github.com/user/repo.git')).toBe('github.com/user/repo')
    expect(gitDirFromSpec('ssh://git@github.com/user/repo@abc123')).toBe('github.com/user/repo')
  })
})

describe('resolveInstallPath', () => {
  const dirs = { settingsDir: '/home/u/.pi/agent', scope: 'global' as const }

  it('maps npm specs into the shared npm prefix', () => {
    expect(resolveInstallPath('npm:@saccolabs/pi-claude-cli@0.4.0', 'npm', dirs)).toBe(
      '/home/u/.pi/agent/npm/node_modules/@saccolabs/pi-claude-cli',
    )
  })

  it('maps git specs into the git clone layout', () => {
    expect(resolveInstallPath('git:github.com/user/repo@v1', 'git', dirs)).toBe(
      '/home/u/.pi/agent/git/github.com/user/repo',
    )
  })

  it('resolves relative paths against the settings directory', () => {
    // pi stores home-adjacent local packages as ../../../<name> relative to
    // ~/.pi/agent (verified against pi 0.84.2).
    expect(resolveInstallPath('../../../pkg', 'path', dirs)).toBe('/home/pkg')
    expect(resolveInstallPath('/abs/pkg', 'path', dirs)).toBe('/abs/pkg')
  })
})

describe('listPackages', () => {
  let home: string
  let workspace: string
  const originalPiDir = process.env.PI_CODING_AGENT_DIR

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'phosphor-packages-'))
    workspace = join(home, 'ws')
    mkdirSync(join(home, 'agent'), { recursive: true })
    mkdirSync(join(workspace, '.pi'), { recursive: true })
    process.env.PI_CODING_AGENT_DIR = join(home, 'agent')
  })

  afterEach(() => {
    if (originalPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = originalPiDir
    rmSync(home, { recursive: true, force: true })
  })

  const writeSettings = (dir: string, packages: unknown): void => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ packages }))
  }

  it('returns entries from both scopes with installed-state resolution', async () => {
    // Installed npm package with a pi manifest.
    const installDir = join(home, 'agent', 'npm', 'node_modules', 'demo-pkg')
    mkdirSync(installDir, { recursive: true })
    writeFileSync(
      join(installDir, 'package.json'),
      JSON.stringify({
        name: 'demo-pkg',
        version: '1.0.0',
        description: 'A demo',
        pi: { extensions: ['index.ts'], skills: ['skills/*.md', '!skills/wip.md'] },
      }),
    )
    writeFileSync(join(installDir, 'index.ts'), '')
    mkdirSync(join(installDir, 'skills'))
    writeFileSync(join(installDir, 'skills', 'ready.md'), '')
    writeFileSync(join(installDir, 'skills', 'wip.md'), '')
    writeSettings(join(home, 'agent'), ['npm:demo-pkg', 'npm:not-installed'])
    writeSettings(join(workspace, '.pi'), [{ source: 'npm:demo-proj', extensions: [] }])

    const entries = await listPackages(workspace)
    expect(entries).toHaveLength(3)

    const demo = entries.find((e) => e.spec === 'npm:demo-pkg')!
    expect(demo.scope).toBe('global')
    expect(demo.installed).toBe(true)
    expect(demo.version).toBe('1.0.0')
    expect(demo.resources.extensions).toEqual(['index.ts'])
    // Globs expand to what they match; exclusions drop their matches.
    expect(demo.resources.skills).toEqual(['ready'])

    const missing = entries.find((e) => e.spec === 'npm:not-installed')!
    expect(missing.installed).toBe(false)
    expect(missing.name).toBe('not-installed')

    const proj = entries.find((e) => e.spec === 'npm:demo-proj')!
    expect(proj.scope).toBe('project')
    expect(proj.filtered).toBe(true)
  })

  it('discovers convention directories when there is no pi manifest', async () => {
    const installDir = join(home, 'agent', 'npm', 'node_modules', 'conv-pkg')
    mkdirSync(join(installDir, 'extensions'), { recursive: true })
    mkdirSync(join(installDir, 'skills', 'my-skill'), { recursive: true })
    writeFileSync(join(installDir, 'package.json'), JSON.stringify({ name: 'conv-pkg' }))
    writeFileSync(join(installDir, 'extensions', 'main.ts'), '')
    writeFileSync(join(installDir, 'extensions', 'notes.txt'), '')
    writeFileSync(join(installDir, 'skills', 'my-skill', 'SKILL.md'), '')
    writeSettings(join(home, 'agent'), ['npm:conv-pkg'])

    const [entry] = await listPackages()
    expect(entry!.resources.extensions).toEqual(['main.ts'])
    expect(entry!.resources.skills).toEqual(['my-skill'])
  })

  it('handles missing and malformed settings files', async () => {
    await expect(listPackages()).resolves.toEqual([])
    writeFileSync(join(home, 'agent', 'settings.json'), '{not json')
    await expect(listPackages()).resolves.toEqual([])
  })

  it('resolves relative path specs against the settings dir', async () => {
    const pkgDir = join(home, 'local-pkg')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'local-pkg' }))
    writeSettings(join(home, 'agent'), ['../local-pkg'])

    const [entry] = await listPackages()
    expect(entry!.kind).toBe('path')
    expect(entry!.installed).toBe(true)
    expect(entry!.installPath).toBe(pkgDir)
  })
})
