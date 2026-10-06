import { bundledExtensions } from '../bundled-extensions'

export interface SessionExecutable {
  binaryPath?: string
  prefixArgs?: string[]
  stub: boolean
}

/** Trusted process-local dependencies, not options accepted from a network client. */
export interface SessionLaunchRuntime {
  resolveExecutable: () => Promise<SessionExecutable>
  readEnvironment: (executable: SessionExecutable) => Promise<Record<string, string>>
  resourceRoot: () => string
}

/** Prepare a launch without knowing about Electron, its preferences or its installation. */
export async function prepareSessionLaunch(
  runtime: SessionLaunchRuntime,
): Promise<SessionExecutable & { env: Record<string, string>; extensions: string[] }> {
  const executable = await runtime.resolveExecutable()
  // Account/provider overlays must never mutate a cached environment from the adapter.
  const env = { ...(await runtime.readEnvironment(executable)) }
  const extensions = bundledExtensions(runtime.resourceRoot())
  return { ...executable, env, extensions }
}
