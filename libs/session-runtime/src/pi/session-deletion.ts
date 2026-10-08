import { sessionPathKey, type SessionPathRuntime } from './session-path-lock'
import type { SessionRegistry } from './session-registry'

export interface SessionDeletionRuntime {
  registry: Pick<SessionRegistry, 'get' | 'list' | 'dispose'>
  paths: SessionPathRuntime
  ownsRoutine: (id: string) => boolean
  cancelRoutine: (id: string) => Promise<void>
  forgetAccount: (id: string) => void
  deleteTranscript: (path: string) => Promise<void>
  deleteDraft: (path: string) => Promise<void>
}

/** Share the creator's lock domain. Storage/trash policy belongs to the machine adapter. */
export function createSessionDeletion(runtime: SessionDeletionRuntime) {
  const { registry, paths } = runtime
  async function deleteLane(path?: string, sessionId?: string): Promise<string[]> {
    const target = sessionId ? registry.get(sessionId) : undefined
    // Main's identity wins over a client snapshot taken before a fork or bootstrap.
    const file = target?.client.sessionFile ?? path
    const run = async (): Promise<string[]> => {
      const matches = registry
        .list()
        .filter(
          (s) =>
            s.sessionId === sessionId ||
            (file && s.diskPath && sessionPathKey(s.diskPath) === sessionPathKey(file)),
        )
      // Keep references: a bootstrap response can arrive while disposal drains.
      const clients = matches
        .map((s) => registry.get(s.sessionId)?.client)
        .filter((c) => c !== undefined)
      for (const session of matches) {
        if (runtime.ownsRoutine(session.sessionId)) await runtime.cancelRoutine(session.sessionId)
      }
      for (const session of matches) {
        await registry.dispose(session.sessionId)
        runtime.forgetAccount(session.sessionId)
      }
      const transcripts = new Set(
        [file, ...clients.map((c) => c.sessionFile)].filter((p): p is string => Boolean(p)),
      )
      const disposed = matches.map((s) => s.sessionId)
      for (const transcript of transcripts) {
        if (!file) {
          // Identity learned during shutdown: take its lock and stop any intervening resume.
          disposed.push(...(await deleteLane(transcript)))
        } else {
          await runtime.deleteTranscript(transcript)
          await runtime.deleteDraft(transcript)
        }
      }
      return disposed
    }
    if (file) paths.cancelSessionOpens(file)
    return file ? paths.withSessionPath(file, run) : run()
  }
  return deleteLane
}
