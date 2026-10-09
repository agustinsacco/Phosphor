import { appendFileSync, chmodSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type RuntimeLog = (scope: string, message: string, data?: unknown) => void

/** Rotate at 5MB; retain one previous file. Callers choose their own data directory. */
const MAX_BYTES = 5 * 1024 * 1024

/** Permissions for a log that only its owner may read. Unset, the umask decides. */
export interface FileLogModes {
  /** The log's folder, and any folder `init` creates above it. */
  directory?: number
  /** Each log file: the current one, the one kept from the last rotation, and every new one. */
  file?: number
}

/** An instance-local, synchronous logger usable without Electron or a window. */
export function createFileLog(modes: FileLogModes = {}): {
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
        mkdirSync(directory, { recursive: true, mode: modes.directory })
        const file = join(directory, 'phosphor.log')
        // A folder or file that already existed keeps its mode unless told otherwise.
        if (modes.directory !== undefined) chmodSync(directory, modes.directory)
        if (modes.file !== undefined) {
          for (const existing of [file, `${file}.1`]) {
            try {
              chmodSync(existing, modes.file)
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            }
          }
        }
        path = file
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
        appendFileSync(path, `${new Date().toISOString()} [${scope}] ${message}${extra}\n`, {
          mode: modes.file,
        })
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
