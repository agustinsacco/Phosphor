import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { ModalOverlay } from '@/components/Modal'
import { Markdown } from '@/components/markdown/Markdown'
import { useChatStore } from '@/stores/chat'
import { relativeTime } from '@/lib/time'
import { agentHistory, type HistoryRun, type HistoryStatus } from './agentHistory'
import { askSteer, confirmStop, useAgentsUi, type AgentRef } from './agentsUi'
import { inspectAgent } from './subagentControl'
import type { InspectMessage, InspectReply } from './subagentInspect'
import { shortId } from './subagentRuns'
import { useFleet } from './useFleet'

const EMPTY_ITEMS: never[] = []
const EMPTY_TOOLS = Object.freeze({}) as Record<string, never>

const STATUS_TONE: Record<string, string> = {
  running: 'text-accent',
  queued: 'text-accent',
  completed: 'text-text-secondary',
  complete: 'text-text-secondary',
  failed: 'text-danger',
  stopped: 'text-text-tertiary',
  paused: 'text-warning',
  unknown: 'text-text-tertiary',
}

function StatusPill({ status }: { status: string }): React.JSX.Element {
  return (
    <span
      data-testid="agent-status"
      className={clsx(
        'bg-bg-secondary shrink-0 rounded px-1.5 py-px text-xs font-semibold uppercase tracking-wide',
        STATUS_TONE[status] ?? 'text-text-tertiary',
      )}
    >
      {status === 'unknown' ? 'no report' : status}
    </span>
  )
}

const BUTTON =
  'border-border hover:bg-bg-secondary rounded-md border px-2 py-0.5 text-sm disabled:opacity-50'

/**
 * The Agents panel: every run this session started, and any one of them
 * opened onto its task, the tail of its transcript and its final output.
 * Stop and steer go to pi-subagents directly, never through the model.
 */
