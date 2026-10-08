// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, 'should-skip-release.sh')

/** True when the script says "skip publishing" (exit 0). */
function skips(message: string): boolean {
  try {
    execFileSync(script, [message], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * The release pipeline reads this to decide whether a merge ships.
 *
 * It uses a git trailer rather than a marker in prose because two earlier
 * prose-matching attempts each suppressed their own release:
 *
 *   1. Whole-message match: the commit that introduced the pipeline documented
 *      `[skip release]` in its body — v0.1.37 never shipped.
 *   2. Subject-only match: the commit that fixed that had "[skip release]" in
 *      its own subject — v0.1.38 never shipped.
 *
 * The first two cases below are those exact commit messages. They are the
 * point of this file.
 */
describe('should-skip-release', () => {
  describe('the regressions that motivated the trailer', () => {
    it('publishes a commit whose BODY documents the marker (v0.1.37)', () => {
      const message = [
        'feat: publish a release on every green main build, and update in place (#14)',
        '',
        '`[skip release]` skips publishing; an existing tag skips rather than',
        'fails, so re-runs and workflow_dispatch replays are safe.',
      ].join('\n')
      expect(skips(message)).toBe(false)
    })

    it('publishes a commit whose SUBJECT mentions the marker (v0.1.38)', () => {
      const message = [
        'fix: only treat [skip release] in the commit subject as a directive (#15)',
        '',
        'The first merge of the release pipeline never published.',
      ].join('\n')
      expect(skips(message)).toBe(false)
    })

    it('publishes a commit that discusses the trailer itself', () => {
      // The same trap, one level up: talking about `Skip-Release:` must not
      // trigger it, or this fix would suppress its own release too.
      const message = [
        'docs: explain the Skip-Release trailer',
        '',
        'Add `Skip-Release: true` as a trailer to skip publishing a release.',
      ].join('\n')
      expect(skips(message)).toBe(false)
    })

    it('publishes a commit with the trailer shown as an indented example (v0.1.39)', () => {
      // Caught locally before it shipped: a regex matching any
      // `Skip-Release:` line tripped on this commit's own code sample. git
      // does not treat an indented block as a trailer, which is why parsing is
      // delegated to it.
      const message = [
        'fix: use a git trailer to skip releases, not a marker in prose',
        '',
        'Switch to a git trailer on its own line:',
        '',
        '    Skip-Release: true',
        '',
        'which cannot be triggered by discussing it.',
        '',
        'Co-Authored-By: Someone <someone@example.test>',
      ].join('\n')
      expect(skips(message)).toBe(false)
    })
  })

  describe('the directive itself', () => {
    it('skips on a trailer at the end of the message', () => {
      expect(skips('chore: tweak the readme\n\nSkip-Release: true')).toBe(true)
    })

    it('accepts the usual affirmative spellings, case-insensitively', () => {
      expect(skips('chore: x\n\nskip-release: true')).toBe(true)
      expect(skips('chore: x\n\nSKIP-RELEASE: YES')).toBe(true)
      expect(skips('chore: x\n\nSkip-Release: 1')).toBe(true)
    })

    it('tolerates trailing whitespace', () => {
      expect(skips('chore: x\n\nSkip-Release: true  ')).toBe(true)
    })

    it('does NOT accept an indented line, because git does not call that a trailer', () => {
      // This is the property that makes a fenced/indented example in a commit
      // body safe — see the v0.1.39 case above. Asserted so nobody "fixes" it.
      expect(skips('chore: x\n\n    Skip-Release: true')).toBe(false)
    })

    it('coexists with other trailers', () => {
      const message = [
        'chore: tweak the readme',
        '',
        'Skip-Release: true',
        'Co-Authored-By: Someone <someone@example.test>',
      ].join('\n')
      expect(skips(message)).toBe(true)
    })
  })

  describe('does not publish-block on near misses', () => {
    it('ignores a non-affirmative value', () => {
      expect(skips('chore: x\n\nSkip-Release: false')).toBe(false)
      expect(skips('chore: x\n\nSkip-Release: no')).toBe(false)
    })

    it('ignores the phrase mid-sentence', () => {
      // Must be a trailer on its own line, not prose that happens to contain it.
      expect(skips('chore: x\n\nWe set Skip-Release: true when shipping docs.')).toBe(false)
    })

    it('ignores a trailing explanation after the value', () => {
      expect(skips('chore: x\n\nSkip-Release: true because it is docs only')).toBe(false)
    })

    it('ignores ordinary commits and empty messages', () => {
      expect(skips('fix: correct the sidebar overflow')).toBe(false)
      expect(skips('')).toBe(false)
      expect(skips('\n\n')).toBe(false)
    })
  })
})
