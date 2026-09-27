import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  sessionContextBudget,
  contextBudgetTokens,
  isValidContextBudgetValue,
} from './context-budget'

describe('contextBudgetTokens', () => {
  it('resolves unset to the default budget', () => {
    expect(contextBudgetTokens('')).toBe(DEFAULT_CONTEXT_BUDGET_TOKENS)
    expect(contextBudgetTokens('   ')).toBe(DEFAULT_CONTEXT_BUDGET_TOKENS)
  })

  it('reads every accepted form as a token count', () => {
    expect(contextBudgetTokens('300k')).toBe(300_000)
    expect(contextBudgetTokens('0.5M')).toBe(500_000)
    expect(contextBudgetTokens('400000')).toBe(400_000)
    // Bare numbers are thousands — "500" is a 500k budget, the reading the
    // enforcer and the meter must share or the meter's percentages lie.
    expect(contextBudgetTokens('500')).toBe(500_000)
  })

  it('has no budget for auto or off', () => {
    expect(contextBudgetTokens('auto')).toBeNull()
    expect(contextBudgetTokens('OFF')).toBeNull()
  })

  it('falls back to the default for anything out of range or malformed', () => {
    expect(contextBudgetTokens('77k')).toBe(DEFAULT_CONTEXT_BUDGET_TOKENS)
    expect(contextBudgetTokens('2M')).toBe(DEFAULT_CONTEXT_BUDGET_TOKENS)
    expect(contextBudgetTokens('lots')).toBe(DEFAULT_CONTEXT_BUDGET_TOKENS)
  })
})

describe('isValidContextBudgetValue', () => {
  it('accepts keywords', () => {
    expect(isValidContextBudgetValue('auto')).toBe(true)
    expect(isValidContextBudgetValue('AUTO')).toBe(true)
    expect(isValidContextBudgetValue('off')).toBe(true)
  })

  it('accepts budgets from 100k to 1M in every accepted form', () => {
    expect(isValidContextBudgetValue('100k')).toBe(true)
    expect(isValidContextBudgetValue('300k')).toBe(true)
    expect(isValidContextBudgetValue('0.5M')).toBe(true)
    expect(isValidContextBudgetValue('1m')).toBe(true)
    expect(isValidContextBudgetValue('400000')).toBe(true)
    // Bare numbers are thousands.
    expect(isValidContextBudgetValue('400')).toBe(true)
    expect(isValidContextBudgetValue('100')).toBe(true)
  })

  it('rejects well-formed values outside the range — they would silently mean the default', () => {
    expect(isValidContextBudgetValue('77k')).toBe(false)
    expect(isValidContextBudgetValue('99')).toBe(false)
    expect(isValidContextBudgetValue('2M')).toBe(false)
    expect(isValidContextBudgetValue('1000001')).toBe(false)
  })

  it('rejects junk', () => {
    expect(isValidContextBudgetValue('')).toBe(false)
    expect(isValidContextBudgetValue('lots')).toBe(false)
    expect(isValidContextBudgetValue('40%')).toBe(false)
    expect(isValidContextBudgetValue('-200k')).toBe(false)
    expect(isValidContextBudgetValue('0')).toBe(false)
  })
})

describe('sessionContextBudget', () => {
  const session = (over: Partial<Parameters<typeof sessionContextBudget>[0]>) =>
    sessionContextBudget({
      raw: '',
      contextWindow: 1_000_000,
      autoCompactionEnabled: true,
      ...over,
    })

  it('holds a session whose window is larger than the budget', () => {
    expect(session({})).toBe(200_000)
    expect(session({ raw: '400k' })).toBe(400_000)
    expect(session({ raw: '500' })).toBe(500_000)
    expect(session({ contextWindow: 272_000 })).toBe(200_000)
  })

  it("leaves pi's own threshold in charge when the window is no larger than the budget", () => {
    // pi fires at window - reserveTokens (~183k here) before 200k is reached.
    expect(session({ contextWindow: 200_000 })).toBeNull()
    expect(session({ contextWindow: 128_000 })).toBeNull()
    expect(session({ raw: '400k', contextWindow: 272_000 })).toBeNull()
  })

  it('has no budget without a known window', () => {
    expect(session({ contextWindow: undefined })).toBeNull()
    expect(session({ contextWindow: null })).toBeNull()
    expect(session({ contextWindow: 0 })).toBeNull()
  })

  it('follows the ⋮ auto-compaction toggle', () => {
    expect(session({ autoCompactionEnabled: false })).toBeNull()
  })

  it('has no budget for auto or off', () => {
    expect(session({ raw: 'auto' })).toBeNull()
    expect(session({ raw: 'off' })).toBeNull()
  })
})
