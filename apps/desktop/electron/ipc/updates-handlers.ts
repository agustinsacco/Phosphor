import { handle } from './handle'
import { checkForUpdates, currentUpdateState, restartAndInstall } from '../updates/updater'

/**
 * Auto-update lifecycle.
 *
 * The renderer never drives the schedule — main polls on its own timer and
 * pushes state. These channels exist so a freshly opened window can read the
 * current state, and so the user can act on it.
 */
export function registerUpdateHandlers(): void {
  handle('updates:state', () => currentUpdateState())

  handle('updates:check', () => checkForUpdates())

  handle('updates:restartAndInstall', () => restartAndInstall())
}
