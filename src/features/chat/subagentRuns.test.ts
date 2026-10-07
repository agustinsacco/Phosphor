import { describe, expect, it } from 'vitest'
import {
  parseFleetWidget,
  parseSubagentNotice,
  parseSupervisorQuestion,
  scriptAgents,
  subagentCall,
  subagentRun,
  summarizeFleet,
  summarizeSubagentCall,
  supervisorAnswers,
} from './subagentRuns'

/**
 * The shapes are a wire contract with pi-subagents, so the fixtures are
 * captured payloads (session 01a0e90a, 2026-09-28, pi-subagents 0.73.1)
 * rather than values built from a type this repo does not have.
 */

/** What a running foreground run streams on `tool_execution_update`. */
const PARTIAL = {
  mode: 'single',
  results: [
    {
      index: 0,
      agent: 'reviewer',
      task: '[prompt redacted]',
      sessionName: 'reviewer: Review the auth diff for regressions',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
    },
  ],
  progress: [
    {
      index: 0,
      agent: 'reviewer',
      status: 'running',
      task: '[prompt redacted]',
      currentTool: 'read',
      currentToolArgs: 'src/auth.ts',
      recentTools: [
        { tool: 'read', args: 'SKILL.md', endMs: 1 },
        { tool: 'bash', args: 'git diff main', endMs: 2 },
      ],
      recentOutput: ['Looking at the error branch.'],
      toolCount: 3,
      turnCount: 2,
      tokens: 4200,
      durationMs: 9100,
      model: 'openai-codex/gpt-6-astra',
    },
  ],
}

/** The same run, settled. */
const FINAL = {
  mode: 'single',
  runId: 'cc0f172e-5ef7-401b-9b89-8653e3185b00',
  results: [
    {
      index: 0,
      agent: 'reviewer',
      task: '[prompt redacted]',
      sessionName: 'reviewer: Review the auth diff for regressions',
      exitCode: 0,
      usage: { input: 73153, output: 6845, cacheRead: 0, cacheWrite: 0, cost: 1.9, turns: 23 },
      model: 'openai-codex/gpt-6-astra',
      finalOutput: 'No actionable regressions.',
      sessionFile: '/Users/me/.pi/agent/sessions/x/0b48d48b-1.jsonl',
    },
  ],
  progress: [
    {
      index: 0,
      agent: 'reviewer',
      status: 'completed',
      task: '[prompt redacted]',
      recentTools: [],
      recentOutput: [],
      toolCount: 44,
      turnCount: 23,
      tokens: 79998,
      durationMs: 267277,
    },
  ],
}

describe('subagentCall', () => {
  it('reads a launch and a management action apart', () => {
    expect(subagentCall({ agent: 'reviewer', task: 'Review it', async: true })).toEqual({
      kind: 'launch',
      agent: 'reviewer',
      task: 'Review it',
      async: true,
      script: undefined,
      workflow: undefined,
    })
    expect(subagentCall({ action: 'status', id: 'cc0f172e-5ef7-401b-9b89-8653e3185b00' })).toEqual({
      kind: 'manage',
      action: 'status',
      target: 'cc0f172e-5ef7-401b-9b89-8653e3185b00',
      topic: undefined,
    })
  })

  it('names the agents a workflow script mentions, once each', () => {
    expect(
      scriptAgents(
        `const a = await runs.run("scout", { agent: "scout", task: "x" });
         await runs.all([{ key: "r1", agent: 'reviewer', task: "y" }, { key: "r2", agent: 'reviewer' }])`,
      ),
    ).toEqual(['scout', 'reviewer'])
  })
})

