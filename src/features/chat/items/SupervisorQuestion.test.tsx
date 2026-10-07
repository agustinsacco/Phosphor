// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CustomItem } from '../reducer'

// Markdown pulls in the settings store, which subscribes to matchMedia at
// module scope; jsdom has none. Stub before the module graph loads.
window.matchMedia = vi.fn().mockReturnValue({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}) as unknown as typeof window.matchMedia

const { SupervisorQuestionItem } = await import('./SupervisorQuestion')
const { useChatStore } = await import('@/stores/chat')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  useChatStore.setState({ sessions: {} }, false)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const item: CustomItem = {
  id: 'i1',
  kind: 'custom',
  customType: 'subagent_supervisor_request',
  inContext: true,
  text: 'Subagent needs a supervisor decision.\nRun: fd71fece-0942-4038-abea-2ce920af565b\nAgent: worker\nChild index: 0\n\nMay I install nx?\n\nReply with: subagent_supervisor({ action: "reply", replyTo: "req-1", message: "..." })',
  details: {
    requestId: 'req-1',
    runId: 'fd71fece-0942-4038-abea-2ce920af565b',
    agent: 'worker',
    childIndex: 0,
    reason: 'need_decision',
    requestBody: 'May I install nx?',
  },
}

function withReply(message: string): void {
  useChatStore.setState(
    {
      sessions: {
        s1: {
          tools: {
            t1: {
              toolCallId: 't1',
              toolName: 'subagent_supervisor',
              args: { action: 'reply', replyTo: 'req-1', message },
              argsText: '',
              status: 'done',
              output: null,
            },
          },
        } as never,
      },
    },
    false,
  )
}

describe('SupervisorQuestionItem', () => {
  it('opens an unanswered question, without the tool calls written for the model', () => {
    act(() => root.render(<SupervisorQuestionItem item={item} sessionId="s1" />))
    const card = container.querySelector('[data-testid="subagent-question"]')!
    expect(card.getAttribute('data-state')).toBe('waiting')
    expect(card.textContent).toContain('worker asked for a decision')
    expect(card.textContent).toContain('fd71fece')
    expect(card.textContent).toContain('May I install nx?')
    expect(card.textContent).toContain('No answer yet.')
    expect(card.textContent).not.toContain('Reply with')
  })

  it("folds an answered question and shows the parent's answer when opened", () => {
    withReply('Approved, exact version only.')
    act(() => root.render(<SupervisorQuestionItem item={item} sessionId="s1" />))
    const card = container.querySelector('[data-testid="subagent-question"]')!
    expect(card.getAttribute('data-state')).toBe('answered')
    expect(container.querySelector('[data-testid="subagent-question-answer"]')).toBeNull()
    act(() => card.querySelector('button')!.click())
    expect(
      container.querySelector('[data-testid="subagent-question-answer"]')!.textContent,
    ).toContain('Approved, exact version only.')
  })
})

describe('SupervisorQuestionItem, live', () => {
  it('folds by itself when the answer lands after the question', () => {
    act(() => root.render(<SupervisorQuestionItem item={item} sessionId="s1" />))
    expect(container.querySelector('[data-testid="subagent-question-answer"]')).not.toBeNull()
    act(() => withReply('Approved.'))
    expect(
      container.querySelector('[data-testid="subagent-question"]')!.getAttribute('data-state'),
    ).toBe('answered')
    expect(container.querySelector('[data-testid="subagent-question-answer"]')).toBeNull()
  })
})
