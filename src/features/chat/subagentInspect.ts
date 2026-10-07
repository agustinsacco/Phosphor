/**
 * pi-subagents' reply to `/subagents-inspect-rpc`: a run's state, its task,
 * the tail of its transcript and its final output, as one widget line
 * (`PI_SUBAGENT_INSPECT_JSON:`). Read defensively: it is a wire contract with
 * another repo, and a shape this side does not know parses to null.
 */

export const INSPECT_PREFIX = 'PI_SUBAGENT_INSPECT_JSON:'
const INSPECT_KIND = 'pi-subagents.inspect-reply'

export interface InspectMessage {
  role: string
  kind: 'text' | 'toolCall' | 'toolResult'
  text: string
  name?: string
  isError?: boolean
}

export interface InspectReply {
  requestId: string
  asyncId?: string
  childId?: string
  /** pi-subagents' run state: `running`, `complete`, `failed`, … */
  status?: string
  label?: string
  task?: string
  messages: InspectMessage[]
  finalOutput?: string
  error?: { code: string; message: string }
}

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined

/** One `subagent-inspect` widget line, or null if it is not a v1 reply. */
export function parseInspectReply(line: string | undefined): InspectReply | null {
  if (!line?.startsWith(INSPECT_PREFIX)) return null
  let raw: unknown
  try {
    raw = JSON.parse(line.slice(INSPECT_PREFIX.length))
  } catch {
    return null
  }
  const r = rec(raw)
  const requestId = str(r?.requestId)
  if (!r || r.kind !== INSPECT_KIND || r.version !== 1 || !requestId) return null
  const error = rec(r.error)
  const messages: InspectMessage[] = []
  for (const entry of Array.isArray(r.messages) ? r.messages : []) {
    const m = rec(entry)
    const text = str(m?.text)
    const kind = m?.kind
    if (!m || !text || (kind !== 'text' && kind !== 'toolCall' && kind !== 'toolResult')) continue
    messages.push({
      role: str(m.role) ?? 'assistant',
      kind,
      text,
      name: str(m.name),
      isError: m.isError === true || undefined,
    })
  }
  return {
    requestId,
    asyncId: str(r.asyncId),
    childId: str(r.childId),
    status: str(r.status),
    label: str(r.label),
    task: str(r.task),
    messages,
    finalOutput: str(r.finalOutput),
    error: error
      ? { code: str(error.code) ?? 'error', message: str(error.message) ?? 'Inspection failed.' }
      : undefined,
  }
}
