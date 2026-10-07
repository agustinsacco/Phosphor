import { readFile } from 'node:fs/promises'
import type { SessionTree, SessionTreeEntry } from '@shared/ipc'
import { extractText } from './session-content'

/**
 * Read a persisted session file into the branch structure the tree view
 * renders: one entry per JSONL record, with previews and tool names.
 */

export async function readSessionTree(path: string): Promise<SessionTree> {
  const raw = await readFile(path, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const entries: SessionTreeEntry[] = []
  let sessionId = ''
  let cwd = ''
  let leafId: string | null = null

  for (const line of lines) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const type = entry.type as string
    if (type === 'session') {
      sessionId = (entry.id as string) ?? ''
      cwd = (entry.cwd as string) ?? ''
      continue
    }
    const id = entry.id as string
    if (!id) continue
    leafId = id

    const node: SessionTreeEntry = {
      id,
      parentId: (entry.parentId as string | null) ?? null,
      type,
      timestamp: (entry.timestamp as string) ?? '',
    }

    if (type === 'message') {
      const message = entry.message as { role?: string; content?: unknown } | undefined
      node.role = message?.role
      if (message?.role === 'user') {
        node.preview = extractText(message.content)?.slice(0, 160)
      } else if (message?.role === 'assistant') {
        const content = message?.content
        if (Array.isArray(content)) {
          node.preview = extractText(content)?.slice(0, 160)
          const tools = content.filter((b) => (b as { type?: string }).type === 'toolCall')
          if (tools.length > 0) {
            node.toolName = tools
              .map((t) => (t as { name?: string }).name)
              .filter(Boolean)
              .join(', ')
          }
        }
      } else if (message?.role === 'toolResult') {
        node.toolName = (message as { toolName?: string }).toolName
      }
    } else if (type === 'label') {
      node.targetId = entry.targetId as string
      node.label = entry.label as string | undefined
    } else if (type === 'branch_summary' || type === 'compaction') {
      node.summary = (entry.summary as string | undefined)?.slice(0, 400)
    } else if (type === 'session_info') {
      node.name = entry.name as string | undefined
    } else if (type === 'model_change') {
      node.provider = entry.provider as string | undefined
      node.modelId = entry.modelId as string | undefined
    } else if (type === 'thinking_level_change') {
      node.thinkingLevel = entry.thinkingLevel as string | undefined
    }

    entries.push(node)
  }

  return { sessionId, cwd, entries, leafId }
}
