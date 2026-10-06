import { basename } from 'node:path'
import { registry } from '../registry'
import { bindSessionEvents } from '../../runtime/pi/session-events'
import { desktopSessionSink } from './session-events'
import { prepareDesktopSessionLaunch } from './session-launch'
import { prepareSessionPolicy } from '../../runtime/pi/session-policy'
import { desktopSessionPolicy } from './session-policy'
import { holdAccount } from '../claude/accounts'
import { RATE_LIMIT_STATUS_KEY, accountExhaustedUntil } from '@shared/claude-limits'
import { rememberSpawnAccount } from './session-accounts'
import { healMissingSessionCwd } from './session-cwd'
import { syncContextBudget, watchContextBudget } from './context-budget'
import { isRoutineSession } from '../routines/ownership'
import { getPrefs, recordWorkspace, realPathOrNull } from '../store'
import type { CreateSessionOptions, LiveSessionInfo } from '@shared/models'
import { log } from '../debug-log'

/**
 * Spawn a live session and wire its push channels.
 */
export async function spawnSession(
  rawOptions: CreateSessionOptions,
  target?: Electron.WebContents,
  execution: { unattended?: boolean; intent?: 'report' | 'code'; signal?: AbortSignal } = {},
): Promise<LiveSessionInfo> {
  // Resolved before anything reads it. This one value becomes pi's cwd, the
  // registry key, the recents entry and the `workspacePath` the renderer holds
  // for a LIVE session — and the sidebar keys its groups by that string. A
  // session started under a second spelling of a folder (any symlink on the
  // way to it) therefore opened a second group listing the same lanes, even
  // once recents themselves had been de-duplicated, because the live session
  // put the other spelling back. pi resolves the cwd for its session directory
  // regardless, so this only makes Phosphor agree with what pi already did.
  const options: CreateSessionOptions = {
    ...rawOptions,
    workspacePath: realPathOrNull(rawOptions.workspacePath) ?? rawOptions.workspacePath,
  }
  // A resume whose stored cwd has gone (a renamed or moved folder) makes pi
  // exit 1 before the RPC loop starts, which reads as "the session will not
  // open" with nothing on the chat to say why. Repoint the header first —
  // a no-op unless the stored cwd is genuinely missing. Safe here because the
  // caller (`openSessionPath`) has already disposed every handle on the path,
  // so no pi owns the file.
  if (options.sessionPath) {
    const healed = await healMissingSessionCwd(options.sessionPath, options.workspacePath).catch(
      () => false,
    )
    if (healed) log('pi', 'repointed session cwd', { path: options.sessionPath })
  }

  const launch = await prepareDesktopSessionLaunch()
  const { spawnOptions, accountId } = await prepareSessionPolicy(
    options,
    execution,
    launch,
    desktopSessionPolicy,
  )
  const { stub } = launch
  execution.signal?.throwIfAborted()
  const session = registry.create(options.workspacePath, spawnOptions)

  bindSessionEvents(session, {
    emit: desktopSessionSink(session.sessionId, target, () => execution.unattended ?? false),
    log,
    budget: {
      watch: watchContextBudget,
      read: () => getPrefs().contextBudget,
      // A routine owns its prompts; resume idle checks once it releases the lane.
      paused: () => isRoutineSession(session.sessionId),
    },
    onExtensionUI: (request) => {
      // A rate-limit signal holds the account for the NEXT lane. This session's
      // credential was fixed at spawn and cannot change (claude/routing.ts).
      if (
        accountId &&
        request.method === 'setStatus' &&
        request.statusKey === RATE_LIMIT_STATUS_KEY
      ) {
        const until = accountExhaustedUntil(request.statusText)
        if (until !== null) void holdAccount(accountId, until).catch(() => undefined)
      }
    },
  })

  // Wait for pi to answer before handing the session over; the renderer
  // bootstraps from get_state the moment this returns. A pi that exits or is
  // stopped during startup is disposed here, and the caller gets the reason,
  // or the AbortError when a delete cancelled the open.
  const stopOnAbort = (): void => {
    void registry.dispose(session.sessionId)
  }
  execution.signal?.addEventListener('abort', stopOnAbort, { once: true })
  if (execution.signal?.aborted) stopOnAbort()
  try {
    if (!stub) await syncContextBudget(session.client, getPrefs().contextBudget)
    execution.signal?.throwIfAborted()
    if (!session.client.alive) throw new Error('Session stopped during startup.')
  } catch (error) {
    await registry.dispose(session.sessionId)
    execution.signal?.throwIfAborted()
    throw error
  } finally {
    execution.signal?.removeEventListener('abort', stopOnAbort)
  }

  // Parked until the renderer learns the session's file path; see
  // electron/pi/session-accounts.ts.
  if (accountId) rememberSpawnAccount(session.sessionId, accountId)

  // Background automation must not overwrite the user's launch-resume folder.
  if (!execution.unattended) recordWorkspace(options.workspacePath, basename(options.workspacePath))
  return {
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    pid: session.client.pid,
  }
}
