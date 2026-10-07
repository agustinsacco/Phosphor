import { BrowserWindow } from 'electron'

/**
 * Send a push to every open window.
 *
 * For state no single window owns. A per-window `webContents.send` is the
 * default; this is for main-initiated events (an MCP auth flow completing)
 * that any window may be showing.
 */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
