/** Root-to-leaf traversal of Pi's append-only session tree. Never follows array order. */
export function sessionBranch<T extends { id: string; parentId: string | null }>(
  entries: T[],
  leafId: string | null,
  unknownLeaf: 'empty' | 'last' = 'empty',
): T[] {
  if (leafId === null) return []
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const path: T[] = []
  const seen = new Set<string>()
  let current = byId.get(leafId) ?? (unknownLeaf === 'last' ? entries.at(-1) : undefined)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return current && unknownLeaf === 'empty' ? [] : path.reverse()
}
