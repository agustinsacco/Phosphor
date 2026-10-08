import { readFile, readdir, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  blobFile,
  currentVersion,
  indexFile,
  readAllIndexes,
  type SessionArtifactIndex,
  type StoredArtifact,
} from '@phosphor/pi-extensions/artifact-store'
import type { ArtifactListing, ArtifactSnapshot } from '@shared/artifacts'
import { indexSessionFile, writeIndex } from './artifact-indexer'

type Log = (scope: string, message: string, data?: Record<string, unknown>) => void

/** Quiet period after a turn ends before its file is indexed. */
const SETTLE_MS = 750

/**
 * Phosphor's artifact store, from the main process: the ONLY writer.
 *
 * Holds every session index in memory (they carry no content, a few KB each)
 * and serialises work per session file, so the per-turn trigger, a pane
 * opening and the backfill can never index one file twice at once.
 */
export class ArtifactLibrary {
  private readonly indexes = new Map<string, SessionArtifactIndex>()
  private readonly byFile = new Map<string, string>()
  private loading: Promise<void> | null = null
  private readonly queues = new Map<string, Promise<SessionArtifactIndex | null>>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly root: () => string,
    private readonly log: Log = () => undefined,
  ) {}

  private load(): Promise<void> {
    this.loading ??= Promise.resolve().then(() => {
      for (const index of readAllIndexes(this.root())) this.remember(index)
    })
    return this.loading
  }

  private remember(index: SessionArtifactIndex): void {
    const old = this.indexes.get(index.sessionId)
    if (old && old.sessionFile !== index.sessionFile) this.byFile.delete(old.sessionFile)
    this.indexes.set(index.sessionId, index)
    this.byFile.set(index.sessionFile, index.sessionId)
  }

  private indexFor(path: string): SessionArtifactIndex | null {
    const id = this.byFile.get(path)
    return id ? (this.indexes.get(id) ?? null) : null
  }

  /** Index one session file now. Resolves to its index, or null if it has none. */
  indexFile(path: string): Promise<SessionArtifactIndex | null> {
    const previous = this.queues.get(path) ?? Promise.resolve(null)
    const next = previous
      .catch(() => null)
      .then(async () => {
        await this.load()
        const before = this.indexFor(path)
        const after = await indexSessionFile(this.root(), path, before)
        if (!after) return before
        if (after !== before) {
          await writeIndex(this.root(), after)
          this.remember(after)
        }
        return after
      })
    this.queues.set(path, next)
    void next.finally(() => {
      if (this.queues.get(path) === next) this.queues.delete(path)
    })
    return next
  }

  /** Index once the file settles. For turn ends, where pi is still writing. */
  schedule(path: string): void {
    clearTimeout(this.timers.get(path))
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path)
        this.indexFile(path).catch((error: unknown) =>
          this.log('artifacts', 'index failed', { path, error: String(error) }),
        )
      }, SETTLE_MS),
    )
  }

  /** What a session's pane shows: each artifact's versions on the current branch. */
  async forSession(path: string): Promise<ArtifactSnapshot[]> {
    const index = await this.indexFile(path)
    if (!index) return []
    const snapshots: ArtifactSnapshot[] = []
    for (const artifact of Object.values(index.artifacts)) {
      const snapshot = await this.snapshot(artifact)
      if (snapshot) snapshots.push(snapshot)
    }
    return snapshots
  }

  private async snapshot(artifact: StoredArtifact): Promise<ArtifactSnapshot | null> {
    const versions = artifact.versions
      .filter((v) => v.onBranch)
      .sort((a, b) => a.version - b.version)
    if (versions.length === 0) return null
    const loaded = []
    for (const version of versions) {
      const content = await readFile(blobFile(this.root(), version.sha256), 'utf8').catch(
        () => null,
      )
      // A missing blob drops one version, never the artifact.
      if (content === null) continue
      loaded.push({
        version: version.version,
        title: version.title,
        content,
        createdAt: Date.parse(version.createdAt) || 0,
      })
    }
    if (loaded.length === 0) return null
    const latest = loaded[loaded.length - 1]!
    return {
      id: artifact.slug,
      title: latest.title || artifact.title,
      type: artifact.type,
      language: artifact.language,
      versions: loaded,
    }
  }

  /**
   * Every artifact the store knows, newest first. `livePaths` are the files of
   * open sessions, brought up to date first so a turn that just ended shows.
   */
  async list(livePaths: string[] = []): Promise<ArtifactListing[]> {
    await this.load()
    await Promise.all(livePaths.map((path) => this.indexFile(path).catch(() => null)))
    return foldForks(
      [...this.indexes.values()].flatMap((index) =>
        Object.values(index.artifacts).flatMap((artifact) => {
          const listing = listingFor(index, artifact)
          const origin = currentVersion(artifact)?.toolCallId
          return listing && origin ? [{ listing, origin }] : []
        }),
      ),
    )
  }

  /** One artifact with its content, for viewing outside its session. */
  async read(
    key: string,
  ): Promise<{ listing: ArtifactListing; artifact: ArtifactSnapshot } | null> {
    await this.load()
    const found = this.byKey(key)
    if (!found) return null
    const listing = listingFor(found.index, found.artifact)
    const artifact = await this.snapshot(found.artifact)
    return listing && artifact ? { listing, artifact } : null
  }

  private byKey(key: string): { index: SessionArtifactIndex; artifact: StoredArtifact } | null {
    const slash = key.indexOf('/')
    if (slash === -1) return null
    const index = this.indexes.get(key.slice(0, slash))
    const artifact = index?.artifacts[key.slice(slash + 1)]
    return index && artifact ? { index, artifact } : null
  }

  /**
   * A session file is about to be deleted. Index it one last time, then keep
   * its artifacts under a "session deleted" mark until they are removed here.
   */
  async retainDeletedSession(path: string): Promise<void> {
    const index = await this.indexFile(path)
    if (!index) return
    if (Object.keys(index.artifacts).length === 0) {
      // Nothing to keep: the index was only a scan watermark.
      await this.forget(index)
      return
    }
    const deleted = { ...index, deleted: true }
    await writeIndex(this.root(), deleted)
    this.remember(deleted)
  }

  /**
   * Remove an artifact whose session was deleted. A live session's artifacts
   * are part of its history and go with the session, so they are refused.
   */
  async remove(key: string): Promise<boolean> {
    await this.load()
    const found = this.byKey(key)
    if (!found || !found.index.deleted) return false
    const { [found.artifact.slug]: removed, ...rest } = found.index.artifacts
    const next = { ...found.index, artifacts: rest }
    if (Object.keys(rest).length === 0) await this.forget(next)
    else {
      await writeIndex(this.root(), next)
      this.remember(next)
    }
    await this.collect(removed?.versions.map((v) => v.sha256) ?? [])
    return true
  }

  private async forget(index: SessionArtifactIndex): Promise<void> {
    await unlink(indexFile(this.root(), index.sessionId)).catch(() => undefined)
    this.indexes.delete(index.sessionId)
    this.byFile.delete(index.sessionFile)
  }

  /** Delete the blobs no index refers to any more. */
  private async collect(candidates: string[]): Promise<void> {
    if (candidates.length === 0) return
    const referenced = new Set<string>()
    for (const index of this.indexes.values()) {
      for (const artifact of Object.values(index.artifacts)) {
        for (const version of artifact.versions) referenced.add(version.sha256)
      }
    }
    for (const sha256 of new Set(candidates)) {
      if (!referenced.has(sha256)) {
        await unlink(blobFile(this.root(), sha256)).catch(() => undefined)
      }
    }
  }

  /**
   * Index every session file under pi's sessions root that changed since the
   * last pass. The first pass is what brings back artifacts that only lived in
   * old sessions. One file at a time, yielding between them.
   */
  async backfill(sessionsRoot: string): Promise<{ indexed: number; failed: number }> {
    await this.load()
    let indexed = 0
    let failed = 0
    let dirs: string[]
    try {
      dirs = await readdir(sessionsRoot)
    } catch {
      return { indexed, failed }
    }
    for (const dir of dirs) {
      let files: string[]
      try {
        files = await readdir(join(sessionsRoot, dir))
      } catch {
        continue
      }
      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue
        const path = join(sessionsRoot, dir, name)
        const known = this.indexFor(path)
        if (known) {
          const info = await stat(path).catch(() => null)
          if (info && info.size === known.scan.size && info.mtimeMs === known.scan.mtimeMs) continue
        }
        try {
          await this.indexFile(path)
          indexed++
        } catch (error) {
          failed++
          this.log('artifacts', 'backfill failed', { path, error: String(error) })
        }
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
    return { indexed, failed }
  }
}

