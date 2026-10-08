import { handle } from './handle'
import { stageArtifactHtml } from '../artifacts/artifact-protocol'
import { exportArtifactPdf } from '../artifacts/artifact-pdf'
import { artifactLibrary } from '../artifacts/artifacts'

/** `artifacts:*` — rendering model-authored artifacts, and the artifact store. */
export function registerArtifactsHandlers(): void {
  handle('artifacts:stageHtml', (_event, html, theme) => stageArtifactHtml(html, theme))

  handle('artifacts:exportPdf', (_event, request) => exportArtifactPdf(request))

  handle('artifacts:forSession', (_event, sessionFile) => artifactLibrary.forSession(sessionFile))

  handle('artifacts:list', (_event, livePaths) => artifactLibrary.list(livePaths))

  handle('artifacts:read', (_event, key) => artifactLibrary.read(key))

  handle('artifacts:remove', (_event, key) => artifactLibrary.remove(key))
}
