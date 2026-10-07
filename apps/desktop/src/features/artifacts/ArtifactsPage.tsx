import { memo, useMemo } from 'react'
import { useArtifactsStore, type Artifact } from '@/stores/artifacts'
import { useSessionsStore } from '@/stores/sessions'
import { useChatStore } from '@/stores/chat'
import { useLayoutStore } from '@/stores/layout'
import { PageShell } from '@/components/PageShell'
import { PaneTitle } from '@/components/PaneShell'
import { sessionTitle } from '@/lib/sessionTitle'
import { projectName } from '@/lib/path'
import { relativeTimeShort } from '@/lib/time'
import { artifactGlyph } from './artifactKinds'

interface GlobalArtifactRow {
  sessionId: string
  artifact: Artifact
}

/** Every open session's artifacts as one list, newest first. */
export function flattenSessionArtifacts(
  bySession: Record<string, Record<string, Artifact>>,
): GlobalArtifactRow[] {
  return Object.entries(bySession)
    .flatMap(([sessionId, byId]) =>
      Object.values(byId).map((artifact) => ({ sessionId, artifact })),
    )
    .sort((a, b) => b.artifact.updatedAt - a.artifact.updatedAt)
}

/**
 * Global Artifacts page (sidebar → Artifacts): a cross-session index of every
 * artifact the OPEN sessions hold, newest first. Clicking a row jumps into
 * that artifact's own session with the per-session artifacts pane open — the
 * pane stays the viewer, because viewing an artifact next to its chat is the
 * point of it; this page is how you find one without remembering which lane
 * produced it.
 *
 * Scope is honest about the store behind it: artifacts live in the renderer,
 * ingested from each session's history at bootstrap and dropped on dispose,
 * so a session that is not open contributes nothing here.
 */
export const ArtifactsPage = memo(function ArtifactsPage(): React.JSX.Element {
  const bySession = useArtifactsStore((s) => s.bySession)
  const rows = useMemo(() => flattenSessionArtifacts(bySession), [bySession])

  return (
    <PageShell
      title={<PaneTitle label="Artifacts" meta={rows.length ? `${rows.length}` : undefined} />}
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="max-w-md text-center">
              <div className="text-text-tertiary text-lg">No artifacts in your open sessions</div>
              <div className="text-text-tertiary mt-1 text-sm">
                Ask a session for a dashboard mockup, diagram or report — substantial deliverables
                land here, and closed sessions reload theirs when reopened.
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <div className="text-text-tertiary pb-2 text-sm">
              Everything your open sessions have produced. Opening one jumps to its session.
            </div>
            {rows.map(({ sessionId, artifact }) => (
              <ArtifactRow
                key={`${sessionId}:${artifact.id}`}
                sessionId={sessionId}
                artifact={artifact}
              />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
})

function ArtifactRow({
  sessionId,
  artifact,
}: {
  sessionId: string
  artifact: Artifact
}): React.JSX.Element {
  // A live session's own name beats the scanned one (pi writes the session
  // file only when a turn ends), same rule as the sidebar rows.
  const liveName = useChatStore((s) => s.sessions[sessionId]?.meta?.sessionName)
  const workspacePath = useSessionsStore((s) => s.live[sessionId]?.workspacePath)
  const diskPath = useSessionsStore((s) => s.live[sessionId]?.diskPath)
  const diskMeta = useSessionsStore((s) =>
    workspacePath ? s.disk[workspacePath]?.find((m) => m.path === diskPath) : undefined,
  )
  const git = useSessionsStore((s) => (workspacePath ? s.gitByCwd[workspacePath] : undefined))
  const title =
    sessionTitle({
      explicitName: liveName ?? diskMeta?.name,
      firstUserText: diskMeta?.firstUserText,
    }) ?? 'Untitled session'

  const open = (): void => {
    // activate() closes this page; the pane + selection land the reader on
    // exactly the artifact they clicked.
    useSessionsStore.getState().activate(sessionId)
    useArtifactsStore.getState().select(sessionId, artifact.id)
    useLayoutStore.getState().setRightPane('artifacts', sessionId)
  }

  return (
    <button
      onClick={open}
      className="hover:bg-bg-secondary flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-left"
    >
      <span className="shrink-0 pt-0.5 text-base leading-none">{artifactGlyph(artifact.type)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-base font-medium">{artifact.title}</span>
          <span className="text-text-tertiary shrink-0 text-sm">
            v{artifact.versions.length} · {relativeTimeShort(artifact.updatedAt)}
          </span>
        </span>
        <span className="text-text-tertiary block truncate text-sm">
          {title}
          {workspacePath ? ` · ${projectName(workspacePath, git)}` : ''}
        </span>
      </span>
    </button>
  )
}