export function AgentsModal({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const view = useAgentsUi((s) => s.open[sessionId] ?? null)
  const close = useAgentsUi((s) => s.close)
  if (!view) return null
  return (
    <ModalOverlay onClose={() => close(sessionId)}>
      <div
        data-testid="agents-modal"
        className="border-border bg-surface-raised flex max-h-[80vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border shadow-2xl"
      >
        {view.view === 'history' ? (
          <HistoryView sessionId={sessionId} />
        ) : (
          <RunView sessionId={sessionId} agent={view.agent} from={view.from} />
        )}
      </div>
    </ModalOverlay>
  )
}

function Header({
  sessionId,
  title,
  subtitle,
  children,
}: {
  sessionId: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  const close = useAgentsUi((s) => s.close)
  return (
    <div className="border-border flex items-start gap-3 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-lg font-semibold">{title}</div>
        {subtitle && <div className="text-text-tertiary mt-0.5 truncate text-sm">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
      <button
        onClick={() => close(sessionId)}
        aria-label="Close"
        className="text-text-tertiary hover:text-text shrink-0"
      >
        ✕
      </button>
    </div>
  )
}

// ---------- history ----------

function HistoryView({ sessionId }: { sessionId: string }): React.JSX.Element {
  const items = useChatStore((s) => s.sessions[sessionId]?.items) ?? EMPTY_ITEMS
  const tools = useChatStore((s) => s.sessions[sessionId]?.tools) ?? EMPTY_TOOLS
  const fleet = useFleet(sessionId)
  const runs = useMemo(() => agentHistory(items, tools, fleet).reverse(), [items, tools, fleet])
  const running = runs.filter((run) => run.status === 'running').length
  return (
    <>
      <Header
        sessionId={sessionId}
        title="Agents"
        subtitle={
          runs.length === 0
            ? 'No sub-agents in this session yet.'
            : `${runs.length} run${runs.length === 1 ? '' : 's'} in this session${running ? ` · ${running} running` : ''}`
        }
      />
      <ul className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="agents-history">
        {runs.map((run) => (
          <HistoryRow key={run.key} sessionId={sessionId} run={run} />
        ))}
      </ul>
    </>
  )
}

function HistoryRow({ sessionId, run }: { sessionId: string; run: HistoryRun }): React.JSX.Element {
  const showRun = useAgentsUi((s) => s.showRun)
  const ref: AgentRef | undefined = run.runId ? { runId: run.runId, label: run.label } : undefined
  const meta = [
    run.async ? 'background' : 'foreground',
    run.runId ? shortId(run.runId) : undefined,
    run.startedAt ? relativeTime(run.startedAt) : undefined,
    run.questions ? `${run.questions} question${run.questions === 1 ? '' : 's'}` : undefined,
  ].filter(Boolean)
  return (
    <li data-testid="agents-history-run" className="hover:bg-bg-secondary/60 rounded-lg px-3 py-2">
      <div className="flex items-center gap-2">
        <StatusPill status={run.status} />
        <span className="text-text min-w-0 truncate font-medium">
          {run.verb} {run.label}
        </span>
        <span className="ml-auto flex shrink-0 gap-1.5">
          {ref && run.async && (
            <button className={BUTTON} onClick={() => showRun(sessionId, ref, 'history')}>
              Open
            </button>
          )}
          {ref && run.status === 'running' && (
            <button className={BUTTON} onClick={() => void confirmStop(sessionId, ref)}>
              Stop
            </button>
          )}
        </span>
      </div>
      <div className="text-text-tertiary mt-0.5 truncate text-sm">{meta.join(' · ')}</div>
      {run.outcome && <div className="text-text-secondary truncate text-sm">{run.outcome}</div>}
      {run.children.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {run.children.map((child) => (
            <button
              key={child.runId}
              data-testid="agents-history-child"
              onClick={() =>
                run.runId &&
                showRun(
                  sessionId,
                  { runId: run.runId, childId: child.label, label: child.label },
                  'history',
                )
              }
              className={clsx(
                'bg-bg-secondary rounded px-1.5 py-px text-xs',
                childTone(child.status),
              )}
            >
              {child.label} · {child.status}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}

const childTone = (status: HistoryStatus): string => STATUS_TONE[status] ?? 'text-text-tertiary'

// ---------- one run ----------

const REFRESH_MS = 5000

function RunView({
  sessionId,
  agent,
  from,
}: {
  sessionId: string
  agent: AgentRef
  from: 'history' | 'live'
}): React.JSX.Element {
  const showHistory = useAgentsUi((s) => s.showHistory)
  const [reply, setReply] = useState<InspectReply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReply(await inspectAgent(sessionId, agent))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [sessionId, agent])

  useEffect(() => {
    void load()
  }, [load])

  const running = reply?.status === 'running' || reply?.status === 'queued'
  useEffect(() => {
    if (!running) return
    const interval = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(interval)
  }, [running, load])

  const problem = reply?.error?.message ?? error
  return (
    <>
      <Header
        sessionId={sessionId}
        title={
          <>
            {from === 'history' && (
              <button
                onClick={() => showHistory(sessionId)}
                aria-label="Back to all agents"
                className="text-text-tertiary hover:text-text text-base font-normal"
              >
                ←
              </button>
            )}
            <span className="truncate">{reply?.label ?? agent.label}</span>
            {reply?.status && <StatusPill status={reply.status} />}
          </>
        }
        subtitle={[shortId(agent.runId), agent.childId].filter(Boolean).join(' · ')}
      >
        {running && (
          <>
            <button className={BUTTON} onClick={() => void askSteer(sessionId, agent)}>
              Steer
            </button>
            <button className={BUTTON} onClick={() => void confirmStop(sessionId, agent)}>
              Stop
            </button>
          </>
        )}
        <button className={BUTTON} disabled={loading} onClick={() => void load()}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </Header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="agent-run">
        {problem && (
          <p data-testid="agent-run-error" className="text-text-secondary">
            {problem}
          </p>
        )}
        {!reply && !problem && <p className="text-text-tertiary animate-pulse">Loading…</p>}
        {reply?.task && (
          <Section title="Task">
            <Markdown text={reply.task} />
          </Section>
        )}
        {reply && reply.messages.length > 0 && (
          <Section title={running ? 'Latest activity' : 'Transcript'}>
            <ol className="space-y-1.5" data-testid="agent-run-messages">
              {reply.messages.map((message, index) => (
                <MessageLine key={index} message={message} />
              ))}
            </ol>
          </Section>
        )}
        {reply?.finalOutput && (
          <Section title="Final output">
            <Markdown text={reply.finalOutput} />
          </Section>
        )}
      </div>
    </>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section>
      <div className="text-text-tertiary mb-1 text-xs font-semibold uppercase tracking-wide">
        {title}
      </div>
      <div className="text-base">{children}</div>
    </section>
  )
}

/** `[tool: bash {"command":"npm test"}]` → `bash {"command":"npm test"}` */
const toolText = (text: string): string =>
  text.replace(/^\[(?:tool(?: result)?:?\s*)/, '').replace(/\]$/, '')

function MessageLine({ message }: { message: InspectMessage }): React.JSX.Element {
  if (message.kind === 'toolCall' || message.kind === 'toolResult') {
    return (
      <li
        className={clsx(
          'truncate font-mono text-xs',
          message.isError ? 'text-danger' : 'text-text-tertiary',
        )}
        title={message.text}
      >
        {message.kind === 'toolCall' ? '→ ' : '  ← '}
        {toolText(message.text)}
      </li>
    )
  }
  return (
    <li
      className={clsx(
        'border-l-2 pl-3',
        message.role === 'user' ? 'border-accent/40 text-text-secondary' : 'border-border',
      )}
    >
      <Markdown text={message.text} />
    </li>
  )
}