describe('subagentRun', () => {
  it('joins the streamed progress onto the child while it runs', () => {
    const run = subagentRun(PARTIAL, false)!
    expect(run.children).toHaveLength(1)
    expect(run.children[0]).toMatchObject({
      agent: 'reviewer',
      label: 'Review the auth diff for regressions',
      status: 'running',
      currentTool: 'read src/auth.ts',
      recentTools: ['read SKILL.md', 'bash git diff main'],
      recentOutput: ['Looking at the error branch.'],
      toolCount: 3,
      tokens: 4200,
      model: 'openai-codex/gpt-6-astra',
    })
    // A cost of zero is no cost, not a $0 line.
    expect(run.children[0]!.costUsd).toBeUndefined()
  })

  it('reads the verdict from the result once the tool settled', () => {
    const run = subagentRun(FINAL, true)!
    expect(run.runId).toBe('cc0f172e-5ef7-401b-9b89-8653e3185b00')
    expect(run.async).toBe(false)
    expect(run.children[0]).toMatchObject({
      status: 'completed',
      output: 'No actionable regressions.',
      toolCount: 44,
      tokens: 79998,
      costUsd: 1.9,
      durationMs: 267277,
      sessionFile: '/Users/me/.pi/agent/sessions/x/0b48d48b-1.jsonl',
    })
  })

  it('calls a non-zero exit a failure and a stop a stop', () => {
    const failed = { ...FINAL, results: [{ ...FINAL.results[0], exitCode: 1, error: 'boom' }] }
    expect(subagentRun(failed, true)!.children[0]!.status).toBe('failed')
    const stopped = { ...FINAL, results: [{ ...FINAL.results[0], stopped: true }] }
    expect(subagentRun(stopped, true)!.children[0]!.status).toBe('stopped')
  })

  it('recognises a detached launch, which has no children of its own', () => {
    const run = subagentRun(
      {
        mode: 'single',
        runId: 'cc0f172e-5ef7-401b-9b89-8653e3185b00',
        asyncId: 'cc0f172e-5ef7-401b-9b89-8653e3185b00',
        results: [],
        timeoutMs: 2700000,
      },
      true,
    )!
    expect(run.async).toBe(true)
    expect(run.children).toEqual([])
    expect(run.timeoutMs).toBe(2700000)
  })

  it('reads the agent catalogue from a list action', () => {
    const run = subagentRun(
      {
        mode: 'management',
        results: [],
        agentCapabilities: {
          agents: [
            { name: 'reviewer', description: 'Reviews', source: 'builtin', executable: true },
            {
              name: 'codex-exec',
              source: 'builtin',
              executable: true,
              runner: { available: false, unavailableReason: "'codex' was not found on PATH." },
              model: { value: 'inherit' },
            },
          ],
        },
      },
      true,
    )!
    expect(run.agents).toEqual([
      {
        name: 'reviewer',
        description: 'Reviews',
        source: 'builtin',
        model: undefined,
        available: true,
        unavailableReason: undefined,
      },
      {
        name: 'codex-exec',
        description: undefined,
        source: 'builtin',
        model: 'inherit',
        available: false,
        unavailableReason: "'codex' was not found on PATH.",
      },
    ])
  })

  it('returns null for details it cannot read', () => {
    expect(subagentRun(undefined, true)).toBeNull()
    expect(subagentRun('text', true)).toBeNull()
  })
})

describe('summarizeSubagentCall', () => {
  it('reads "Delegating to reviewer · read src/auth.ts · 3 tools" while it runs', () => {
    const call = subagentCall({ agent: 'reviewer', task: 'Review it' })
    expect(summarizeSubagentCall(call, subagentRun(PARTIAL, false), true)).toEqual({
      label: 'Delegating to',
      object: 'reviewer',
      hint: 'read src/auth.ts · 3 tools',
    })
  })

  it('reads what it cost once it settled', () => {
    const call = subagentCall({ agent: 'reviewer', task: 'Review it' })
    expect(summarizeSubagentCall(call, subagentRun(FINAL, true), false)).toEqual({
      label: 'Delegated to',
      object: 'reviewer',
      hint: '44 tools · 80.0k tokens · 4m 27s',
    })
  })

  it('says a background launch is one, and names the workflow agents', () => {
    expect(
      summarizeSubagentCall(subagentCall({ agent: 'scout', task: 'x', async: true }), null, false),
    ).toEqual({ label: 'Started', object: 'scout', hint: 'in background' })
    expect(
      summarizeSubagentCall(
        subagentCall({
          workflowScript: 'runs.run("a", { agent: "scout" }); runs.run("b", { agent: "worker" })',
        }),
        null,
        true,
      ),
    ).toEqual({ label: 'Running workflow', object: 'scout · worker', hint: undefined })
  })

  it('gives management actions their own verbs', () => {
    expect(summarizeSubagentCall(subagentCall({ action: 'list' }), null, false)).toEqual({
      label: 'Listed',
      object: 'agents',
    })
    expect(
      summarizeSubagentCall(
        subagentCall({ action: 'stop', id: 'cc0f172e-5ef7-401b-9b89-8653e3185b00' }),
        null,
        false,
      ),
    ).toEqual({ label: 'Stopped', object: 'cc0f172e' })
    expect(
      summarizeSubagentCall(subagentCall({ action: 'guide', topic: 'workflows' }), null, false),
    ).toEqual({ label: 'Read the guide on', object: 'workflows' })
  })
})

