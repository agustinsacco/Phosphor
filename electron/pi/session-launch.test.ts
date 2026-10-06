import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { PiHealth } from '@shared/models'
import { prepareDesktopSessionLaunch } from './session-launch'

const h = vi.hoisted(() => ({
  app: { isPackaged: false, getAppPath: vi.fn(() => '/desktop/source') },
  health: vi.fn<() => Promise<PiHealth>>(),
  fork: vi.fn(async () => '/sessions/fork'),
  environment: vi.fn(async () => ({ PATH: '/login-shell/bin', PI_CLAUDE_CLI_CONTEXT: 'old' })),
  provider: vi.fn(() => ({ PI_CLAUDE_CLI_CONTEXT: 'pi' })),
}))
vi.mock('electron', () => ({ app: h.app }))
vi.mock('./health', () => ({ cachedAgentHealth: h.health }))
vi.mock('./session-writer', () => ({ forkSessionFile: h.fork }))
vi.mock('./shell-env', () => ({ piProcessEnv: h.environment }))
vi.mock('./provider-detect', () => ({ claudeProviderSpawnEnv: h.provider }))

const originalResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
beforeEach(() => {
  vi.clearAllMocks()
  h.app.isPackaged = false
  h.health.mockResolvedValue({
    ok: true,
    agent: 'pi',
    binaryPath: '/tools/node',
    prefixArgs: ['/tools/pi.js'],
  })
  vi.stubEnv('PHOSPHOR_PI_STUB', '')
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: '/desktop/resources',
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  if (originalResources) Object.defineProperty(process, 'resourcesPath', originalResources)
  else Reflect.deleteProperty(process, 'resourcesPath')
})

it('retains shell PATH, provider overrides, Windows prefix arguments and dev resources', async () => {
  const launch = await prepareDesktopSessionLaunch({ forkFrom: '/parent' })
  expect(launch).toMatchObject({
    agent: 'pi',
    binaryPath: '/tools/node',
    prefixArgs: ['/tools/pi.js'],
    stub: false,
    forkFrom: '/parent',
    env: { PATH: '/login-shell/bin', PI_CLAUDE_CLI_CONTEXT: 'pi' },
  })
  expect(launch.extensions[0]).toBe(join('/desktop/source', 'pi-ext', 'artifacts.ts'))
  expect(h.fork).not.toHaveBeenCalled()
})

it('keeps the unpackaged stub on pi and bypasses real discovery, environment and forks', async () => {
  vi.stubEnv('PHOSPHOR_PI_STUB', '/fake-pi.cjs')
  h.health.mockResolvedValue({ ok: true, agent: 'omp' })
  expect(await prepareDesktopSessionLaunch({ forkFrom: '/parent' })).toMatchObject({
    stub: true,
    agent: 'pi',
    binaryPath: process.execPath,
    prefixArgs: ['/fake-pi.cjs'],
    forkFrom: '/parent',
    env: { ELECTRON_RUN_AS_NODE: '1' },
  })
  expect(h.health).not.toHaveBeenCalled()
  expect(h.environment).not.toHaveBeenCalled()
  expect(h.provider).not.toHaveBeenCalled()
  expect(h.fork).not.toHaveBeenCalled()
})

it('ignores the stub in a packaged app and uses real omp discovery and packaged resources', async () => {
  h.app.isPackaged = true
  vi.stubEnv('PHOSPHOR_PI_STUB', '/untrusted.cjs')
  h.health.mockResolvedValue({ ok: true, agent: 'omp', binaryPath: '/tools/omp' })
  const launch = await prepareDesktopSessionLaunch({ forkFrom: '/parent' })
  expect(launch).toMatchObject({
    stub: false,
    agent: 'omp',
    binaryPath: '/tools/omp',
    sessionPath: '/sessions/fork',
    forkFrom: undefined,
  })
  expect(launch.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
  expect(launch.extensions[0]).toBe(join('/desktop/resources', 'pi-ext', 'artifacts.ts'))
  expect(h.app.getAppPath).not.toHaveBeenCalled()
  expect(h.fork).toHaveBeenCalledExactlyOnceWith('/parent')
})

it.each([
  ['Custom failure', 'Custom failure'],
  [undefined, 'omp is not available'],
])('preserves health errors (%s)', async (message, expected) => {
  h.health.mockResolvedValue({ ok: false, agent: 'omp', message })
  await expect(prepareDesktopSessionLaunch({})).rejects.toThrow(expected!)
  expect(h.environment).not.toHaveBeenCalled()
  expect(h.app.getAppPath).not.toHaveBeenCalled()
})
