import { useMemo } from 'react'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { parseFleetWidget, SUBAGENT_ASYNC_WIDGET_KEY, type FleetSnapshot } from './subagentRuns'

/**
 * A session's background runs, from the `subagent-async` widget pi-subagents
 * publishes on its liveness poll. Null when the extension published nothing
 * (it removes the widget once no run is left) or a payload it cannot read.
 */
export function useFleet(sessionId: string | undefined): FleetSnapshot | null {
  const lines = useExtensionUiStore((s) =>
    sessionId ? s.widgets[sessionId]?.[SUBAGENT_ASYNC_WIDGET_KEY]?.lines : undefined,
  )
  return useMemo(() => parseFleetWidget(lines), [lines])
}

/** How many background runs are working; 0 when none or unknown. */
export function useActiveAgents(sessionId: string | undefined): number {
  return useFleet(sessionId)?.active ?? 0
}
