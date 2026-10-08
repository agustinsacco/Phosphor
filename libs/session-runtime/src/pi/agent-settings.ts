import { join } from 'node:path'
import { readJsonFile, type JsonFileRead } from './json-config'
import { piAgentDir } from './pi-paths'

/**
 * pi's effective settings for a workspace, read the way pi reads them. Only
 * the read lives here; Desktop's settings editor owns writing.
 */
export interface PiAgentSettings {
  hideThinkingBlock?: boolean
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: string
  theme?: string
  [key: string]: unknown
}

/** One settings file, read with health; see `json-config.ts`. */
const readJson = (path: string): Promise<JsonFileRead<PiAgentSettings>> =>
  readJsonFile<PiAgentSettings>(path)

/**
 * Read pi's settings.json (global, merged with the workspace override).
 * Unparseable files degrade to empty for display, but `malformed` is
 * reported so callers can refuse to write over them.
 *
 * Mirrors pi's own override semantics: nested objects merge one level deep
 * (a project `{compaction: {reserveTokens}}` keeps the global
 * `compaction.enabled`), everything else replaces.
 */
export async function readAgentSettings(workspacePath?: string): Promise<PiAgentSettings> {
  const global = await readJson(join(piAgentDir(), 'settings.json'))
  const project = workspacePath
    ? await readJson(join(workspacePath, '.pi', 'settings.json'))
    : { value: {}, exists: false, malformed: false }

  const merged: PiAgentSettings = { ...global.value, ...project.value }
  for (const [key, projectValue] of Object.entries(project.value)) {
    const globalValue = global.value[key]
    if (
      projectValue &&
      globalValue &&
      typeof projectValue === 'object' &&
      typeof globalValue === 'object' &&
      !Array.isArray(projectValue) &&
      !Array.isArray(globalValue)
    ) {
      merged[key] = { ...globalValue, ...projectValue }
    }
  }
  return merged
}
