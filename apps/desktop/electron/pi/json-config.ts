import { readFile } from 'node:fs/promises'
import { errorText } from '@shared/errors'

/**
 * Result of reading one config file. `malformed` distinguishes "the file is
 * there but we could not parse it" from "there is no file" — the difference
 * matters before writing, because merging a patch onto a failed read would
 * silently discard everything the user had configured.
 */
export interface JsonFileRead<T extends object = Record<string, unknown>> {
  value: T
  exists: boolean
  malformed: boolean
  error?: string
}

/**
 * Read a JSON config file: absent is fine, unparseable is reported rather than
 * thrown, and the value degrades to empty either way so callers can still
 * render something. An empty (whitespace-only) file counts as existing but not
 * malformed — pi leaves those behind and writing over one loses nothing.
 */
export async function readJsonFile<T extends object = Record<string, unknown>>(
  path: string,
): Promise<JsonFileRead<T>> {
  const empty = (): T => ({}) as T
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    // No file yet — writing a fresh one is safe.
    return { value: empty(), exists: false, malformed: false }
  }
  if (raw.trim().length === 0) {
    return { value: empty(), exists: true, malformed: false }
  }
  try {
    return { value: JSON.parse(raw) as T, exists: true, malformed: false }
  } catch (error) {
    return { value: empty(), exists: true, malformed: true, error: errorText(error) }
  }
}
