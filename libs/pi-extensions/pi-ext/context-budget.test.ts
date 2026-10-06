import { describe, expect, it, vi } from 'vitest'
import contextBudget from './context-budget'

function setup(window = 1_000_000) {
  const original = { provider: 'pi-claude-cli', id: 'opus', contextWindow: window }
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>()
  let command!: (args: string, context: typeof ctx) => Promise<void>
  let idle = true
  let thinking = 'xhigh'
  const ctx = {
    model: original,
    isIdle: () => idle,
    modelRegistry: { find: () => original },
  }
  const select = vi.fn(async (model: typeof original) => {
    ctx.model = model
    thinking = 'off' // pi.setModel can reset effort to a saved per-model default.
    await handlers.get('model_select')?.({}, ctx)
    return true
  })
  contextBudget({
    on: (event, handler) => {
      handlers.set(event, handler)
    },
    setModel: select,
    getThinkingLevel: () => thinking,
    setThinkingLevel: (value) => {
      thinking = value
    },
    registerCommand: (_name, spec) => {
      command = spec.handler
    },
  })
  return {
    original,
    ctx,
    select,
    thinking: () => thinking,
    command: (s: string) => command(s, ctx),
    busy: () => {
      idle = false
    },
    event: (s: string) => handlers.get(s)?.({}, ctx),
  }
}

describe('pi-native budget window', () => {
  it('caps a clone without changing catalogue capacity or recursing on model_select', async () => {
    const s = setup()
    await s.command('400000')
    expect(s.ctx.model.contextWindow).toBe(400_000)
    expect(s.original.contextWindow).toBe(1_000_000)
    expect(s.select).toHaveBeenCalledOnce()
    expect(s.thinking()).toBe('xhigh')
  })
  it('stages changes during a run, then applies at a tool boundary, not during tool execution', async () => {
    const s = setup()
    s.busy()
    await s.command('400000')
    expect(s.select).not.toHaveBeenCalled()
    await s.event('turn_end')
    expect(s.ctx.model.contextWindow).toBe(400_000)
    for (let i = 0; i < 300; i++) await s.event('turn_end')
    expect(s.select).toHaveBeenCalledOnce()
    await s.command('off')
    expect(s.ctx.model.contextWindow).toBe(400_000)
    await s.event('turn_end')
    expect(s.ctx.model.contextWindow).toBe(1_000_000)
  })
  it('applies before a resumed prompt and after a model switch', async () => {
    const s = setup()
    s.busy()
    await s.command('400000')
    await s.event('before_agent_start')
    s.ctx.model = s.original
    await s.event('model_select')
    expect(s.ctx.model.contextWindow).toBe(400_000)
  })
  it('never enlarges smaller windows and restores when opted out', async () => {
    const s = setup(200_000)
    await s.command('400000')
    expect(s.select).not.toHaveBeenCalled()
    await s.command('100000')
    await s.command('off')
    expect(s.ctx.model.contextWindow).toBe(200_000)
  })
  it.each(['0', 'NaN', '99999', '1000001', '100000.5'])(
    'rejects invalid control %s',
    async (raw) => {
      await expect(setup().command(raw)).rejects.toThrow('Invalid')
    },
  )
})
