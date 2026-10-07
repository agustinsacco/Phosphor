import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'

const workflow = readFileSync(resolve('.github/workflows/release-continuous.yml'), 'utf8')
const lines = workflow.split('\n')
const start = lines.findIndex((line) => line === '        run: |') + 1
const body: string[] = []
for (const line of lines.slice(start)) {
  if (line && !line.startsWith('          ')) break
  body.push(line.slice(10))
}
const parser = readFileSync(resolve(import.meta.dirname, 'should-skip-release.sh'), 'utf8')
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()

it.each([
  { location: 'scripts', skip: true, error: false, expected: 0, publish: false },
  { location: 'tools/scripts', skip: true, error: false, expected: 0, publish: false },
  { location: 'tools/scripts', skip: false, error: false, expected: 0, publish: true },
  { location: '', skip: true, error: false, expected: 1, publish: false },
  { location: 'tools/scripts', skip: true, error: true, expected: 7, publish: false },
])('release decision fails closed across checkout layouts: %j', (fixture) => {
  const dir = mkdtempSync(join(tmpdir(), 'release-guard-'))
  try {
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const git = join(bin, 'git')
    writeFileSync(
      git,
      `#!/bin/sh\ncase "$1" in\nrev-list) echo 123;;\nls-remote) exit 2;;\n*) exec ${JSON.stringify(realGit)} "$@";;\nesac\n`,
    )
    chmodSync(git, 0o755)
    if (fixture.location) {
      const path = join(dir, fixture.location, 'should-skip-release.sh')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, fixture.error ? '#!/bin/sh\nexit 7\n' : parser)
    }
    const output = join(dir, 'output')
    const result = spawnSync('bash', ['-c', body.join('\n')], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_OUTPUT: output,
        HEAD_MESSAGE: fixture.skip ? 'Change\n\nSkip-Release: true' : 'Change',
      },
    })
    expect(result.status).toBe(fixture.expected)
    const recorded = readFileSync(output, 'utf8')
    expect(recorded.includes('should_release=true')).toBe(fixture.publish)
    if (!fixture.publish && fixture.expected === 0)
      expect(recorded).toContain('should_release=false')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('only eligible releases share concurrency or enter the release guard', () => {
  const eligible = `github.event_name == 'workflow_dispatch' ||
    (github.event.workflow_run.conclusion == 'success' &&
     github.event.workflow_run.event == 'push' &&
     github.event.workflow_run.head_branch == 'main' &&
     github.event.workflow_run.head_repository.full_name == github.repository)`
  const compact = (value: string) => value.replace(/\s/g, '')
  const guard = workflow.match(/    if: >\n([\s\S]*?)    outputs:/)?.[1] ?? ''
  const group = workflow.match(/  group: release-\$\{\{ (.*?) \}\}/)?.[1] ?? ''
  expect(compact(guard)).toBe(compact(eligible))
  expect(compact(group)).toBe(compact(`(${eligible}) && 'main' || github.run_id`))
})