function listingFor(index: SessionArtifactIndex, artifact: StoredArtifact): ArtifactListing | null {
  const version = currentVersion(artifact)
  if (!version) return null
  return {
    key: `${index.sessionId}/${artifact.slug}`,
    sessionId: index.sessionId,
    id: artifact.slug,
    sessionFile: index.sessionFile,
    cwd: index.cwd,
    sessionName: index.name,
    firstUserText: index.firstUserText,
    title: version.title || artifact.title,
    type: artifact.type,
    language: artifact.language,
    version: version.version,
    versionCount: artifact.versions.filter((v) => v.onBranch).length,
    updatedAt: Date.parse(version.createdAt) || 0,
    sessionDeleted: index.deleted,
    copies: 0,
  }
}

/**
 * A fork copies its parent's entries, tool call ids included, so an artifact
 * neither side touched since shows up once per fork. Rows whose current
 * version is the same record fold into one: the live session if there is
 * one, else the most recent (session file names start with their creation
 * time). A fork that changed the artifact keeps its row.
 */
export function foldForks(
  rows: Array<{ listing: ArtifactListing; origin: string }>,
): ArtifactListing[] {
  const groups = new Map<string, ArtifactListing[]>()
  for (const { listing, origin } of rows) {
    const group = `${listing.id}\u0000${origin}`
    groups.set(group, [...(groups.get(group) ?? []), listing])
  }
  const folded: ArtifactListing[] = []
  for (const group of groups.values()) {
    const [first, ...rest] = [...group].sort(
      (a, b) =>
        Number(a.sessionDeleted) - Number(b.sessionDeleted) ||
        basename(b.sessionFile).localeCompare(basename(a.sessionFile)),
    )
    folded.push({ ...first!, copies: rest.length })
  }
  return folded.sort((a, b) => b.updatedAt - a.updatedAt)
}
