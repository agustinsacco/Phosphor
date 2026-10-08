import type { SessionPolicyRuntime } from '@phosphor/session-runtime/pi/session-policy'
import { getPrefs } from '../store'
import { gitInfoBatch } from '../fs/git-info'
import { accountForSpawn, claudeAccountEnv } from '../claude/accounts'
import { headroomSupervisor } from '../headroom/proxy'
import { readAgentSettings } from './agent-settings'
import { listPackages } from './packages'
import { ensureCompactionReset } from './compaction-reset'

export const desktopSessionPolicy: SessionPolicyRuntime = {
  git: async (cwd) => (await gitInfoBatch([cwd]))[cwd] ?? { isRepo: false },
  preferences: getPrefs,
  defaultProvider: async (cwd) => (await readAgentSettings(cwd)).defaultProvider,
  packages: listPackages,
  account: async (options) => {
    const account = await accountForSpawn(options)
    return account ? { id: account.id, env: claudeAccountEnv(account) } : null
  },
  compressionEnvironment: () => headroomSupervisor().sessionEnv(),
  resetCompaction: ensureCompactionReset,
}
