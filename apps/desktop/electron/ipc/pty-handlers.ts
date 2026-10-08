import { handle } from './handle'
import { ptyManager } from '../pty/pty-manager'

/** Terminal PTY lifecycle. */
export function registerPtyHandlers(): void {
  handle('pty:create', (_event, workspacePath, cols, rows, sessionId) =>
    ptyManager.create(workspacePath, cols, rows, sessionId),
  )

  handle('pty:attach', (_event, ptyId) => ptyManager.attach(ptyId))

  handle('pty:write', (_event, ptyId, data) => {
    ptyManager.write(ptyId, data)
  })

  handle('pty:resize', (_event, ptyId, cols, rows) => {
    ptyManager.resize(ptyId, cols, rows)
  })

  handle('pty:kill', (_event, ptyId) => {
    ptyManager.kill(ptyId)
  })
}
