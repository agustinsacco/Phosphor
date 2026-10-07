import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'

const appRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
const preload = fileURLToPath(new URL('desktop-electron-loader.cjs', import.meta.url))

/**
 * Playwright only prepends its Electron loader when executablePath is omitted.
 * Keep the app-owned executable without losing the installed loader's screenshot
 * switches and readiness handshake. This is test/capture setup, not app startup.
 */
export function desktopElectronLaunchOptions(args) {
  return {
    executablePath: appRequire('electron'),
    args: ['-r', preload, ...args],
  }
}
