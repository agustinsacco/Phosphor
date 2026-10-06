import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { siteDeployDecision } from './site-deploy-policy.mjs'

const sha = 'a'.repeat(40)
const repository = 'owner/Phosphor'
const context = {
  eventName: 'push',
  event: { repository: { full_name: repository }, ref: 'refs/heads/main', after: sha },
  repository,
  ref: 'refs/heads/main',
  sha,
  checkedOutSha: sha,
  mainSha: sha,
  hold: '',
  message: 'feat: update site',
}
const workflow = { id: 42, name: 'CI', path: '.github/workflows/ci.yml' }
const run = {
  workflow_id: workflow.id,
  name: workflow.name,
  path: workflow.path,
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  event: 'push',
  head_branch: 'main',
  head_sha: sha,
  status: 'completed',
  conclusion: 'success',
  run_number: 10,
  run_attempt: 1,
}
const runs = { workflow_runs: [run] }

function decision(overrides = {}, runOverrides = {}) {
  return siteDeployDecision({ ...context, ...overrides }, workflow, {
    workflow_runs: [{ ...run, ...runOverrides }],
  }).state
}

describe('site-deploy-policy', () => {
  it('admits only a successful CI push on the exact current main checkout', () => {
    expect(decision()).toBe('deploy')
  })

  it.each(['pull_request', 'workflow_run', 'merge_group'])('rejects %s events', (eventName) => {
    expect(decision({ eventName })).toBe('error')
  })

  it.each(['refs/heads/feature', 'refs/tags/v1', 'refs/pull/1/merge'])('rejects ref %s', (ref) => {
    expect(decision({ ref })).toBe('error')
  })

  it.each(['sha', 'checkedOutSha', 'mainSha'])('rejects a mismatched %s', (key) => {
    expect(decision({ [key]: 'b'.repeat(40) })).toBe('error')
  })

  it('rejects mismatched push identity and repository', () => {
    for (const event of [
      { ...context.event, after: 'b'.repeat(40) },
      { ...context.event, ref: 'refs/heads/feature' },
      { ...context.event, repository: { full_name: 'fork/Phosphor' } },
    ])
      expect(decision({ event })).toBe('error')
  })

  it.each(['true', '1', 'FALSE', ' false ', 'migration'])('honors fail-closed hold %s', (hold) => {
    expect(decision({ hold })).toBe('skip')
  })

  it.each(['', 'false'])('permits hold %j', (hold) => {
    expect(decision({ hold })).toBe('deploy')
  })

  it.each(['true', 'YES', '1'])('honors actual Skip-Release trailer %s', (value) => {
    expect(decision({ message: `chore: migrate\n\nSkip-Release: ${value}` })).toBe('skip')
  })

  it.each([
    'docs: explain Skip-Release: true',
    'docs: explain hold\n\nUse `Skip-Release: true` to hold deployment.',
    'docs: example\n\n    Skip-Release: true',
    'feat: ship\n\nSkip-Release: false',
  ])('does not treat prose or negative trailers as a hold: %s', (message) => {
    expect(decision({ message })).toBe('deploy')
  })

  it('requires explicit manual confirmation and main, without bypassing CI or holds', () => {
    const manual = {
      eventName: 'workflow_dispatch',
      event: { repository: context.event.repository, inputs: { confirm: 'true' } },
    }
    expect(decision(manual)).toBe('deploy')
    expect(decision({ ...manual, event: { ...manual.event, inputs: {} } })).toBe('error')
    expect(decision({ ...manual, event: { ...manual.event, inputs: { confirm: 'false' } } })).toBe(
      'error',
    )
    expect(decision({ ...manual, ref: 'refs/heads/feature' })).toBe('error')
    expect(decision(manual, { conclusion: 'failure' })).toBe('error')
    expect(decision({ ...manual, hold: 'true' })).toBe('skip')
    expect(decision({ ...manual, message: 'chore: hold\n\nSkip-Release: true' })).toBe('skip')
  })

  it('waits for absent and pending CI, rather than treating absence as success', () => {
    expect(siteDeployDecision(context).state).toBe('wait')
    expect(siteDeployDecision(context, workflow, { workflow_runs: [] }).state).toBe('wait')
    expect(decision({}, { status: 'queued', conclusion: null })).toBe('wait')
    expect(decision({}, { status: 'in_progress', conclusion: null })).toBe('wait')
  })

  it.each(['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', null])(
    'rejects completed CI %s',
    (conclusion) => {
      expect(decision({}, { conclusion })).toBe('error')
    },
  )

  it('ignores green runs with a different workflow, repo, branch, event or SHA', () => {
    for (const mismatch of [
      { workflow_id: 43 },
      { name: 'Other' },
      { path: '.github/workflows/other.yml' },
      { repository: { full_name: 'fork/Phosphor' } },
      { head_repository: { full_name: 'fork/Phosphor' } },
      { head_branch: 'feature' },
      { event: 'pull_request' },
      { head_sha: 'b'.repeat(40) },
    ])
      expect(decision({}, mismatch)).toBe('wait')
  })

  it('fails closed for unverifiable API responses', () => {
    expect(siteDeployDecision(context, { ...workflow, id: undefined }, runs).state).toBe('error')
    expect(siteDeployDecision(context, { ...workflow, path: 'other.yml' }, runs).state).toBe(
      'error',
    )
    expect(siteDeployDecision(context, workflow, {}).state).toBe('error')
  })

  it('does not let an earlier green run hide the newest pending or failed rerun', () => {
    for (const latest of [
      { ...run, run_attempt: 2, conclusion: 'failure' },
      { ...run, run_number: 11, status: 'queued' },
    ])
      expect(
        siteDeployDecision(context, workflow, { workflow_runs: [run, latest] }).state,
      ).not.toBe('deploy')
  })

  it('preserves GitHub push-range relevance when only an earlier pushed commit changed site', () => {
    const event = {
      ...context.event,
      before: 'b'.repeat(40),
      commits: [
        { id: 'c'.repeat(40), modified: ['site/src/pages/index.astro'] },
        { id: sha, modified: ['docs/overview.md'] },
      ],
    }
    expect(decision({ event })).toBe('deploy')
  })
})

describe('deploy-site workflow trust and path wiring', () => {
  const source = readFileSync(
    new URL('../.github/workflows/deploy-site.yml', import.meta.url),
    'utf8',
  )

  it('retains path-filtered main pushes, not PR CI completion triggers', () => {
    expect(source).toContain('branches: [main]')
    for (const path of ['site/**', '.infra/phosphor-site/**', '.github/workflows/deploy-site.yml'])
      expect(source).toContain(`- '${path}'`)
    expect(source).not.toMatch(/^ {2}(workflow_run|pull_request|pull_request_target):/m)
    expect(source).not.toContain('git diff')
  })

  it('isolates rejected manual requests from production concurrency', () => {
    expect(source).toContain("github.ref == 'refs/heads/main' && inputs.confirm == true")
    expect(source).toContain("&& 'production' || github.run_id")
    expect(source).toContain('default: false')
  })

  it('gates secrets and builds on the exact approved SHA and rechecks stale main', () => {
    expect(source).toContain("if: needs.guard.outputs.should_deploy == 'true'")
    expect(source).toContain('ref: ${{ needs.guard.outputs.sha }}')
    expect(source).toContain('${{ env.IMAGE_NAME }}:${{ needs.guard.outputs.sha }}')
    expect(source.match(/Recheck current main before/g)).toHaveLength(2)
    expect(source).toContain('sleep 15')
    expect(source).toContain('seq 1 40')
    expect(source).toContain('exit 1')
  })
})
