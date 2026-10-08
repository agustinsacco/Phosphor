import { describe, expect, it } from 'vitest'
import type { AgentMessage, PiEvent, ToolResultMessage } from '@shared/rpc'
import { trimForRenderer } from './event-trim'

/**
 * The trim is safe only for as long as the renderer ignores these fields. If
 * a future reducer starts reading `agent_end.messages` or
 * `turn_end.toolResults`, it will read an empty array and silently do nothing
 * — so these tests state the contract loudly and pin the fields that must
 * survive.
 */

const message = (text: string): AgentMessage =>
  ({ role: 'assistant', content: [{ type: 'text', text }] }) as unknown as AgentMessage

const toolResult = (id: string): ToolResultMessage =>
  ({ role: 'toolResult', toolCallId: id, content: 'ok' }) as unknown as ToolResultMessage

describe('trimForRenderer', () => {
  it('empties agent_end.messages and keeps willRetry', () => {
    const event: PiEvent = {
      type: 'agent_end',
      messages: [message('one'), message('two')],
      willRetry: true,
    }
    const trimmed = trimForRenderer(event)
    expect(trimmed).toEqual({ type: 'agent_end', messages: [], willRetry: true })
  })

  it('keeps an absent willRetry absent — the reducer distinguishes it from false', () => {
    const trimmed = trimForRenderer({ type: 'agent_end', messages: [message('one')] })
    expect(trimmed).toEqual({ type: 'agent_end', messages: [] })
    expect('willRetry' in trimmed).toBe(false)
  })

  it('empties turn_end.toolResults and keeps the turn message', () => {
    const turnMessage = message('done')
    const trimmed = trimForRenderer({
      type: 'turn_end',
      message: turnMessage,
      toolResults: [toolResult('a'), toolResult('b')],
    })
    expect(trimmed).toEqual({ type: 'turn_end', message: turnMessage, toolResults: [] })
  })

  it('never drops an event — only the payload shrinks', () => {
    for (const event of [
      { type: 'agent_end', messages: [message('x')] },
      { type: 'turn_end', message: message('x'), toolResults: [toolResult('a')] },
    ] satisfies PiEvent[]) {
      expect(trimForRenderer(event).type).toBe(event.type)
    }
  })

  it('returns other events by identity, so the hot path allocates nothing', () => {
    // message_update is the per-token event; copying it here would turn a
    // saving into a cost.
    const event: PiEvent = {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', text: 'hi' } as never,
    }
    expect(trimForRenderer(event)).toBe(event)
  })

  it('returns already-empty payloads by identity too', () => {
    const agentEnd: PiEvent = { type: 'agent_end', messages: [] }
    expect(trimForRenderer(agentEnd)).toBe(agentEnd)
    const turnEnd: PiEvent = { type: 'turn_end', message: message('x'), toolResults: [] }
    expect(trimForRenderer(turnEnd)).toBe(turnEnd)
  })
})
