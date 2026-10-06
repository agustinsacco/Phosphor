import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type RuntimeLog = (scope: string, message: string, data?: unknown) => void

/** Rotate at 5MB; retain one previous file. Callers choose their own data directory. */
const MAX_BYTES = 5 * 1024 * 1024

/** An instance-local, synchronous logger usable without Electron or a window. */
export function createFileLog(): {
  init: (directory: string) => void
  path: () => string | null
  write: RuntimeLog
} {
  let path: string | null = null
  let failed = false
  return {
    init(directory) {
      if (path || failed) return
      try {
        mkdirSync(directory, { recursive: true })
        path = join(directory, 'phosphor.log')
      } catch {
        failed = true
      }
    },
    path: () => path,
    write(scope, message, data) {
      if (!path || failed) return
      try {
        try {
          if (statSync(path).size >= MAX_BYTES) renameSync(path, `${path}.1`)
        } catch {
          // A missing file is the normal first-write case.
        }
        const extra = data === undefined ? '' : ` ${safeJson(data)}`
        appendFileSync(path, `${new Date().toISOString()} [${scope}] ${message}${extra}\n`)
      } catch {
        // Logging must not take execution down on disk/permission failures.
      }
    },
  }
}

function safeJson(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? String(v) : v)) ?? ''
    )
  } catch {
    return '[unserializable]'
  }
}
