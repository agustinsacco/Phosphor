import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeMachine, type FakeMachine } from '../__fixtures__/machine'
import { checkRepositories, confineToRoots, isInsideRoot } from './repositories'

let machine: FakeMachine
afterEach(() => machine?.cleanup())

const environment = { env: { PATH: '/usr/bin:/bin' }, secrets: [] }

describe('confinement', () => {
  it('compares whole path segments', () => {
    expect(isInsideRoot('/repo', '/repo')).toBe(true)
    expect(isInsideRoot('/repo/src', '/repo')).toBe(true)
    expect(isInsideRoot('/repo2', '/repo')).toBe(false)
    expect(isInsideRoot('/rep', '/repo')).toBe(false)
    expect(isInsideRoot('/anything', '/')).toBe(true)
  })

  it('resolves before comparing, so .., symlink escapes and missing paths all fail', async () => {
    machine = fakeMachine()
    const root = machine.repository
    const outside = join(machine.dir, 'outside')
    mkdirSync(outside)
    mkdirSync(join(root, 'src'))
    symlinkSync(outside, join(root, 'escape'))
    symlinkSync(join(root, 'src'), join(machine.dir, 'inward'))
    const roots = [root]
    expect(await confineToRoots(root, roots)).toBe(root)
    expect(await confineToRoots(join(root, 'src'), roots)).toBe(join(root, 'src'))
    expect(await confineToRoots(join(machine.dir, 'inward'), roots)).toBe(join(root, 'src'))
    expect(await confineToRoots(join(root, 'escape'), roots)).toBeNull()
    expect(await confineToRoots(join(root, '../outside'), roots)).toBeNull()
    expect(await confineToRoots(`${root}2`, roots)).toBeNull()
    expect(await confineToRoots(join(root, 'missing'), roots)).toBeNull()
    expect(await confineToRoots('repo/src', roots)).toBeNull()
  })
})

describe('configured repositories', () => {
  it('resolves each root once, and says whether it is a git repository', async () => {
    machine = fakeMachine()
    const plain = join(machine.dir, 'plain')
    mkdirSync(plain)
    symlinkSync(machine.repository, join(machine.dir, 'alias'))
    const result = await checkRepositories(
      [machine.repository, join(machine.dir, 'alias'), plain],
      { home: machine.home, git: '/usr/bin/git', environment },
    )
    expect(result.roots).toEqual([machine.repository, plain])
    expect(result.checks).toEqual([
      { id: 'repository', status: 'pass', summary: `${machine.repository}, a git repository` },
      {
        id: 'repository',
        status: 'info',
        summary: `${plain}, not a git repository: sessions may start in any folder inside it`,
      },
    ])
  })

  it('refuses a missing root, a file and a link to /', async () => {
    machine = fakeMachine()
    const file = join(machine.dir, 'file')
    writeFileSync(file, '')
    symlinkSync('/', join(machine.dir, 'root'))
    const result = await checkRepositories(
      [join(machine.dir, 'missing'), file, join(machine.dir, 'root')],
      { home: machine.home, git: null, environment },
    )
    expect(result.roots).toEqual([])
    expect(result.checks.map((check) => [check.status, check.summary])).toEqual([
      ['fail', `${join(machine.dir, 'missing')} does not exist`],
      ['fail', `${file} is not a folder`],
      ['fail', `${join(machine.dir, 'root')} resolves to /`],
    ])
  })

  it('warns about a root that holds the home folder', async () => {
    machine = fakeMachine()
    const result = await checkRepositories([machine.dir], {
      home: machine.home,
      git: null,
      environment,
    })
    expect(result.checks[0]).toMatchObject({ status: 'warn' })
    expect(result.checks[0]?.summary).toContain('very broad')
  })
})
