import { expect, it, vi } from 'vitest'
import type { PiEvent, ExtensionUIRequest } from '@shared/rpc'
import { PiRpcClient } from './rpc-client'
import { bindSessionEvents, type SessionEventRuntime } from './session-events'

vi.mock('electron', () => {
  throw new Error('Session events imported Electron')
})

function fixture() {
  const order: string[] = []
  const client = new PiRpcClient({ cwd: '/workspace' }, { log: vi.fn(), isClosing: () => false })
  const runtime: SessionEventRuntime = {
    emit: vi.fn((payload) => {
      order.push(payload.kind)
    }),
    log: vi.fn(() => {
      order.push('log')
    }),
    onExtensionUI: vi.fn(() => {
      order.push('account-policy')
    }),
    budget: {
      watch: vi.fn((_id, observed) => {
        observed.on('event', () => {
          order.push('budget-event')
        })
        observed.on('exit', () => {
          order.push('budget-exit')
        })
      }),
      read: () => '200k',
      paused: () => false,
    },
  }
  bindSessionEvents({ sessionId: 'session', workspacePath: '/workspace', client }, runtime)
  return { client, runtime, order }
}

it('forwards whole events before budget observation and retains the live policy callbacks', () => {
  const { client, runtime, order } = fixture()
  const event: PiEvent = { type: 'agent_end', messages: [{ role: 'user', content: 'complete' }] }
  client.emit('event', event)
  expect(runtime.emit).toHaveBeenCalledExactlyOnceWith({ kind: 'event', event })
  expect(event.messages).toHaveLength(1)
  expect(order).toEqual(['event', 'budget-event'])
  expect(runtime.budget.watch).toHaveBeenCalledExactlyOnceWith(
    'session',
    client,
    runtime.budget.read,
    runtime.budget.paused,
  )
})

it('observes extension/account policy before emitting, without suppressing dialogs', () => {
  const { client, runtime, order } = fixture()
  const request: ExtensionUIRequest = {
    type: 'extension_ui_request',
    id: 'ask',
    method: 'input',
    title: 'Question',
  }
  client.emit('extension-ui', request)
  expect(runtime.onExtensionUI).toHaveBeenCalledExactlyOnceWith(request)
  expect(runtime.emit).toHaveBeenCalledExactlyOnceWith({ kind: 'extension-ui', request })
  expect(order).toEqual(['account-policy', 'extension-ui'])
})

it.each([true, false])(
  'keeps stderr logging and exit cleanup/notification order (expected=%s)',
  (expected) => {
    const { client, runtime, order } = fixture()
    client.emit('stderr', 'provider failed')
    expect(order).toEqual(['log', 'stderr'])
    expect(runtime.log).toHaveBeenCalledWith('pi', 'stderr', {
      sessionId: 'session',
      text: 'provider failed',
    })
    order.length = 0
    client.emit('exit', { code: 1, signal: null, expected })
    expect(order).toEqual(expected ? ['budget-exit', 'exit'] : ['budget-exit', 'log', 'exit'])
    expect(runtime.emit).toHaveBeenLastCalledWith({ kind: 'exit', code: 1, signal: null, expected })
    expect(runtime.log).toHaveBeenCalledTimes(expected ? 1 : 2)
  },
)
