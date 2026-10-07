import { piCallOk } from '@/lib/rpc'
import { useExtensionUiStore } from '@/stores/extensionUi'
import type { InspectReply } from './subagentInspect'

/**
 * Stop, steer and inspect a background run without a model turn.
 *
 * pi-subagents ships `/subagents-stop`, `/subagents-steer` and
 * `/subagents-inspect-rpc` as extension commands. pi runs an extension
 * command the moment it arrives, even mid-stream, and the command manages its
 * own output; the parent model does not see a prompt. That is the same path
 * Settings uses for `/mcp-auth` (stores/connectors.ts).
 */

/** The run and, for a workflow step or nested child, the child inside it. */
export interface AgentTarget {
  runId: string
  childId?: string
}

/** pi-subagents splits arguments on whitespace; an id never contains any. */
const safeId = (id: string): string => id.replace(/\s+/g, '')

export function stopCommand(target: AgentTarget): string {
  return ['/subagents-stop', safeId(target.runId), target.childId && safeId(target.childId)]
    .filter(Boolean)
    .join(' ')
}

/**
 * The command re-joins everything after the ids with single spaces, so a
 * newline would be lost anyway; flatten it here so the preview is honest.
 */
export function steerCommand(target: AgentTarget, message: string): string {
  const text = message.replace(/\s+/g, ' ').trim()
  const child = target.childId ? ['--child', safeId(target.childId)] : []
  return ['/subagents-steer', safeId(target.runId), ...child, text].join(' ')
}

export function inspectCommand(requestId: string, target: AgentTarget, lines = 80): string {
  return [
    '/subagents-inspect-rpc',
    requestId,
    safeId(target.runId),
    target.childId && safeId(target.childId),
    '--lines',
    String(lines),
  ]
    .filter(Boolean)
    .join(' ')
}

// ---------- the calls ----------

async function command(sessionId: string, message: string): Promise<boolean> {
  return piCallOk(sessionId, { type: 'prompt', message })
}

export function stopAgent(sessionId: string, target: AgentTarget): Promise<boolean> {
  return command(sessionId, stopCommand(target))
}

export function steerAgent(
  sessionId: string,
  target: AgentTarget,
  message: string,
): Promise<boolean> {
  return command(sessionId, steerCommand(target, message))
}

let requestCounter = 0

/**
 * Ask pi-subagents for a run's transcript tail. The reply arrives on the
 * `subagent-inspect` widget, which the extension sets and clears in the same
 * handler; the extension-UI store keeps it by request id for this to collect.
 */
export async function inspectAgent(
  sessionId: string,
  target: AgentTarget,
  timeoutMs = 8000,
): Promise<InspectReply> {
  requestCounter += 1
  const requestId = `phosphor-${Date.now().toString(36)}-${requestCounter}`
  const store = useExtensionUiStore
  const reply = new Promise<InspectReply>((resolve, reject) => {
    const take = (): boolean => {
      const found = store.getState().takeInspectReply(requestId)
      if (found) resolve(found)
      return !!found
    }
    let unsubscribe = (): void => {}
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error('pi-subagents did not answer the inspection request.'))
    }, timeoutMs)
    unsubscribe = store.subscribe(() => {
      if (take()) {
        clearTimeout(timer)
        unsubscribe()
      }
    })
  })
  const sent = await command(sessionId, inspectCommand(requestId, target))
  if (!sent) {
    // The subscription times out on its own; nobody is waiting on it now.
    reply.catch(() => {})
    throw new Error('pi refused the inspection command. Is pi-subagents installed?')
  }
  return reply
}
