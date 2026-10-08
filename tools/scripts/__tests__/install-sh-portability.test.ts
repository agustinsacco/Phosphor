// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(resolve(import.meta.dirname, '../install.sh'), 'utf8')

/**
 * install.sh is piped to whatever /bin/sh is, and on macOS that is bash 3.2
 * (2007, the last GPLv2 release — Apple never upgrades it). Under a UTF-8
 * locale, bash 3.2 swallows a multibyte character that directly follows a
 * variable expansion INTO the variable name: `"$REPO…"` becomes a lookup of a
 * variable literally named `REPO…`, and the script's `set -u` turns that into
 * a fatal `REPO…: unbound variable`. Every interactive mac terminal is UTF-8,
 * so `curl | sh` crashed for every mac user at the first such line — while
 * passing in CI and in C-locale shells, where bash parses byte-wise, and on
 * Linux, where /bin/sh is dash or bash 4+.
 *
 * Banning specific characters next to `$VAR` would miss the next variant, so
 * the rule is total: the installer stays pure ASCII.
 */
describe('install.sh portability', () => {
  it('is pure ASCII (bash 3.2 mangles multibyte chars after $VAR under UTF-8 locales)', () => {
    const offenders = script
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /[^\x20-\x7E\t]/.test(line))
      .map(({ line, n }) => `line ${n}: ${line.trim()}`)
    expect(offenders).toEqual([])
  })
})
