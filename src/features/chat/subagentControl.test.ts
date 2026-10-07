import { describe, expect, it } from 'vitest'
import { inspectCommand, steerCommand, stopCommand } from './subagentControl'
import { parseInspectReply } from './subagentInspect'

describe('sub-agent commands', () => {
  it('addresses a whole run, or one child of it', () => {
    expect(stopCommand({ runId: 'fd71fece' })).toBe('/subagents-stop fd71fece')
    expect(stopCommand({ runId: '76406f96', childId: 'cache-contract' })).toBe(
      '/subagents-stop 76406f96 cache-contract',
    )
  })

  it('flattens a steering message the command would re-join anyway', () => {
    expect(steerCommand({ runId: 'r1' }, '  Skip e2e.\n\nThe parent validates. ')).toBe(
      '/subagents-steer r1 Skip e2e. The parent validates.',
    )
    expect(steerCommand({ runId: 'r1', childId: 'review' }, 'Stop at findings.')).toBe(
      '/subagents-steer r1 --child review Stop at findings.',
    )
  })

  it('asks for an inspection by request id', () => {
    expect(inspectCommand('req-1', { runId: 'r1', childId: 'step:0' }, 40)).toBe(
      '/subagents-inspect-rpc req-1 r1 step:0 --lines 40',
    )
    expect(inspectCommand('req-2', { runId: 'r1' })).toBe(
      '/subagents-inspect-rpc req-2 r1 --lines 80',
    )
  })
})

describe('parseInspectReply', () => {
  const line = (reply: unknown): string => 'PI_SUBAGENT_INSPECT_JSON:' + JSON.stringify(reply)

  it('reads a reply in the shape pi-subagents 0.74.0 builds', () => {
    const reply = parseInspectReply(
      line({
        kind: 'pi-subagents.inspect-reply',
        version: 1,
        requestId: 'req-1',
        asyncId: 'fd71fece',
        status: 'running',
        label: 'worker',
        task: 'Prove the cache contract.',
        messages: [
          { role: 'assistant', kind: 'text', text: 'Running the validator.' },
          {
            role: 'assistant',
            kind: 'toolCall',
            name: 'bash',
            text: '[tool: bash {"command":"npm test"}]',
          },
          { role: 'toolResult', kind: 'toolResult', text: '[tool result]', isError: true },
          { role: 'assistant', kind: 'image', text: 'dropped' },
        ],
      }),
    )
    expect(reply).toMatchObject({
      requestId: 'req-1',
      asyncId: 'fd71fece',
      status: 'running',
      label: 'worker',
      task: 'Prove the cache contract.',
    })
    expect(reply!.messages.map((m) => m.kind)).toEqual(['text', 'toolCall', 'toolResult'])
    expect(reply!.messages[2]!.isError).toBe(true)
  })

  it('keeps an error reply, and rejects other shapes', () => {
    expect(
      parseInspectReply(
        line({
          kind: 'pi-subagents.inspect-reply',
          version: 1,
          requestId: 'req-2',
          error: { code: 'stale', message: 'Async run artifacts are no longer available.' },
        }),
      )?.error,
    ).toEqual({ code: 'stale', message: 'Async run artifacts are no longer available.' })
    expect(parseInspectReply(line({ kind: 'other', version: 1, requestId: 'x' }))).toBeNull()
    expect(
      parseInspectReply(line({ kind: 'pi-subagents.inspect-reply', version: 2, requestId: 'x' })),
    ).toBeNull()
    expect(parseInspectReply('PI_SUBAGENT_INSPECT_JSON:{nope')).toBeNull()
    expect(parseInspectReply(undefined)).toBeNull()
  })
})
