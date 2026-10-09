import { sessionBranch } from '@shared/session-branch'
import type { CustomItem } from './chatItems'
import { isSubagentNotice, SUBAGENT_SUPERVISOR_REPLY_TYPE } from './subagentRuns'

type Entry = Record<string, unknown> & { id: string; parentId: string | null }
const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined

/** Native persisted evidence only. Plain custom replies never become model-context messages. */
export function subagentHistory(
  entries: unknown[],
  leafId: string | null,
): { items: CustomItem[]; omitted: number } {
  const valid = entries.filter((e): e is Entry => {
    const entry = record(e)
    return (
      typeof entry?.id === 'string' &&
      (entry.parentId === null || typeof entry.parentId === 'string')
    )
  })
  if (leafId !== null && !valid.some((e) => e.id === leafId))
    throw new Error('The active history branch is unavailable.')
  const items: CustomItem[] = []
  for (const entry of sessionBranch(valid, leafId)) {
    const message = entry.type === 'message' ? record(entry.message) : entry
    if (!message || typeof message.customType !== 'string' || !isSubagentNotice(message.customType))
      continue
    const reply = entry.type === 'custom' && message.customType === SUBAGENT_SUPERVISOR_REPLY_TYPE
    if (
      !reply &&
      entry.type !== 'custom_message' &&
      !(entry.type === 'message' && (message.role === 'custom' || message.role === 'customMessage'))
    )
      continue
    const details = reply ? entry.data : message.details
    const content = message.content
    const text = reply
      ? record(details)?.message
      : typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .flatMap((b) => {
                const block = record(b)
                return block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []
              })
              .join('\n')
          : undefined
    if (typeof text !== 'string') continue
    items.push({
      id: entry.id,
      kind: 'custom',
      customType: message.customType,
      details,
      text,
      inContext: !reply,
      quiet: message.display === false,
      timestamp:
        typeof message.timestamp === 'number'
          ? message.timestamp
          : typeof entry.timestamp === 'string'
            ? Date.parse(entry.timestamp)
            : undefined,
    })
  }
  return { items: items.slice(-200), omitted: Math.max(0, items.length - 200) }
}
