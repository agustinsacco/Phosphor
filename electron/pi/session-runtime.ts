import { basename } from 'node:path'
import { registry } from '../registry'
import { bindSessionEvents } from '../../runtime/pi/session-events'
import { desktopSessionSink } from './session-events'
import { prepareDesktopSessionLaunch } from './session-launch'
import { composeDirectives } from './directives'
import { accountForSpawn, claudeAccountEnv, holdAccount } from '../claude/accounts'
import { RATE_LIMIT_STATUS_KEY, accountExhaustedUntil } from '@shared/claude-limits'
import { rememberSpawnAccount } from './session-accounts'
import { assertClaudeContextProvider, usesClaudeCliProvider } from './provider-detect'
import { readAgentSettings } from './agent-settings'
import { healMissingSessionCwd } from './session-cwd'
import { ensureCompactionReset } from './compaction-reset'
import { syncContextBudget, watchContextBudget } from './context-budget'
import { isRoutineSession } from '../routines/ownership'
import { listPackages } from './packages'
import { headroomSupervisor } from '../headroom/proxy'
import { getPrefs, recordWorkspace, realPathOrNull } from '../store'
import { gitInfoBatch } from '../fs/git-info'
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

  const {
    stub,
    binaryPath,
    prefixArgs,
    env: spawnEnv,
    extensions,
  } = await prepareDesktopSessionLaunch()

  // Worktree sessions get an explicit working-directory block: pi's own
  // `Current working directory:` line is correct but has been observed to
  // lose against a model rebuilding an absolute path from what it thinks
  // the project root is. Skipped for the stub, which speaks a fixed script.
  // The batched form for one path on purpose: it is the cached one, and the
  // sidebar has almost always just resolved this cwd, so creating a session
  // usually costs no git at all.
  const gitByPath = stub ? {} : await gitInfoBatch([options.workspacePath])
  const git = gitByPath[options.workspacePath] ?? { isRepo: false }
  // Layer 2 of the directive stack. `directives.ts` owns the order and the
  // reasoning; this only resolves which prefs apply. Per-project overrides key
  // on the repo of record, so every worktree of a repo gets the same rules.
  const projectKey = git.mainRepoPath ?? options.workspacePath
  const prefs = getPrefs()
  const directivePrefs = prefs.agentDirectivesByProject[projectKey] ?? prefs.agentDirectives
  const appendSystemPrompt = composeDirectives({
    cwd: options.workspacePath,
    git,
    prefs: directivePrefs,
    // Present only for a lane on its own branch. A session opened in the main
    // checkout is not a lane and is not told it owes a PR.
    ...(git.isWorktree && git.branch && execution.intent !== 'report'
      ? { charter: { branch: git.branch } }
      : {}),
  })

  // pi loads project context for EVERY provider. From pi-claude-cli 0.9.0 a
  // Claude session runs on that alone: pi's prompt, skills and tools, with the
  // CLI's own loaders, tools and compaction off. Older providers read pi's
  // prompt from a field pi 0.86+ leaves empty, so the separately installed
  // package is checked before a Claude session starts.
  const claudeProvider = stub
    ? false
    : usesClaudeCliProvider(
        options,
        (await readAgentSettings(options.workspacePath)).defaultProvider,
      )
  if (claudeProvider) assertClaudeContextProvider(await listPackages(options.workspacePath))

  // Which Claude login bills this session (Settings -> Claude Code ->
  // Accounts). One env var on the pi spawn is enough: pi-claude-cli spawns the
  // CLI with `{ ...process.env }`, and 0.7.0 keeps ONE CLI process per session,
  // so the credential is fixed for the session's whole life. Chosen here and
  // not later for exactly that reason — see electron/claude/routing.ts.
  const claudeAccount = claudeProvider
    ? await accountForSpawn({
        ...(options.sessionPath ? { sessionPath: options.sessionPath } : {}),
      }).catch(() => null)
    : null
  if (claudeAccount) Object.assign(spawnEnv, claudeAccountEnv(claudeAccount))

  // Headroom compression (Settings → Optimization). Set only when the managed
  // proxy is believed healthy — the bundled extension is inert without the
  // URL, and fails open even with a stale one. Env-only integration on
  // purpose: Phosphor never writes provider config for a proxy.
  if (!stub) Object.assign(spawnEnv, headroomSupervisor().sessionEnv())

  // Before pi starts, which is when it reads its settings.
  if (!stub) await ensureCompactionReset()

  execution.signal?.throwIfAborted()
  const session = registry.create(options.workspacePath, {
    ownProcessGroup: true,
    binaryPath,
    prefixArgs,
    sessionPath: options.sessionPath,
    forkFrom: options.forkFrom,
    name: options.name,
    model: options.model,
    provider: options.provider,
    thinkingLevel: options.thinkingLevel,
    ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
    // The bundled artifacts extension rides along in every session.
    ...(stub ? {} : { extensions }),
    env: spawnEnv,
  })

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
        claudeAccount &&
        request.method === 'setStatus' &&
        request.statusKey === RATE_LIMIT_STATUS_KEY
      ) {
        const until = accountExhaustedUntil(request.statusText)
        if (until !== null) void holdAccount(claudeAccount.id, until).catch(() => undefined)
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
  if (claudeAccount) rememberSpawnAccount(session.sessionId, claudeAccount.id)

  // Background automation must not overwrite the user's launch-resume folder.
  if (!execution.unattended) recordWorkspace(options.workspacePath, basename(options.workspacePath))
  return {
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    pid: session.client.pid,
  }
}
