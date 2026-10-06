import { expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { BUNDLED_EXTENSION_FILES } from '../bundled-extensions'
import { prepareSessionLaunch, type SessionLaunchRuntime } from './session-launch'

vi.mock('electron', () => {
  throw new Error('Launch preparation imported Electron')
})

function ports() {
  return {
    resolveExecutable: vi.fn<SessionLaunchRuntime['resolveExecutable']>().mockResolvedValue({
      agent: 'pi',
      binaryPath: '/tools/node',
      prefixArgs: ['/tools/pi.js'],
      stub: false,
    }),
    forkSession: vi.fn(async () => '/sessions/copy.jsonl'),
    readEnvironment: vi.fn(async () => ({ PATH: '/tools', CONFIG: 'host-local' })),
    resourceRoot: vi.fn(() => '/host/resources'),
  }
}

it.each(['pi', 'omp'] as const)(
  'preserves %s executable, prefix, environment and resume options',
  async (agent) => {
    const runtime = ports()
    const executable = {
      agent,
      binaryPath: '/tools/node',
      prefixArgs: ['/tools/agent.js'],
      stub: false,
    }
    runtime.resolveExecutable.mockResolvedValue(executable)
    const launch = await prepareSessionLaunch({ sessionPath: '/sessions/existing.jsonl' }, runtime)
    expect(launch).toEqual({
      ...executable,
      sessionPath: '/sessions/existing.jsonl',
      forkFrom: undefined,
      env: { PATH: '/tools', CONFIG: 'host-local' },
      extensions: BUNDLED_EXTENSION_FILES.map((file) => join('/host/resources', 'pi-ext', file)),
    })
    expect(runtime.readEnvironment).toHaveBeenCalledExactlyOnceWith(executable)
    expect(runtime.forkSession).not.toHaveBeenCalled()
  },
)

it('leaves pi forks to the CLI, but copies omp forks before reading the environment', async () => {
  const runtime = ports()
  const options = { sessionPath: '/old', forkFrom: '/parent' }
  expect(await prepareSessionLaunch(options, runtime)).toMatchObject(options)
  expect(runtime.forkSession).not.toHaveBeenCalled()
  runtime.resolveExecutable.mockResolvedValue({ agent: 'omp', stub: false })
  runtime.readEnvironment.mockClear()
  expect(await prepareSessionLaunch(options, runtime)).toMatchObject({
    sessionPath: '/sessions/copy.jsonl',
    forkFrom: undefined,
  })
  expect(runtime.forkSession).toHaveBeenCalledExactlyOnceWith('/parent')
  expect(runtime.forkSession.mock.invocationCallOrder[0]).toBeLessThan(
    runtime.readEnvironment.mock.invocationCallOrder[0]!,
  )
  expect(options).toEqual({ sessionPath: '/old', forkFrom: '/parent' })
})

it('reads dependencies anew and does not share mutable launch environments', async () => {
  const runtime = ports()
  const cachedEnv = { PATH: '/tools', CONFIG: 'host-local' }
  runtime.readEnvironment.mockResolvedValue(cachedEnv)
  const first = await prepareSessionLaunch({}, runtime)
  first.env.ACCOUNT = 'first-session-only'
  runtime.resourceRoot.mockReturnValue('/new/resources')
  const second = await prepareSessionLaunch({}, runtime)
  expect(second.env).not.toHaveProperty('ACCOUNT')
  expect(cachedEnv).not.toHaveProperty('ACCOUNT')
  expect(second.extensions[0]).toBe(join('/new/resources', 'pi-ext', 'artifacts.ts'))
  expect(runtime.resolveExecutable).toHaveBeenCalledTimes(2)
  expect(runtime.readEnvironment).toHaveBeenCalledTimes(2)
})

it('does not fork or read environment/resources when executable discovery fails', async () => {
  const runtime = ports()
  runtime.resolveExecutable.mockRejectedValue(new Error('Unavailable'))
  await expect(prepareSessionLaunch({ forkFrom: '/parent' }, runtime)).rejects.toThrow(
    'Unavailable',
  )
  expect(runtime.forkSession).not.toHaveBeenCalled()
  expect(runtime.readEnvironment).not.toHaveBeenCalled()
  expect(runtime.resourceRoot).not.toHaveBeenCalled()
})

it('propagates fork and environment failures without continuing preparation', async () => {
  const runtime = ports()
  runtime.resolveExecutable.mockResolvedValue({ agent: 'omp', stub: false })
  runtime.forkSession.mockRejectedValue(new Error('Copy failed'))
  await expect(prepareSessionLaunch({ forkFrom: '/parent' }, runtime)).rejects.toThrow(
    'Copy failed',
  )
  expect(runtime.readEnvironment).not.toHaveBeenCalled()
  runtime.readEnvironment.mockRejectedValue(new Error('Environment failed'))
  await expect(prepareSessionLaunch({}, runtime)).rejects.toThrow('Environment failed')
  expect(runtime.resourceRoot).not.toHaveBeenCalled()
})
