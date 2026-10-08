/**
 * The artifact store as the renderer sees it, over IPC.
 *
 * The store itself (`<userData>/artifacts`, written only by the main process)
 * is described in `libs/pi-extensions/pi-ext/artifact-store.ts`. These are
 * the shapes the renderer gets back from it.
 */

/** One version of an artifact, with its content. */
export interface ArtifactSnapshotVersion {
  version: number
  title: string
  content: string
  /** When the session recorded it, epoch ms. */
  createdAt: number
}

/** An artifact as a session pane shows it: its current branch's versions. */
export interface ArtifactSnapshot {
  id: string
  title: string
  type: string
  language?: string
  /** Ascending by version, current branch only. */
  versions: ArtifactSnapshotVersion[]
}

/** One row of the global Artifacts page. No content. */
export interface ArtifactListing {
  /** `<sessionId>/<id>`: the same ref the model uses for it. */
  key: string
  sessionId: string
  id: string
  sessionFile: string
  cwd: string
  sessionName?: string
  firstUserText?: string
  title: string
  type: string
  language?: string
  /** The current version on the session's branch. */
  version: number
  versionCount: number
  updatedAt: number
  /** The session file is gone; the artifact stays until removed here. */
  sessionDeleted: boolean
  /** Forks holding this same version, folded into this row. */
  copies: number
}
