import type { SessionPush } from '@shared/models'
import type { ExtensionUIRequest } from '@shared/rpc'
import type { RuntimeLog } from '../file-log'
import type { createContextBudgetRuntime } from './context-budget'
import type { LiveSession } from './session-registry'

export interface SessionEventRuntime {
  emit: (payload: SessionPush) => void
  log: RuntimeLog
  budget: {
    watch: ReturnType<typeof createContextBudgetRuntime>['watchContextBudget']
    read: () => string
    paused: () => boolean
  }
  onExtensionUI: (request: ExtensionUIRequest) => void
}

/** Bind once per session. Sinks receive whole events; UI filtering belongs to adapters. */
export function bindSessionEvents(session: LiveSession, runtime: SessionEventRuntime): void {
  const { client, sessionId } = session
  client.on('event', (event) => runtime.emit({ kind: 'event', event }))
  // Preserve listener order: push first, budget observation next; budget exit
  // cleanup precedes the externally visible exit notification.
  runtime.budget.watch(sessionId, client, runtime.budget.read, runtime.budget.paused)
  client.on('extension-ui', (request) => {
    runtime.onExtensionUI(request)
    runtime.emit({ kind: 'extension-ui', request })
  })
  client.on('stderr', (text) => {
    runtime.log('pi', 'stderr', { sessionId, text })
    runtime.emit({ kind: 'stderr', text })
  })
  client.on('exit', ({ code, signal, expected }) => {
    if (!expected) runtime.log('pi', 'exited unexpectedly', { sessionId, code, signal })
    runtime.emit({ kind: 'exit', code, signal: signal ?? null, expected })
  })
}
