import { describe, expect, it } from 'vitest'
import { hydrateFromMessages } from './reducer'
import type { AgentMessage } from '@shared/rpc'
import { agentHistory, delegatedTurnEnded, noticeRunId } from './agentHistory'
import { parseFleetWidget } from './subagentRuns'

/**
 * Shapes captured from session 01a10e05 (pi-subagents 0.74.0), cut down: a
 * background workflow whose worker asks a question and finishes, a resumed
 * run, and a foreground reviewer.
 */
const W = '76406f96-94a6-46dd-8d93-9ff2f0fbb239'
const CHILD = 'fd71fece-0942-4038-abea-2ce920af565b'
const REVIVED = 'b439ac84-f075-4f6e-a652-527fe8c93af2'

const call = (id: string, args: Record<string, unknown>): AgentMessage =>
  ({
    role: 'assistant',
    content: [{ type: 'toolCall', id, name: 'subagent', arguments: args }],
    stopReason: 'toolUse',
  }) as AgentMessage
const result = (id: string, details: unknown, isError = false): AgentMessage =>
  ({
    role: 'toolResult',
    toolCallId: id,
    toolName: 'subagent',
    content: [{ type: 'text', text: 'ok' }],
    details,
    isError,
  }) as AgentMessage
const custom = (customType: string, content: string, details?: unknown, display = true) =>
  ({ role: 'custom', customType, content, display, details }) as AgentMessage
const reply = (text: string): AgentMessage =>
  ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' }) as AgentMessage

const TRANSCRIPT: AgentMessage[] = [
  { role: 'user', content: 'finish the nx stages' } as AgentMessage,
  call('c1', { workflow: '/tmp/finish-nx.js', async: true }),
  result('c1', { asyncId: W, runId: W, mode: 'workflow', results: [] }),
  custom('subagent_supervisor_request', 'Subagent needs a supervisor decision.', {
    requestId: 'q1',
    runId: CHILD,
    agent: 'worker',
    requestBody: 'May I?',
  }),
  custom(
    'subagent-incremental-child-notify',
    `Workflow child completed: **cache-contract**\nWorkflow run: ${W}\nChild run: ${CHILD}`,
    undefined,
    false,
  ),
  custom(
    'subagent-notify',
    `Background task completed: **workflow**\nWorkflow receipt: /var/T/pi-subagents-uid-501/async-subagent-runs/${W}/workflow-receipt.json\n\nWorkflow completed with 2 child run(s).`,
    undefined,
    false,
  ),
  call('c2', { action: 'resume', id: 'a0adb356-0465-4e19-9c94-759e9c3000f1', message: 'go on' }),
  result('c2', { asyncId: REVIVED, runId: REVIVED, mode: 'single', results: [] }),
  call('c3', { agent: 'reviewer', task: 'Review the diff' }),
  result('c3', {
    mode: 'single',
    results: [{ index: 0, agent: 'reviewer', exitCode: 1, error: 'boom' }],
  }),
  call('c4', { action: 'status', id: W }),
  result('c4', { mode: 'management', results: [] }),
  reply('NX-06 is accepted. NX-07 is next.'),
]

describe('agentHistory', () => {
  const state = hydrateFromMessages(TRANSCRIPT)

  it('lists launches and resumes, not management calls', () => {
    const runs = agentHistory(state.items, state.tools)
    expect(runs.map((r) => [r.verb, r.label, r.async, r.runId])).toEqual([
      ['Launched', 'workflow finish-nx.js', true, W],
      ['Resumed', 'a0adb356-0465-4e19-9c94-759e9c3000f1', true, REVIVED],
      ['Launched', 'reviewer', false, undefined],
    ])
  })

  it('settles a background run from its notice and links its children and questions', () => {
    const [workflow, resumed, reviewer] = agentHistory(state.items, state.tools)
    expect(workflow).toMatchObject({
      status: 'completed',
      outcome: 'workflow finished in the background',
      children: [{ runId: CHILD, label: 'cache-contract', status: 'completed' }],
      // Asked before the child's notice linked it to the workflow.
      questions: 1,
    })
    expect(resumed!.status).toBe('unknown')
    expect(reviewer!.status).toBe('failed')
  })

  it('lets the live snapshot mark a run as still working', () => {
    const fleet = parseFleetWidget([
      'PI_SUBAGENT_ASYNC_JSON:' +
        JSON.stringify({
          kind: 'pi-subagents.async-status-snapshot',
          version: 1,
          runs: [
            {
              id: REVIVED,
              kind: 'subagent',
              label: 'scout',
              state: 'running',
              children: [{ id: 'step:0', kind: 'step', label: 'scout', state: 'running' }],
            },
          ],
        }),
    ])
    const resumed = agentHistory(state.items, state.tools, fleet)[1]!
    expect(resumed.status).toBe('running')
    expect(resumed.children).toEqual([{ runId: 'step:0', label: 'scout', status: 'running' }])
  })
})

describe('noticeRunId', () => {
  it('prefers the async directory the notice names over any other id in it', () => {
    const text = `Background task completed: **scout**\nRevived from ${W}\nRetention-managed async directory: /var/T/async-subagent-runs/${REVIVED}`
    expect(noticeRunId(text, new Set())).toBe(REVIVED)
    expect(noticeRunId(`mentions ${W} only`, new Set([W]))).toBe(W)
    expect(noticeRunId('nothing here', new Set([W]))).toBeUndefined()
  })
})

describe('delegatedTurnEnded', () => {
  it('is true once a delegating turn has ended, and false after the user replies', () => {
    const ended = hydrateFromMessages(TRANSCRIPT)
    expect(delegatedTurnEnded(ended.items, ended.tools)).toBe(true)
    const replied = hydrateFromMessages([
      ...TRANSCRIPT,
      { role: 'user', content: 'go' } as AgentMessage,
    ])
    expect(delegatedTurnEnded(replied.items, replied.tools)).toBe(false)
  })

  it('ignores a turn that only checked on agents, or that never delegated', () => {
    const checked = hydrateFromMessages([
      { role: 'user', content: 'status?' } as AgentMessage,
      call('s1', { action: 'status', id: W }),
      result('s1', { mode: 'management' }),
      reply('Still running.'),
    ])
    expect(delegatedTurnEnded(checked.items, checked.tools)).toBe(false)
    const plain = hydrateFromMessages([
      { role: 'user', content: 'hi' } as AgentMessage,
      reply('Hello.'),
    ])
    expect(delegatedTurnEnded(plain.items, plain.tools)).toBe(false)
  })
})

describe('agentHistory, questions from a child still working', () => {
  const ask = (runId: string) =>
    custom('subagent_supervisor_request', 'Subagent needs a supervisor decision.', {
      requestId: `q-${runId}`,
      runId,
      agent: 'worker',
    })

  it('go to the only background run that is open', () => {
    const state = hydrateFromMessages([
      call('c1', { workflow: '/tmp/a.js', async: true }),
      result('c1', { asyncId: W, mode: 'workflow' }),
      ask(CHILD),
    ])
    expect(agentHistory(state.items, state.tools)[0]!.questions).toBe(1)
  })

  it('stay unattributed while two are open', () => {
    const state = hydrateFromMessages([
      call('c1', { workflow: '/tmp/a.js', async: true }),
      result('c1', { asyncId: W, mode: 'workflow' }),
      call('c2', { agent: 'scout', task: 'map', async: true }),
      result('c2', { asyncId: REVIVED, mode: 'single' }),
      ask(CHILD),
    ])
    expect(agentHistory(state.items, state.tools).map((r) => r.questions)).toEqual([0, 0])
  })
})
