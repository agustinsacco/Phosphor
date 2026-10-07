import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ChevronIcon } from '@/components/icons'
import { liveAgentRows, type LiveAgentRow } from './subagentRuns'
import { useFleet } from './useFleet'

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
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="hover:bg-bg-secondary/60 flex w-full items-center gap-2 rounded-md py-0.5 text-left text-base"
        >
          <span className="bg-accent h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" />
          <span className="text-text font-medium">
            {rows.length === 1 ? '1 agent' : `${rows.length} agents`} working in the background
          </span>
          {attention > 0 && (
            <span className="text-warning text-sm">· {attention} need attention</span>
          )}
          <ChevronIcon
            expanded={open}
            size={9}
            strokeWidth={3}
            className="text-text-tertiary ml-auto shrink-0"
          />
        </button>
        {open && (
          <ul className="mt-0.5 mb-0.5 space-y-1">
            {rows.map((row) => (
              <li
                key={row.id}
                data-testid="background-agent"
                className="flex items-start gap-2 pl-3.5 text-sm"
              >
                <div className="min-w-0 flex-1">
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
                </div>
                {row.startedAt != null && (
                  <span className="text-text-tertiary shrink-0 tabular-nums">
                    {elapsedLabel(now - row.startedAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
