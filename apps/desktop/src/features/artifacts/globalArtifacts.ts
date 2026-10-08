import type { ArtifactListing } from '@shared/artifacts'
import { normalizeArtifactType, type Artifact } from '@/stores/artifacts'

/**
 * The global Artifacts page's rows: the artifact store's listing, merged with
 * what open sessions hold live. Pure, so the merge is testable without React.
 */
export interface GlobalArtifactRow {
  key: string
  id: string
  title: string
  type: Artifact['type']
  version: number
  updatedAt: number
  cwd: string
  sessionFile?: string
  sessionName?: string
  firstUserText?: string
  sessionDeleted: boolean
  copies: number
  /** The session is open in this window. */
  phosphorId?: string
}

export interface LiveSessionArtifacts {
  phosphorId: string
  diskPath?: string
  workspacePath: string
  artifacts: Record<string, Artifact>
}

/**
 * The store's rows, with what open sessions hold live laid over them: a turn
 * still running has not reached the session file, so the store cannot have
 * its newest versions yet, and a brand-new session has no file at all.
 */
export function mergeGlobalArtifacts(
  stored: ArtifactListing[],
  live: LiveSessionArtifacts[],
): GlobalArtifactRow[] {
  const rows = new Map<string, GlobalArtifactRow>()
  const openFiles = new Map<string, string>()
  for (const session of live)
    if (session.diskPath) openFiles.set(session.diskPath, session.phosphorId)
  for (const listing of stored) {
    rows.set(`${listing.sessionFile}\u0000${listing.id}`, {
      key: listing.key,
      id: listing.id,
      title: listing.title,
      type: normalizeArtifactType(listing.type),
      version: listing.version,
      updatedAt: listing.updatedAt,
      cwd: listing.cwd,
      sessionFile: listing.sessionFile,
      sessionName: listing.sessionName,
      firstUserText: listing.firstUserText,
      sessionDeleted: listing.sessionDeleted,
      copies: listing.copies,
      phosphorId: openFiles.get(listing.sessionFile),
    })
  }
  for (const session of live) {
    for (const artifact of Object.values(session.artifacts)) {
      const latest = artifact.versions[artifact.versions.length - 1]
      if (!latest) continue
      const at = `${session.diskPath ?? `live:${session.phosphorId}`}\u0000${artifact.id}`
      const row = rows.get(at)
      if (row && row.version >= latest.version) continue
      rows.set(at, {
        key: row?.key ?? `live:${session.phosphorId}/${artifact.id}`,
        id: artifact.id,
        title: artifact.title,
        type: artifact.type,
        version: latest.version,
        updatedAt: Math.max(row?.updatedAt ?? 0, artifact.updatedAt),
        cwd: row?.cwd ?? session.workspacePath,
        sessionFile: session.diskPath,
        sessionName: row?.sessionName,
        firstUserText: row?.firstUserText,
        sessionDeleted: false,
        copies: row?.copies ?? 0,
        phosphorId: session.phosphorId,
      })
    }
  }
  return [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}
