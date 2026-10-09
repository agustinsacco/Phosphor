import { describe, expect, it, vi } from 'vitest'
import { createSessionDeletion } from './session-deletion'
import { createSessionPathRuntime } from './session-path-lock'

/** A registry of handles whose `alive` the test controls; files never touch the disk. */
function harness() {
  const sessions = new Map<string, { alive: boolean; sessionFile: string }>()
  const dispose = vi.fn(async (id: string) => {
    sessions.delete(id)
  })
  const deleteTranscript = vi.fn(async () => {})
  const paths = createSessionPathRuntime()
  const remove = createSessionDeletion({
    registry: {
      get: (id) => {
        const session = sessions.get(id)
        return session && ({ sessionId: id, client: session } as never)
      },
      list: () =>
        [...sessions].map(([sessionId, s]) => ({
          sessionId,
          workspacePath: '/repo',
          diskPath: s.sessionFile,
        })),
      dispose,
    },
    paths,
    ownsRoutine: () => false,
    cancelRoutine: async () => {},
    forgetAccount: () => {},
    deleteTranscript,
    deleteDraft: async () => {},
    assertDeletable: (id) => {
      if (sessions.get(id)?.alive) throw new Error('stop the session first')
    },
  })
  return { sessions, dispose, deleteTranscript, paths, remove }
}

describe('a deletion the owner can refuse', () => {
  it('refuses before anything stops, after a resume already under way has finished', async () => {
    const { sessions, dispose, deleteTranscript, paths, remove } = harness()
    let resume!: () => void
    const resuming = paths.openSessionPath('/s.jsonl', async () => {
      await new Promise<void>((resolve) => (resume = resolve))
      sessions.set('late', { alive: true, sessionFile: '/s.jsonl' })
    })
    await new Promise(setImmediate)
    const removing = remove('/s.jsonl')
    resume()
    await resuming
    await expect(removing).rejects.toThrow('stop the session first')
    expect(dispose).not.toHaveBeenCalled()
    expect(deleteTranscript).not.toHaveBeenCalled()
    expect([...sessions.keys()]).toEqual(['late'])
  })

  it('still deletes a session whose process has ended', async () => {
    const { sessions, dispose, deleteTranscript, remove } = harness()
    sessions.set('ended', { alive: false, sessionFile: '/s.jsonl' })
    expect(await remove('/s.jsonl')).toEqual(['ended'])
    expect(dispose).toHaveBeenCalledExactlyOnceWith('ended')
    expect(deleteTranscript).toHaveBeenCalledExactlyOnceWith('/s.jsonl')
  })
})
