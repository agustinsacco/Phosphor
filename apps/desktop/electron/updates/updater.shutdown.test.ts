import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const f = vi.hoisted(() => ({
  signed: false,
  latest: '2.0.0',
  discard: vi.fn(),
  approve: vi.fn(),
  release: vi.fn(),
  ready: vi.fn(),
  swap: vi.fn(),
  relaunch: vi.fn(),
  quit: vi.fn(),
  install: vi.fn(),
  handlers: new Map<string, (value: unknown) => void>(),
}))
vi.mock('node:fs', () => ({ readFileSync: () => JSON.stringify({ phosphorSigned: f.signed }) }))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => '/app',
    getAppPath: () => '/app',
    getVersion: () => '1.0.0',
    quit: f.quit,
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
}))
vi.mock('../debug-log', () => ({ log: vi.fn() }))
vi.mock('../shutdown-approval', () => ({
  shutdownApproval: {
    request: f.approve,
    releaseFailedUpdate: f.release,
    allowUpdateQuit: f.ready,
  },
}))
vi.mock('./mac-installer', () => ({
  bundlePathFromExe: () => '/app',
  canSwapBundle: async () => true,
  discardStagedUpdate: f.discard,
  parseMacManifest: () => ({ version: f.latest, files: [] }),
  pickMacZip: () => ({ url: 'update.zip', sha512: 'hash' }),
  stageMacUpdate: async ({ version }: { version: string }) => ({
    version,
    stagingDir: `/stage-${version}`,
  }),
  swapBundle: f.swap,
  spawnRelauncher: f.relaunch,
  sweepOrphans: async () => [],
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: (event: string, handler: (value: unknown) => void) => f.handlers.set(event, handler),
      checkForUpdates: async () => {
        f.handlers.get('update-available')?.({ version: '2.0.0' })
        f.handlers.get('update-downloaded')?.({ version: '2.0.0' })
      },
      quitAndInstall: f.install,
    },
  },
}))
const platform = process.platform
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, text: async () => 'manifest' })),
  )
  f.signed = false
  f.latest = '2.0.0'
  f.handlers.clear()
  f.discard.mockResolvedValue(undefined)
  f.approve.mockResolvedValue(true)
  f.swap.mockResolvedValue('/backup')
  f.relaunch.mockResolvedValue(undefined)
})
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform })
  vi.unstubAllGlobals()
})

it('does not swap, relaunch, or quit when update approval is cancelled', async () => {
  const updater = await import('./updater')
  await updater.checkForUpdates()
  expect(updater.currentUpdateState().phase).toBe('downloaded')
  f.approve.mockResolvedValue(false)
  await updater.restartAndInstall()
  expect(f.swap).not.toHaveBeenCalled()
  expect(f.relaunch).not.toHaveBeenCalled()
  expect(f.quit).not.toHaveBeenCalled()
})

it('approves before bundle replacement and releases quit only after relaunch preparation', async () => {
  const updater = await import('./updater')
  await updater.checkForUpdates()
  await updater.restartAndInstall()
  const order = [f.approve, f.swap, f.relaunch, f.ready, f.quit].map(
    (fn) => fn.mock.invocationCallOrder[0]!,
  )
  expect(order.every(Number.isInteger)).toBe(true)
  expect(order).toEqual([...order].sort((a, b) => a - b))
})

it('restores admission when macOS installation fails, without quitting', async () => {
  const updater = await import('./updater')
  await updater.checkForUpdates()
  f.swap.mockRejectedValueOnce(new Error('permission denied'))
  await updater.restartAndInstall()
  expect(f.release).toHaveBeenCalledTimes(1)
  expect(f.quit).not.toHaveBeenCalled()
  expect(f.discard).toHaveBeenCalledExactlyOnceWith({
    version: '2.0.0',
    stagingDir: '/stage-2.0.0',
  })
})

it('discards a staged update once a newer release replaces it', async () => {
  const updater = await import('./updater')
  await updater.checkForUpdates()
  expect(updater.currentUpdateState()).toMatchObject({ phase: 'downloaded', version: '2.0.0' })
  const phases: string[] = []
  f.discard.mockImplementation(async () => {
    phases.push(updater.currentUpdateState().phase)
  })

  f.latest = '2.1.0'
  await updater.checkForUpdates()
  await updater.checkForUpdates()

  expect(f.discard).toHaveBeenCalledExactlyOnceWith({
    version: '2.0.0',
    stagingDir: '/stage-2.0.0',
  })
  // Never while `downloaded`: restartAndInstall must not pick it up mid-delete.
  expect(phases).toEqual(['downloading'])
  expect(updater.currentUpdateState()).toMatchObject({ phase: 'downloaded', version: '2.1.0' })
})

it('never discards the bundle an install is swapping in', async () => {
  const updater = await import('./updater')
  await updater.checkForUpdates()
  f.swap.mockImplementation(async () => {
    // The periodic check lands mid-swap and finds a newer release.
    f.latest = '2.1.0'
    await updater.checkForUpdates()
    return '/backup'
  })

  await updater.restartAndInstall()

  expect(f.discard).not.toHaveBeenCalled()
  expect(f.quit).toHaveBeenCalledTimes(1)
})

it('also gates electron-updater before quitAndInstall', async () => {
  f.signed = true
  const updater = await import('./updater')
  updater.startUpdateChecks()
  try {
    await vi.waitFor(() => expect(updater.currentUpdateState().phase).toBe('downloaded'))
    f.approve.mockResolvedValueOnce(false)
    await updater.restartAndInstall()
    expect(f.install).not.toHaveBeenCalled()
    await updater.restartAndInstall()
    expect(f.install).toHaveBeenCalledExactlyOnceWith(false, true)
    expect(f.ready.mock.invocationCallOrder[0]).toBeLessThan(f.install.mock.invocationCallOrder[0]!)
  } finally {
    updater.stopUpdateChecks()
  }
})
