import { app } from 'electron'
import type { CreateSessionOptions } from '@shared/models'
import { prepareSessionLaunch, type SessionLaunchRuntime } from '../../runtime/pi/session-launch'
import { cachedAgentHealth } from './health'
import { forkSessionFile } from './session-writer'
import { piStubPath } from './stub'
import { piProcessEnv } from './shell-env'
import { claudeProviderSpawnEnv } from './provider-detect'

const runtime: SessionLaunchRuntime = {
  resolveExecutable: async () => {
    // The existing gate rejects this environment hook in packaged applications.
    const stub = piStubPath()
    if (stub) return { agent: 'pi', binaryPath: process.execPath, prefixArgs: [stub], stub: true }
    const health = await cachedAgentHealth()
    if (!health.ok) throw new Error(health.message ?? `${health.agent} is not available`)
    return {
      agent: health.agent,
      binaryPath: health.binaryPath,
      prefixArgs: health.prefixArgs,
      stub: false,
    }
  },
  forkSession: forkSessionFile,
  // GUI launches still need the login shell's PATH to find version-managed Node.
  readEnvironment: async ({ stub }) =>
    stub
      ? { ELECTRON_RUN_AS_NODE: '1' }
      : { ...(await piProcessEnv()), ...claudeProviderSpawnEnv() },
  resourceRoot: () => (app.isPackaged ? process.resourcesPath : app.getAppPath()),
}

export function prepareDesktopSessionLaunch(
  options: Pick<CreateSessionOptions, 'sessionPath' | 'forkFrom'>,
) {
  return prepareSessionLaunch(options, runtime)
}
