import { describe, expect, it } from 'vitest'
import { IDLE, reduceUpdate, type UpdateState } from './update-state'

/**
 * The updater is invisible when it works and must never nag when it doesn't,
 * so its whole contract lives in these transitions. Testing the reducer
 * directly means none of this needs a packaged app or a network.
 */
describe('reduceUpdate', () => {
  it('walks the happy path: idle → checking → downloading → downloaded', () => {
    let state = IDLE
    state = reduceUpdate(state, { type: 'check-started' })
    expect(state.phase).toBe('checking')

    state = reduceUpdate(state, { type: 'update-available', version: '0.1.42' })
    expect(state).toEqual({ phase: 'downloading', version: '0.1.42', progressPercent: 0 })

    state = reduceUpdate(state, { type: 'download-progress', percent: 63.4 })
    expect(state.progressPercent).toBe(63)

    state = reduceUpdate(state, { type: 'update-downloaded', version: '0.1.42' })
    expect(state).toEqual({ phase: 'downloaded', version: '0.1.42' })
  })

  it('walks the macOS self-install path: downloading → installing → downloaded', () => {
    // `installing` covers verify-and-expand, which only the hand-rolled macOS
    // path has. It must not be reachable from anywhere but a live download.
    let state: UpdateState = { phase: 'downloading', version: '0.1.42', progressPercent: 100 }
    state = reduceUpdate(state, { type: 'install-started' })
    expect(state).toEqual({ phase: 'installing', version: '0.1.42' })

    state = reduceUpdate(state, { type: 'update-downloaded', version: '0.1.42' })
    expect(state).toEqual({ phase: 'downloaded', version: '0.1.42' })
  })

  it('ignores install-started outside a download', () => {
    expect(reduceUpdate(IDLE, { type: 'install-started' })).toBe(IDLE)
    const staged: UpdateState = { phase: 'downloaded', version: '0.1.42' }
    expect(reduceUpdate(staged, { type: 'install-started' })).toBe(staged)
  })

  it('degrades a failed self-install to the manual link, not to silence', () => {
    // The whole point of the fallback: a macOS swap that fails must leave the
    // user a way to update by hand rather than an update that vanished.
    const state = reduceUpdate(
      { phase: 'installing', version: '0.1.42' },
      { type: 'install-failed', version: '0.1.42', releaseUrl: 'https://example.test/r' },
    )
    expect(state).toEqual({
      phase: 'manual-download',
      version: '0.1.42',
      releaseUrl: 'https://example.test/r',
    })
  })

  it('returns to idle when there is nothing to install', () => {
    const state = reduceUpdate({ phase: 'checking' }, { type: 'update-not-available' })
    expect(state).toEqual(IDLE)
  })

  it('offers a manual download when this install cannot apply the update', () => {
    // Unsigned macOS and deb installs land here: detection works, installation
    // does not, and the UI must say so rather than promise a restart.
    const state = reduceUpdate(
      { phase: 'checking' },
      { type: 'manual-required', version: '0.1.42', releaseUrl: 'https://example.test/r' },
    )
    expect(state).toEqual({
      phase: 'manual-download',
      version: '0.1.42',
      releaseUrl: 'https://example.test/r',
    })
  })

  describe('errors are silent', () => {
    it('collapses to idle so a failed check never nags', () => {
      expect(reduceUpdate({ phase: 'checking' }, { type: 'error' })).toEqual(IDLE)
      expect(reduceUpdate({ phase: 'downloading' }, { type: 'error' })).toEqual(IDLE)
    })

    it('does not discard an update that is already usable', () => {
      const staged: UpdateState = { phase: 'downloaded', version: '0.1.42' }
      expect(reduceUpdate(staged, { type: 'error' })).toBe(staged)

      const manual: UpdateState = { phase: 'manual-download', version: '0.1.42' }
      expect(reduceUpdate(manual, { type: 'error' })).toBe(manual)
    })
  })

  describe('a staged update survives later checks', () => {
    it('ignores check-started while downloading or downloaded', () => {
      // The 30-minute timer keeps firing; it must not flicker the pill back to
      // "checking" under the user, nor restart a download in flight.
      const downloading: UpdateState = {
        phase: 'downloading',
        version: '0.1.42',
        progressPercent: 40,
      }
      expect(reduceUpdate(downloading, { type: 'check-started' })).toBe(downloading)

      const staged: UpdateState = { phase: 'downloaded', version: '0.1.42' }
      expect(reduceUpdate(staged, { type: 'check-started' })).toBe(staged)

      // Extraction on the macOS path takes seconds more; the same holds.
      const installing: UpdateState = { phase: 'installing', version: '0.1.42' }
      expect(reduceUpdate(installing, { type: 'check-started' })).toBe(installing)
    })

    it('ignores update-not-available once something is staged or in flight', () => {
      const staged: UpdateState = { phase: 'downloaded', version: '0.1.42' }
      expect(reduceUpdate(staged, { type: 'update-not-available' })).toBe(staged)

      // A check that races a download must not cancel it back to idle.
      const downloading: UpdateState = { phase: 'downloading', version: '0.1.42' }
      expect(reduceUpdate(downloading, { type: 'update-not-available' })).toBe(downloading)
    })
  })

  describe('progress', () => {
    it('is ignored unless a download is actually in flight', () => {
      expect(reduceUpdate(IDLE, { type: 'download-progress', percent: 50 })).toBe(IDLE)
    })

    it('clamps out-of-range and non-finite values', () => {
      const base: UpdateState = { phase: 'downloading', version: '0.1.42', progressPercent: 0 }
      expect(reduceUpdate(base, { type: 'download-progress', percent: 140 }).progressPercent).toBe(
        100,
      )
      expect(reduceUpdate(base, { type: 'download-progress', percent: -5 }).progressPercent).toBe(0)
      expect(reduceUpdate(base, { type: 'download-progress', percent: NaN }).progressPercent).toBe(
        0,
      )
    })
  })
})
