import { describe, expect, it } from 'vitest'
import request from './__fixtures__/subagent-supervisor-request.json'
import { subagentHistory } from './subagentHistory'
import { hasDelegatedWork, parseFleetWidget, summarizeFleet } from './subagentRuns'

const ask = { type: 'custom_message', id: 'ask', parentId: null, ...request }
const reply = {
  type: 'custom',
  id: 'reply',
  parentId: 'ask',
  customType: 'subagent_supervisor_reply',
  data: { ...request.details, message: 'Use the shared parser.', createdAt: 1788000000020 },
}

describe('branch-aware recorded coordination', () => {
  it('replays exact questions and plain-state replies, even before compaction', () => {
    const compact = { type: 'compaction', id: 'compact', parentId: 'reply' }
    const unrelated = { ...reply, id: 'other', parentId: 'ask', data: { message: 'Wrong branch' } }
    const history = subagentHistory([ask, reply, compact, unrelated], 'compact')
    expect(history.items.map((i) => i.id)).toEqual(['ask', 'reply'])
    expect(history.items[1]).toMatchObject({
      inContext: false,
      details: reply.data,
      text: 'Use the shared parser.',
    })
    expect(subagentHistory([ask, reply], 'ask').items.map((i) => i.id)).toEqual(['ask'])
  })
  it('fails closed for missing leaves, empty branches and cycles', () => {
    expect(() => subagentHistory([ask, reply], 'missing')).toThrow('unavailable')
    expect(subagentHistory([ask, reply], null).items).toEqual([])
    expect(subagentHistory([{ ...ask, parentId: 'reply' }, reply], 'reply').items).toEqual([])
  })
  it('ignores unrelated extension state and malformed entries', () => {
    expect(
      subagentHistory([null, [], 42, { ...ask, customType: 'another-extension' }], 'ask').items,
    ).toEqual([])
  })
  it('bounds rendered history without changing durable identity', () => {
    const entries = Array.from({ length: 205 }, (_, i) => ({
      ...ask,
      id: String(i),
      parentId: i ? String(i - 1) : null,
    }))
    const history = subagentHistory(entries, '204')
    expect(history.omitted).toBe(5)
    expect(history.items).toHaveLength(200)
    expect(history.items[0]?.id).toBe('5')
  })
})

const snapshot = (runs: object[], omitted?: object) => [
  `PI_SUBAGENT_ASYNC_JSON:${JSON.stringify({ kind: 'pi-subagents.async-status-snapshot', version: 1, runs, omitted })}`,
]

describe('delegated lane activity', () => {
  it('counts active roots, including descendants of a settled root', () => {
    const lines = snapshot([
      {
        id: 'root',
        state: 'complete',
        children: [
          { id: 'a', state: 'running' },
          { id: 'b', state: 'queued' },
        ],
      },
    ])
    expect(hasDelegatedWork(lines)).toBe(true)
    expect(parseFleetWidget(lines)?.active).toBe(1)
  })
  it('does not present parent attention as a human question or a stale snapshot as success', () => {
    expect(
      hasDelegatedWork(
        snapshot([{ id: 'a', state: 'running', activity: { state: 'needs_attention' } }]),
      ),
    ).toBe(true)
    expect(hasDelegatedWork(snapshot([], { children: 1 }))).toBe(true)
    expect(hasDelegatedWork(undefined)).toBe(false)
    const inactive = parseFleetWidget(snapshot([{ id: 'a', state: 'failed' }]))!
    expect(summarizeFleet(inactive)).toBe('No background runs active')
  })
  it('bounds malformed or oversized trees conservatively', () => {
    const many = snapshot(
      Array.from({ length: 250 }, (_, i) => ({ id: String(i), state: 'complete' })),
    )
    expect(parseFleetWidget(many)?.runs).toHaveLength(200)
    expect(hasDelegatedWork(many)).toBe(true)
    expect(hasDelegatedWork(snapshot([{ id: 'future', state: 'unrecognized' }]))).toBe(true)
  })
})
