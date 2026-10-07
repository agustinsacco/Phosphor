import { basename } from 'node:path'

/**
 * Busy heuristic from a PTY's foreground process title (node-pty's
 * `IPty.process`): a shell sitting at its prompt reports the shell itself
 * (possibly as a `-zsh` login shell or a full path); anything else means a
 * foreground command is running. Pure and separate from pty-manager so tests
 * don't need node-pty/electron.
 */
export function isBusy(processTitle: string | undefined, shellName: string): boolean {
  if (!processTitle) return false
  const title = basename(processTitle.trim()).replace(/^-/, '')
  if (!title) return false
  return title !== shellName
}