describe('parseFleetWidget', () => {
  // The line that was printed verbatim above the composer.
  const CAPTURED =
    'PI_SUBAGENT_ASYNC_JSON:' +
    JSON.stringify({
      kind: 'pi-subagents.async-status-snapshot',
      version: 1,
      generatedAt: 1790622703762,
      caps: {
        maxRuns: 20,
        maxChildrenPerNode: 8,
        maxDepth: 3,
        maxStringLength: 160,
        maxSerializedBytes: 32768,
      },
      omitted: { runs: 0, children: 0, byteLimitExceeded: false },
      runs: [
        {
          id: 'cc0f172e-5ef7-401b-9b89-8653e3185b00',
          kind: 'subagent',
          label: 'delegate',
          state: 'running',
          startedAt: 1790622610420,
          updatedAt: 1790622698492,
          activity: { lastActivityAt: 1790622698433, turnCount: 12, toolCount: 17 },
          children: [
            {
              id: 'step:0',
              kind: 'step',
              label: 'delegate',
              state: 'running',
              startedAt: 1790622610422,
              activity: {
                currentTool: 'bash',
                lastActivityAt: 1790622698433,
                turnCount: 12,
                toolCount: 17,
              },
            },
          ],
        },
      ],
    })

  it('reads the tree, and finds the running tool down in the step', () => {
    const fleet = parseFleetWidget([CAPTURED])!
    expect(fleet.active).toBe(1)
    expect(fleet.runs[0]).toMatchObject({ label: 'delegate', state: 'running', toolCount: 17 })
    expect(fleet.runs[0]!.children[0]).toMatchObject({ id: 'step:0', currentTool: 'bash' })
    expect(summarizeFleet(fleet)).toBe('1 background agent running · delegate · bash')
  })

  it('says how many finished once nothing runs', () => {
    const done = CAPTURED.replace(/"state":"running"/g, '"state":"complete"')
    expect(summarizeFleet(parseFleetWidget([done])!)).toBe('1 background run done')
  })

  it('renders nothing for another widget, a future version, or broken JSON', () => {
    expect(parseFleetWidget(undefined)).toBeNull()
    expect(parseFleetWidget(['async subagent worker · background'])).toBeNull()
    expect(
      parseFleetWidget(['PI_SUBAGENT_ASYNC_JSON:{"kind":"x","version":1,"runs":[]}']),
    ).toBeNull()
    expect(parseFleetWidget(['PI_SUBAGENT_ASYNC_JSON:{nope'])).toBeNull()
  })
})

describe('parseSubagentNotice', () => {
  it('reads who finished, how, and keeps the output as the body', () => {
    const notice = parseSubagentNotice(
      'subagent-notify',
      'Background task completed: **delegate**\n\ndelegate:\n# PR review\n\nNo findings.',
    )!
    expect(notice).toMatchObject({
      kind: 'completion',
      status: 'completed',
      agents: ['delegate'],
      headline: 'delegate finished in the background',
    })
    expect(notice.body).toBe('delegate:\n# PR review\n\nNo findings.')
  })

  it('reads a grouped completion and a failure', () => {
    expect(
      parseSubagentNotice(
        'subagent-notify',
        'Background tasks completed (2): **scout**, **reviewer**\n\n1. scout\n…',
      ),
    ).toMatchObject({
      agents: ['scout', 'reviewer'],
      headline: 'scout, reviewer finished in the background',
    })
    expect(
      parseSubagentNotice('subagent-notify', 'Detached foreground task failed: **worker**\n\nboom'),
    ).toMatchObject({ status: 'failed', headline: 'worker failed after detaching' })
  })

  it('keeps an unfamiliar header as the headline rather than inventing a status', () => {
    const notice = parseSubagentNotice('subagent-notify', 'Something else: **x**\nbody')!
    expect(notice).toMatchObject({
      kind: 'completion',
      headline: 'Something else: x',
      body: 'body',
    })
    expect(notice.status).toBeUndefined()
  })

  it('treats the control and steering notices as their own kinds, and nothing else at all', () => {
    expect(
      parseSubagentNotice('subagent_control_notice', 'delegate needs attention\n\nIdle for 10m.'),
    ).toMatchObject({
      kind: 'attention',
      headline: 'delegate needs attention',
      body: 'Idle for 10m.',
    })
    expect(parseSubagentNotice('subagent_steering_notice', 'Steer delivered')).toMatchObject({
      kind: 'steering',
    })
    expect(parseSubagentNotice('other', 'x')).toBeNull()
  })
})

/**
 * Captured from session 01a10e05 (2026-10-06, pi-subagents 0.74.0): a worker
 * inside a workflow asking the parent model for a decision.
 */
