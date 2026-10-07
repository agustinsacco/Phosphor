import { useState } from 'react'
import clsx from 'clsx'
import type { CustomItem } from '../reducer'
import { parseSupervisorQuestion, shortId, supervisorAnswers } from '../subagentRuns'
import { Markdown } from '@/components/markdown/Markdown'
import { ChevronIcon } from '@/components/icons'
import { useChatStore } from '@/stores/chat'
import { SEGMENT } from '../transcriptFind'

const EMPTY_TOOLS = Object.freeze({}) as Record<string, never>

/**
 * A sub-agent stopped to ask the parent model something, and what the parent
 * said back. pi-subagents writes the question for the model, ending in
 * copy-paste tool calls; this shows it to a person as one exchange: who asked,
 * the question, and the answer (taken from the parent's `subagent_supervisor`
 * reply call). An open question stays open; an answered one folds to a line.
 */
export function SupervisorQuestionItem({
  item,
  sessionId,
}: {
  item: CustomItem
  sessionId: string
}): React.JSX.Element {
  const question = parseSupervisorQuestion(item.details, item.text)
  const tools = useChatStore((s) => s.sessions[sessionId]?.tools) ?? EMPTY_TOOLS
  const answer = question.requestId ? supervisorAnswers(tools).get(question.requestId) : undefined
  const answered = !!answer && !answer.pending && !answer.failed
  const [open, setOpen] = useState(!answered)
  const who = question.agent ?? 'A sub-agent'
  const state = answered ? 'answered' : answer?.pending ? 'answering' : 'waiting'
  const preview = question.body.split('\n').find((line) => line.trim()) ?? ''

  return (
    <div
      data-testid="subagent-question"
      data-state={state}
      className={clsx(
        'rounded-lg border px-2 py-1',
        answered
          ? 'border-border/60'
          : 'border-warning/30 bg-[color-mix(in_srgb,var(--px-warning)_6%,transparent)]',
      )}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="hover:bg-bg-secondary/60 flex w-full items-center gap-2 rounded-md py-0.5 text-left text-base"
      >
        <span
          className={clsx(
            'bg-bg-secondary shrink-0 rounded px-1.5 py-px text-xs font-semibold uppercase tracking-wide',
            answered ? 'text-text-secondary' : 'text-warning',
          )}
        >
          {state === 'answered' ? 'answered' : state === 'answering' ? 'answering' : 'asks'}
        </span>
        <span className="text-text min-w-0 truncate font-medium">
          {who} {question.reason === 'progress_update' ? 'sent an update' : 'asked for a decision'}
        </span>
        {question.runId && (
          <span className="text-text-tertiary shrink-0 font-mono text-xs">
            {shortId(question.runId)}
            {question.childIndex != null && question.childIndex > 0
              ? ` · #${question.childIndex}`
              : ''}
          </span>
        )}
        <ChevronIcon
          expanded={open}
          size={9}
          strokeWidth={3}
          className="text-text-tertiary ml-auto shrink-0"
        />
      </button>
      {!open && preview && (
        <div className="text-text-secondary truncate pb-0.5 pl-1 text-sm">{preview}</div>
      )}
      {open && (
        <div className="mt-1 mb-1 ml-1 space-y-2 text-base">
          <div
            data-testid="subagent-question-body"
            data-find-segment={SEGMENT.body}
            className="border-warning/40 max-h-[28rem] overflow-auto border-l-2 pl-3"
          >
            <Markdown text={question.body} />
          </div>
          <div
            data-testid="subagent-question-answer"
            className={clsx(
              'border-l-2 pl-3',
              answered ? 'border-accent/40' : 'border-border text-text-secondary',
            )}
          >
            <div className="text-text-tertiary mb-0.5 text-xs font-semibold uppercase tracking-wide">
              Parent's answer
            </div>
            {answered ? (
              <Markdown text={answer.message} />
            ) : answer?.failed ? (
              <p>The reply was refused; the request had already closed.</p>
            ) : answer?.pending ? (
              <p>Answering…</p>
            ) : (
              <p>No answer yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
