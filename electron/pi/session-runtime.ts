import { registry } from '../registry'
import { createSessionStartup } from '../../runtime/pi/session-startup'
import type { SessionExecution } from '../../runtime/pi/session-policy'
import { desktopSessionSink } from './session-events'
import { prepareDesktopSessionLaunch } from './session-launch'
import { desktopSessionPolicy } from './session-policy'
import { holdAccount } from '../claude/accounts'
import { forgetSpawnAccount, rememberSpawnAccount } from './session-accounts'
import { watchContextBudget } from './context-budget'
import { isRoutineSession } from '../routines/ownership'
import { getPrefs, recordWorkspace, realPathOrNull } from '../store'
import type { CreateSessionOptions, LiveSessionInfo } from '@shared/models'
import { log } from '../debug-log'

const spawn = createSessionStartup({
  registry,
  resolveWorkspace: realPathOrNull,
  launch: prepareDesktopSessionLaunch,
  policy: desktopSessionPolicy,
  log,
  budget: {
    watch: watchContextBudget,
    read: () => getPrefs().contextBudget,
    paused: isRoutineSession,
  },
  accounts: { remember: rememberSpawnAccount, forget: forgetSpawnAccount, hold: holdAccount },
  recordWorkspace,
})

/** Desktop binding only. Startup orchestration lives in the shared runtime. */
export function spawnSession(
  options: CreateSessionOptions,
  target?: Electron.WebContents,
  execution: SessionExecution = {},
): Promise<LiveSessionInfo> {
  return spawn(
    options,
    (id) => desktopSessionSink(id, target, () => execution.unattended ?? false),
    execution,
  )
}
