// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExtensionUiStore } from './extensionUi'
import { useConnectorsStore } from './connectors'

const invoke = vi.fn(async (..._args: unknown[]) => undefined)

beforeEach(() => {
  invoke.mockClear()
  useExtensionUiStore.setState({ dialogs: [], statuses: {}, widgets: {}, toasts: [] })
  useConnectorsStore.setState({ flows: {} })
  // @ts-expect-error partial preload surface
  window.phosphor = { invoke }
})

const oauthRequest = {
  type: 'extension_ui_request' as const,
  id: 'req-1',
  method: 'input' as const,
  title:
    'Complete linear OAuth\n\nhttps://linear.app/oauth/authorize?state=1\n\n' +
    'Approve access, then paste the full localhost callback URL below.',
}

describe('extension UI requests', () => {
  it('routes the adapter OAuth prompt to the connector flow, not to a dialog', () => {
    useExtensionUiStore.getState().handleRequest('s1', oauthRequest)
    expect(useExtensionUiStore.getState().dialogs).toEqual([])
    expect(useConnectorsStore.getState().flows.linear).toMatchObject({
      phase: 'awaiting-browser',
      requestId: 'req-1',
    })
    expect(invoke).toHaveBeenCalledWith(
      'app:openExternal',
      'https://linear.app/oauth/authorize?state=1',
    )
  })

  it('leaves every other input prompt as an ordinary dialog', () => {
    useExtensionUiStore.getState().handleRequest('s1', {
      type: 'extension_ui_request',
      id: 'req-2',
      method: 'input',
      title: 'Commit message?',
    })
    expect(useExtensionUiStore.getState().dialogs).toHaveLength(1)
  })

  it('settles a flow on the adapter notification, and still shows the toast', () => {
    useExtensionUiStore.getState().handleRequest('s1', oauthRequest)
    useExtensionUiStore.getState().handleRequest('s1', {
      type: 'extension_ui_request',
      id: 'req-3',
      method: 'notify',
      message: 'OAuth authentication successful for "linear".',
    })
    expect(useConnectorsStore.getState().flows.linear).toEqual({ phase: 'connected' })
    expect(useExtensionUiStore.getState().toasts).toHaveLength(1)
  })

  it('settles a Settings reload on the adapter reconnect notice, and still shows the toast', async () => {
    const piCommand = vi.fn(async () => ({ success: true, data: undefined }))
    // @ts-expect-error partial preload surface
    window.phosphor = { invoke, piCommand }
    const reload = useConnectorsStore.getState().reload('s1', 'linear')
    useExtensionUiStore.getState().handleRequest('s1', {
      type: 'extension_ui_request',
      id: 'req-4',
      method: 'notify',
      message: 'MCP: Reconnected to linear (81 tools, 0 resources)',
    })
    await expect(reload).resolves.toMatchObject({ outcome: 'connected', toolCount: 81 })
    expect(useExtensionUiStore.getState().toasts).toHaveLength(1)
  })
})

describe('sub-agent inspect replies', () => {
  const reply = (requestId: string): string =>
    'PI_SUBAGENT_INSPECT_JSON:' +
    JSON.stringify({ kind: 'pi-subagents.inspect-reply', version: 1, requestId, status: 'running' })

  const setWidget = (lines?: string[]): void =>
    useExtensionUiStore.getState().handleRequest('s1', {
      type: 'extension_ui_request',
      id: `w-${Math.random()}`,
      method: 'setWidget',
      widgetKey: 'subagent-inspect',
      widgetLines: lines,
    })

  beforeEach(() => useExtensionUiStore.setState({ inspectReplies: {} }))

  it('keeps a reply by request id across the set-then-clear, never as a widget', () => {
    setWidget([reply('req-1')])
    setWidget(undefined)
    expect(useExtensionUiStore.getState().widgets.s1?.['subagent-inspect']).toBeUndefined()
    expect(useExtensionUiStore.getState().takeInspectReply('req-1')).toMatchObject({
      requestId: 'req-1',
      status: 'running',
    })
    // Claimed once.
    expect(useExtensionUiStore.getState().takeInspectReply('req-1')).toBeUndefined()
  })

  it('drops unclaimed replies oldest first', () => {
    for (let i = 0; i < 20; i++) setWidget([reply(`req-${i}`)])
    const kept = Object.keys(useExtensionUiStore.getState().inspectReplies)
    expect(kept).toHaveLength(16)
    expect(kept).not.toContain('req-0')
    expect(kept).toContain('req-19')
  })
})
