import type { AgentKind, CreateSessionOptions } from '@shared/models'
import { bundledExtensions } from '../bundled-extensions'

export interface SessionExecutable {
  agent: AgentKind
  binaryPath?: string
  prefixArgs?: string[]
  stub: boolean
}

/** Trusted process-local dependencies, not options accepted from a network client. */
export interface SessionLaunchRuntime {
  resolveExecutable: () => Promise<SessionExecutable>
  forkSession: (path: string) => Promise<string>
  readEnvironment: (executable: SessionExecutable) => Promise<Record<string, string>>
  resourceRoot: () => string
}

/** Prepare a launch without knowing about Electron, its preferences or its installation. */
export async function prepareSessionLaunch(
  options: Pick<CreateSessionOptions, 'sessionPath' | 'forkFrom'>,
  runtime: SessionLaunchRuntime,
): Promise<
  SessionExecutable & {
    sessionPath?: string
    forkFrom?: string
    env: Record<string, string>
    extensions: string[]
  }
> {
  const executable = await runtime.resolveExecutable()
  let sessionPath = options.sessionPath
  let forkFrom = options.forkFrom
  // omp has no --fork. Preserve the existing copy-before-environment ordering.
  if (executable.agent === 'omp' && forkFrom) {
    sessionPath = await runtime.forkSession(forkFrom)
    forkFrom = undefined
  }
  const env = await runtime.readEnvironment(executable)
  const extensions = bundledExtensions(runtime.resourceRoot())
  return { ...executable, sessionPath, forkFrom, env, extensions }
}
