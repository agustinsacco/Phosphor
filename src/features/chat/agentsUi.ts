import { create } from 'zustand'
import { promptChoice, promptText } from '@/stores/prompt'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { stopAgent, steerAgent, type AgentTarget } from './subagentControl'

/** A run the Agents panel can open, named the way the user saw it. */
export interface AgentRef extends AgentTarget {
  label: string
}

/** Which view of the Agents panel is open, per session. Null: closed. */
type AgentsView = { view: 'history' } | { view: 'run'; agent: AgentRef; from: 'history' | 'live' }

interface AgentsUiState {
  open: Record<string, AgentsView | null>
  showHistory: (sessionId: string) => void
  showRun: (sessionId: string, agent: AgentRef, from?: 'history' | 'live') => void
  close: (sessionId: string) => void
}

export const useAgentsUi = create<AgentsUiState>((set) => ({
  open: {},
  showHistory: (sessionId) =>
    set((s) => ({ open: { ...s.open, [sessionId]: { view: 'history' } } })),
  showRun: (sessionId, agent, from = 'live') =>
    set((s) => ({ open: { ...s.open, [sessionId]: { view: 'run', agent, from } } })),
  close: (sessionId) => set((s) => ({ open: { ...s.open, [sessionId]: null } })),
}))

const toast = (message: string, kind: 'success' | 'error' | 'info' = 'info'): void => {
  useExtensionUiStore.getState().pushToast(message, kind)
}

/**
 * Stop one agent after a confirmation. A workflow step stops alone; the
 * workflow carries on to whatever its script does with a stopped step.
 */
export async function confirmStop(sessionId: string, agent: AgentRef): Promise<void> {
  const choice = await promptChoice({
    title: `Stop ${agent.label}?`,
    message: agent.childId
      ? 'Only this step stops. The workflow decides what happens next, and the parent model is told.'
      : 'The run stops and the parent model is told.',
    choices: [
      { value: 'stop', label: 'Stop', primary: true },
      { value: 'cancel', label: 'Keep running' },
    ],
  })
  if (choice !== 'stop') return
  const ok = await stopAgent(sessionId, agent)
  toast(
    ok ? `Stop sent to ${agent.label}` : `Could not stop ${agent.label}`,
    ok ? 'success' : 'error',
  )
}

/** Send a running agent a message, delivered at its next turn boundary. */
export async function askSteer(sessionId: string, agent: AgentRef): Promise<void> {
  const message = await promptText({
    title: `Steer ${agent.label}`,
    message: 'It reads this at its next turn, without restarting. The parent model is told too.',
    placeholder: 'e.g. Skip the e2e run, the parent will validate.',
    submitLabel: 'Send',
  })
  if (!message?.trim()) return
  const ok = await steerAgent(sessionId, agent, message)
  toast(
    ok ? `Message sent to ${agent.label}` : `Could not steer ${agent.label}`,
    ok ? 'success' : 'error',
  )
}
