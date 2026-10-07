/**
 * On-disk debug log for the main process.
 *
 * Written because a real debugging session had nothing to work from. Every
 * `pi-claude-cli` turn was failing with `Error: Claude CLI returned success`,
 * a message that is self-contradictory and names no cause. The actual reason
 * (`API Error: Effort 'max' isn't available with thinking turned off`) existed
 * only inside the Claude CLI's own transcript under `~/.claude/projects/`.
 * Phosphor had already received the failing turn and kept nothing: pi's stderr
 * was forwarded to the renderer and dropped, and the app wrote no log at all.
 * Reconstructing it took shimming the `claude` binary to capture argv.
 *
 * Deliberately dependency-free and always-on. A log that must be enabled first
 * is never on when the bug happens — the failure has already occurred by the
 * time anyone thinks to look. Cost is bounded by size-capped rotation.
 *
 * NOT for the renderer: it is sandboxed and has no disk access by design.
 * Renderer-side problems surface through DevTools.
 */
import { app } from 'electron'
import { createFileLog } from '@phosphor/session-runtime/file-log'

const fileLog = createFileLog()
let failed = false

/** Absolute path of the current log file, or null before init. */
export function debugLogPath(): string | null {
  return failed ? null : fileLog.path()
}

/**
 * Resolve the log path and record a session header.
 *
 * Call once from `whenReady` — `app.getPath('logs')` is only meaningful after
 * the app is ready, and main.ts may redirect `userData` before that for E2E.
 */
export function initDebugLog(): void {
  if (fileLog.path() || failed) return
  try {
    fileLog.init(app.getPath('logs'))
    log('app', 'session start', {
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: `${process.platform}/${process.arch}`,
      packaged: app.isPackaged,
      // The single most useful line when a subprocess "isn't found": a GUI app
      // inherits launchd's PATH, not the login shell's, so `pi` and `claude`
      // may resolve differently here than in a terminal.
      path: process.env.PATH ?? '(unset)',
    })
  } catch {
    // Logging must never take the app down with it.
    failed = true
  }
}

/**
 * Append one line. Never throws.
 *
 * Synchronous on purpose: a crash-time write has to land before the process
 * goes away, and an async append can lose exactly the line that explains why.
 */
export function log(scope: string, message: string, data?: unknown): void {
  if (!failed) fileLog.write(scope, message, data)
}
