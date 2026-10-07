import type { ChatItem, ToolState } from './chatItems'
import {
  parseSubagentNotice,
  parseSupervisorQuestion,
  scriptAgents,
  subagentCall,
  subagentRun,
  isFleetActive,
  SUBAGENT_CHILD_NOTIFY_TYPE,
  SUBAGENT_NOTIFY_TYPE,
  SUBAGENT_QUESTION_TYPE,
  SUBAGENT_TOOL,
  type FleetSnapshot,
} from './subagentRuns'

/**
 * Every sub-agent run this session started, rebuilt from the transcript, so
 * it survives a reload and needs no file of its own.
 *
 * A launch is a `subagent` tool call (or a `resume`, which revives a run under
 * a new id); its run id is the `asyncId` in the call's details. A background
 * run reports back as a `subagent-notify` naming its async directory; a
 * workflow's children report as `subagent-incremental-child-notify` with
 * "Workflow run: … / Child run: …", which is how a child's questions are
 * attributed to the workflow that started it. The live snapshot, when there
 * is one, overrides all of that for runs still working.
 */

export type HistoryStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'paused' | 'unknown'

export interface HistoryChild {
  runId: string
  label: string
  status: HistoryStatus
}

export interface HistoryRun {
  /** The launching tool call. */
  key: string
  runId?: string
  verb: 'Launched' | 'Resumed'
  label: string
  async: boolean
  startedAt?: number
  status: HistoryStatus
  children: HistoryChild[]
  /** Questions its agents asked the parent. */
  questions: number
  /** The completion's headline, e.g. "worker finished in the background". */
  outcome?: string
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const NOTICE_RUN = new RegExp(
  String.raw`(?:Retention-managed async directory|Workflow receipt):\s*\S*?async-subagent-runs/(` +
    UUID.source +
    ')',
  'i',
)

/** The run a `subagent-notify` reports on. */
export function noticeRunId(text: string, known: Set<string>): string | undefined {
  const exact = NOTICE_RUN.exec(text)?.[1]
  if (exact) return exact
  for (const match of text.matchAll(new RegExp(UUID.source, 'gi'))) {
    if (known.has(match[0])) return match[0]
  }
  return undefined
}

function childLink(text: string): { workflow?: string; child?: string } {
  return {
    workflow: /Workflow run:\s*([0-9a-f-]{36})/i.exec(text)?.[1],
    child: /Child run:\s*([0-9a-f-]{36})/i.exec(text)?.[1],
  }
}

function launchLabel(tool: ToolState): string {
  const call = subagentCall(tool.args)
  if (call.kind === 'manage') return call.target ?? 'agent'
  if (call.agent) return call.agent
  const agents = call.script ? scriptAgents(call.script) : []
  if (agents.length > 0) return agents.join(' · ')
  return call.workflow ? `workflow ${call.workflow.split('/').pop()}` : 'workflow'
}

function settledStatus(tool: ToolState): HistoryStatus {
  if (tool.status === 'starting' || tool.status === 'running') return 'running'
  if (tool.status === 'error' || tool.isError) return 'failed'
  const run = subagentRun(tool.result?.details, true)
  if (!run || run.children.length === 0) return 'completed'
  if (run.children.some((c) => c.status === 'failed')) return 'failed'
  if (run.children.some((c) => c.status === 'stopped')) return 'stopped'
  return 'completed'
}

export function agentHistory(
  items: ChatItem[],
  tools: Record<string, ToolState>,
  fleet?: FleetSnapshot | null,
): HistoryRun[] {
  const runs: HistoryRun[] = []
  const byRunId = new Map<string, HistoryRun>()
  /** A workflow child's run id → the workflow's. */
  const parentOf = new Map<string, string>()
  /**
   * Who asked each question, attributed after the walk once links are known.
   * `sole` is the one background run still open when it was asked, if exactly
   * one was: a running workflow child is linked to its workflow only when it
   * finishes, so while it works that is the only unambiguous owner.
   */
  const askers: { runId: string; sole?: HistoryRun }[] = []
  /** Background runs launched and not yet reported back. */
  const open = new Set<HistoryRun>()

  for (const item of items) {
    if (item.kind === 'assistant') {
      for (const block of item.blocks) {
        if (block.type !== 'tool') continue
        const tool = tools[block.toolCallId]
        if (!tool || tool.toolName !== SUBAGENT_TOOL) continue
        const call = subagentCall(tool.args)
        const resumed = call.kind === 'manage' && call.action === 'resume'
        if (call.kind === 'manage' && !resumed) continue
        const run = subagentRun(
          tool.result?.details ?? tool.output?.details,
          tool.status !== 'running',
        )
        const background = (call.kind === 'launch' && call.async) || resumed || !!run?.async
        const entry: HistoryRun = {
          key: tool.toolCallId,
          runId: run?.runId,
          verb: resumed ? 'Resumed' : 'Launched',
          label: launchLabel(tool),
          async: background,
          startedAt: tool.startedAt ?? item.timestamp,
          // A detached launch returns at once; its outcome is the notice.
          status: background
            ? tool.status === 'error' || tool.isError
              ? 'failed'
              : 'unknown'
            : settledStatus(tool),
          children: [],
          questions: 0,
        }
        runs.push(entry)
        if (entry.runId) byRunId.set(entry.runId, entry)
        if (background && entry.status !== 'failed') open.add(entry)
      }
      continue
    }
    if (item.kind !== 'custom') continue

    if (item.customType === SUBAGENT_NOTIFY_TYPE) {
      const runId = noticeRunId(item.text, new Set(byRunId.keys()))
      const run = runId ? byRunId.get(runId) : undefined
      const notice = parseSubagentNotice(item.customType, item.text)
      if (run && notice) {
        run.status = notice.status ?? 'completed'
        run.outcome = notice.headline
        open.delete(run)
      }
    } else if (item.customType === SUBAGENT_CHILD_NOTIFY_TYPE) {
      const { workflow, child } = childLink(item.text)
      const run = workflow ? byRunId.get(workflow) : undefined
      const notice = parseSubagentNotice(item.customType, item.text)
      if (run && child && notice) {
        parentOf.set(child, workflow!)
        const existing = run.children.find((c) => c.runId === child)
        const status = notice.status ?? 'completed'
        const label = notice.agents[0] ?? 'child'
        if (existing) existing.status = status
        else run.children.push({ runId: child, label, status })
      }
    } else if (item.customType === SUBAGENT_QUESTION_TYPE) {
      const asker = parseSupervisorQuestion(item.details, item.text).runId
      if (asker) askers.push({ runId: asker, sole: open.size === 1 ? [...open][0] : undefined })
    }
  }

  // A child asks while it works and is linked to its workflow only when it
  // finishes, so questions are attributed once the whole transcript is read.
  for (const { runId, sole } of askers) {
    const run = byRunId.get(runId) ?? byRunId.get(parentOf.get(runId) ?? '') ?? sole
    if (run) run.questions += 1
  }

  if (fleet) {
    for (const node of fleet.runs) {
      const run = byRunId.get(node.id)
      if (!run) continue
      if (isFleetActive(node.state)) run.status = 'running'
      for (const child of node.children) {
        if (!isFleetActive(child.state)) continue
        if (!run.children.some((c) => c.runId === child.id || c.label === child.label)) {
          run.children.push({ runId: child.id, label: child.label, status: 'running' })
        }
      }
    }
  }
  return runs
}

/**
 * Did the parent's latest turn delegate and then stop? True when everything
 * since the last user message includes a sub-agent launch (or a sub-agent's
 * report or question) and the transcript ends on a finished assistant reply.
 * The caller adds the live facts: the parent is idle and no run is working.
 *
 * pi-subagents wakes the parent only while a run is live, so this is the
 * state in which nothing will happen until someone types. It is a fact about
 * the transcript, not a guess that work remains.
 */
export function delegatedTurnEnded(items: ChatItem[], tools: Record<string, ToolState>): boolean {
  const last = items.findLast((item) => !(item.kind === 'custom' && item.hidden))
  if (!last || last.kind !== 'assistant' || last.streaming) return false
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.kind === 'user') return false
    if (
      item.kind === 'custom' &&
      (item.customType === SUBAGENT_NOTIFY_TYPE ||
        item.customType === SUBAGENT_CHILD_NOTIFY_TYPE ||
        item.customType === SUBAGENT_QUESTION_TYPE)
    ) {
      return true
    }
    if (item.kind !== 'assistant') continue
    for (const block of item.blocks) {
      if (block.type !== 'tool') continue
      const tool = tools[block.toolCallId]
      if (tool?.toolName !== SUBAGENT_TOOL) continue
      const call = subagentCall(tool.args)
      if (call.kind === 'launch' || call.action === 'resume') return true
    }
  }
  return false
}