const QUESTION_TEXT = [
  'Subagent needs a supervisor decision.',
  'Run: fd71fece-0942-4038-abea-2ce920af565b',
  'Agent: worker',
  'Child index: 0',
  '',
  'Production unsafe machinery removed. Approve independent scratch npm install of exact nx@23.2.1?',
  '',
  'Reply with: subagent_supervisor({ action: "reply", replyTo: "e024c800-3fee-4363-b923-8e4f6782fa23", message: "..." })',
  '',
  'Live guidance: subagent({ action: "steer", id: "fd71fece-0942-4038-abea-2ce920af565b", index: 0, message: "..." }) (Reply to the pending request first.)',
].join('\n')

const QUESTION_DETAILS = {
  id: 'e024c800-3fee-4363-b923-8e4f6782fa23',
  requestId: 'e024c800-3fee-4363-b923-8e4f6782fa23',
  reason: 'need_decision',
  expectsReply: true,
  runId: 'fd71fece-0942-4038-abea-2ce920af565b',
  agent: 'worker',
  childIndex: 0,
  requestBody:
    'Production unsafe machinery removed. Approve independent scratch npm install of exact nx@23.2.1?',
  replyHint: 'subagent_supervisor({ action: "reply", replyTo: "e024c800-…", message: "..." })',
}

describe('parseSupervisorQuestion', () => {
  it('reads who asked and the question from the structured details', () => {
    expect(parseSupervisorQuestion(QUESTION_DETAILS, QUESTION_TEXT)).toEqual({
      requestId: 'e024c800-3fee-4363-b923-8e4f6782fa23',
      runId: 'fd71fece-0942-4038-abea-2ce920af565b',
      agent: 'worker',
      childIndex: 0,
      reason: 'need_decision',
      body: QUESTION_DETAILS.requestBody,
    })
  })

  it('falls back to the prose, dropping the tool calls written for the model', () => {
    const q = parseSupervisorQuestion(undefined, QUESTION_TEXT)
    expect(q.requestId).toBe('e024c800-3fee-4363-b923-8e4f6782fa23')
    expect(q.runId).toBe('fd71fece-0942-4038-abea-2ce920af565b')
    expect(q.agent).toBe('worker')
    expect(q.childIndex).toBe(0)
    expect(q.body).toBe(QUESTION_DETAILS.requestBody)
    expect(q.body).not.toMatch(/Reply with|Live guidance|subagent_supervisor/)
  })

  it('headlines the notice as a decision request', () => {
    const notice = parseSubagentNotice('subagent_supervisor_request', QUESTION_TEXT)
    expect(notice).toMatchObject({
      kind: 'question',
      agents: ['worker'],
      headline: 'worker asked for a decision',
    })
  })
})

describe('supervisorAnswers', () => {
  const reply = (
    id: string,
    replyTo: string,
    message: string,
    status = 'done',
    isError = false,
  ) => ({
    [id]: {
      toolName: 'subagent_supervisor',
      args: { action: 'reply', replyTo, message },
      status,
      isError,
    },
  })

  it('pairs each reply call with the request it answers', () => {
    const tools = {
      ...reply('t1', 'req-a', 'Approved.'),
      ...reply('t2', 'req-b', 'Not yet.', 'running'),
      t3: { toolName: 'subagent_supervisor', args: { action: 'pending' }, status: 'done' },
      t4: { toolName: 'read', args: { path: 'x' }, status: 'done' },
    }
    const answers = supervisorAnswers(tools)
    expect(answers.get('req-a')).toEqual({ message: 'Approved.', pending: false, failed: false })
    expect(answers.get('req-b')).toMatchObject({ pending: true })
    expect(answers.size).toBe(2)
    expect(supervisorAnswers(tools)).toBe(answers)
  })

  it('never lets a refused late reply hide one that landed', () => {
    const tools = {
      ...reply('t1', 'req-a', 'Accepted.'),
      ...reply('t2', 'req-a', 'Accepted again.', 'error', true),
    }
    expect(supervisorAnswers(tools).get('req-a')).toMatchObject({
      message: 'Accepted.',
      failed: false,
    })
  })
})

describe('workflow child notices', () => {
  it('names the child and keeps the run lines as the body', () => {
    const text =
      'Workflow child failed: **host-components**\nWorkflow run: c6ee611f-ce23-44e6-952d-23bd37523bef\nChild run: a0adb356-0465-4e19-9c94-759e9c3000f1'
    expect(parseSubagentNotice('subagent-incremental-child-notify', text)).toEqual({
      kind: 'completion',
      status: 'failed',
      agents: ['host-components'],
      headline: 'host-components failed in a workflow',
      body: 'Workflow run: c6ee611f-ce23-44e6-952d-23bd37523bef\nChild run: a0adb356-0465-4e19-9c94-759e9c3000f1',
    })
  })
})
