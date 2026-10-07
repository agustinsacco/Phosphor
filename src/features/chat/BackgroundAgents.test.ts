import { describe, expect, it } from 'vitest'
import { agentActivityLine, elapsedLabel } from './BackgroundAgents'

describe('elapsedLabel', () => {
  it('stays coarse for long background runs', () => {
    expect(elapsedLabel(45_000)).toBe('45s')
    expect(elapsedLabel(12 * 60_000 + 30_000)).toBe('12m')
    expect(elapsedLabel(64 * 60_000)).toBe('1h 4m')
    expect(elapsedLabel(-5)).toBe('0s')
  })
})

describe('agentActivityLine', () => {
  const base = { id: 'r', runId: 'r', label: 'worker', attention: false }

  it('says how long the current tool has been running, then the counts', () => {
    expect(
      agentActivityLine(
        { ...base, currentTool: 'bash', currentToolStartedAt: 0, toolCount: 52, turnCount: 47 },
        240_000,
      ),
    ).toBe('bash for 4m · 52 tools · 47 turns')
  })

  it('reads a row with no tool open as thinking', () => {
    expect(agentActivityLine({ ...base, toolCount: 3 }, 0)).toBe('thinking · 3 tools')
    expect(agentActivityLine({ ...base, toolCount: 1, turnCount: 1 }, 0)).toBe(
      'thinking · 1 tool · 1 turn',
    )
  })
})
