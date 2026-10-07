import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { piCallOk } from '@/lib/rpc'
import { delegatedTurnEnded } from './agentHistory'
import clsx from 'clsx'
import { ChevronIcon } from '@/components/icons'
import { liveAgentRows, type LiveAgentRow } from './subagentRuns'
import { useFleet } from './useFleet'
import { askSteer, confirmStop, useAgentsUi, type AgentRef } from './agentsUi'

const ROW_BUTTON =
  'text-text-tertiary hover:text-text hover:bg-bg-secondary rounded px-1.5 py-px text-xs'

/** `45s`, `12m`, `1h 4m`: coarse on purpose, a background run is long. */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/** "bash for 4m · 52 tools · 47 turns" */
export function agentActivityLine(row: LiveAgentRow, now: number): string {
  const tool = row.currentTool
    ? row.currentToolStartedAt != null
      ? `${row.currentTool} for ${elapsedLabel(now - row.currentToolStartedAt)}`
      : row.currentTool
    : 'thinking'
  const counts = [
    row.toolCount != null ? count(row.toolCount, 'tool') : undefined,
    row.turnCount != null ? count(row.turnCount, 'turn') : undefined,
  ]
  return [tool, ...counts].filter(Boolean).join(' · ')
}

/**
 * What the background agents are doing, above the composer, for as long as
 * any of them is.
 *
 * A detached run hands control straight back, so the parent goes idle while
 * its workers carry on, and nothing else on screen moved: the sidebar row
 * read idle and the strip had one truncated line. That is exactly when a
 * reader asks "is it still working?". This panel answers from the
 * `subagent-async` snapshot: one row per working agent, named by its stage,
 * with its current tool, how long that has been running, and a flag when
 * pi-subagents' watchdog says it needs attention.
 */
export function BackgroundAgents({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const fleet = useFleet(sessionId)
  const showRun = useAgentsUi((s) => s.showRun)
  const showHistory = useAgentsUi((s) => s.showHistory)
  const active = fleet?.active ?? 0
  const [open, setOpen] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (active === 0) return
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [active])

  if (!fleet || active === 0) return null
  const rows = liveAgentRows(fleet)
  const attention = rows.filter((row) => row.attention).length

  return (
    <div className="mx-auto w-full max-w-3xl px-1 pb-2" data-testid="background-agents">
      <div className="border-border/60 rounded-lg border px-2 py-1">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="hover:bg-bg-secondary/60 flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left text-base"
          >
            <span className="bg-accent h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" />
            <span className="text-text truncate font-medium">
              {rows.length === 1 ? '1 agent' : `${rows.length} agents`} working in the background
            </span>
            {attention > 0 && (
              <span className="text-warning shrink-0 text-sm">· {attention} need attention</span>
            )}
            <ChevronIcon
              expanded={open}
              size={9}
              strokeWidth={3}
              className="text-text-tertiary ml-auto shrink-0"
            />
          </button>
          <button className={ROW_BUTTON} onClick={() => showHistory(sessionId)}>
            All agents
          </button>
        </div>
        {open && (
          <ul className="mt-0.5 mb-0.5 space-y-1">
            {rows.map((row) => {
              const ref: AgentRef = { runId: row.runId, childId: row.childId, label: row.label }
              return (
                <li
                  key={row.id}
                  data-testid="background-agent"
                  className="group flex items-start gap-2 pl-3.5 text-sm"
                >
                  <button
                    onClick={() => showRun(sessionId, ref)}
                    title="Open this agent's transcript"
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex min-w-0 items-baseline gap-1.5">
                      <span className="text-text truncate font-medium">{row.label}</span>
                      {row.context && (
                        <span className="text-text-tertiary truncate">· {row.context}</span>
                      )}
                    </div>
                    <div
                      className={clsx(
                        'truncate',
                        row.attention ? 'text-warning' : 'text-text-secondary',
                      )}
                    >
                      {row.attention ? 'needs attention · ' : ''}
                      {agentActivityLine(row, now)}
                    </div>
                  </button>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button className={ROW_BUTTON} onClick={() => void askSteer(sessionId, ref)}>
                      Steer
                    </button>
                    <button className={ROW_BUTTON} onClick={() => void confirmStop(sessionId, ref)}>
                      Stop
                    </button>
                    {row.startedAt != null && (
                      <span className="text-text-tertiary w-12 text-right tabular-nums">
                        {elapsedLabel(now - row.startedAt)}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

const CONTINUE_PROMPT =
  'Continue with the next step. If nothing is left to do, say so and summarize where things stand.'

/**
 * The parent delegated, its agents are all done, and its turn has ended.
 * pi-subagents wakes the parent only while a run is live, so nothing happens
 * from here until someone types; a parent that ended on "X is next" sat 8h
 * overnight this way. This says so, and offers the one-click nudge.
 */
export function DelegationIdleStrip({
  sessionId,
}: {
  sessionId: string
}): React.JSX.Element | null {
  const items = useChatStore((s) => s.sessions[sessionId]?.items)
  const tools = useChatStore((s) => s.sessions[sessionId]?.tools)
  const isStreaming = useChatStore((s) => s.sessions[sessionId]?.isStreaming ?? false)
  const fleet = useFleet(sessionId)
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const lastId = items?.at(-1)?.id ?? null
  const ended = useMemo(
    () => (items && tools ? delegatedTurnEnded(items, tools) : false),
    [items, tools],
  )
  if (isStreaming || (fleet?.active ?? 0) > 0 || !ended || dismissedAt === lastId) return null

  const resume = async (): Promise<void> => {
    setSending(true)
    try {
      useChatStore.getState().addUserMessage(sessionId, CONTINUE_PROMPT)
      await piCallOk(sessionId, { type: 'prompt', message: CONTINUE_PROMPT })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-1 pb-2" data-testid="delegation-idle">
      <div className="text-text-secondary flex items-center gap-2 px-2 text-base">
        <span className="bg-text-tertiary/50 h-1.5 w-1.5 shrink-0 rounded-full" />
        <span className="min-w-0 truncate">
          No agents are running, and the parent has stopped. Nothing continues until you reply.
        </span>
        <button
          disabled={sending}
          onClick={() => void resume()}
          className="border-border hover:bg-bg-secondary ml-auto shrink-0 rounded-md border px-2 py-0.5 text-sm disabled:opacity-50"
        >
          Continue
        </button>
        <button
          onClick={() => setDismissedAt(lastId)}
          aria-label="Dismiss"
          className="text-text-tertiary hover:text-text shrink-0 text-sm"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
